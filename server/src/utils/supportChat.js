const identitySelect = { id: true, username: true, role: true, profile: { select: { displayName: true, profileImageUrl: true } } };
const messageSelect = { id: true, threadId: true, senderId: true, clientId: true, content: true, createdAt: true, attachmentName: true, attachmentMimeType: true, attachmentSize: true, sender: { select: identitySelect } };
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const EMAIL_DELAY_MS = 5 * 60 * 1000;
const supportNotificationId = (messageId, recipientId) => `support-${messageId}-${recipientId}`;

async function onlineAdmins(db, now = new Date()) {
    return db.user.findMany({ where: { role: 'ADMIN', suspendedAt: null, supportPresence: { some: { expiresAt: { gt: now } } } }, select: identitySelect, orderBy: { id: 'asc' } });
}

async function authorizeThread(db, user, id) {
    const thread = await db.supportThread.findUnique({ where: { id } });
    if (!thread || (user.role !== 'ADMIN' && thread.customerId !== user.id)) fail(404, 'Conversation not found.');
    return thread;
}

function validateMessage(body, file) {
    if (typeof body.clientId !== 'string' || !/^[\w-]{16,80}$/.test(body.clientId)) fail(400, 'A message ID is required.');
    const content = typeof body.text === 'string' ? body.text.trim() : '';
    if (content.length > 4000) fail(400, 'Keep your message under 4,000 characters.');
    if (!content && !file) fail(400, 'Write a message or attach a file.');
    if (file && !/\.(jpe?g|png|gif|webp|pdf|txt|docx?|xlsx?|zip)$/i.test(file.originalname)) fail(400, 'Use an image, PDF, text, Office document or ZIP file.');
    return content;
}

// The message, notifications and email alerts commit together. Retries reuse the
// sender's message ID rather than delivering duplicate messages or alerts.
async function saveSupportMessage(db, user, threadId, body, file, upload) {
    const content = validateMessage(body, file);
    const thread = await authorizeThread(db, user, threadId);
    const previous = await db.supportMessage.findUnique({ where: { senderId_clientId: { senderId: user.id, clientId: body.clientId } }, select: messageSelect });
    if (previous) {
        if (previous.threadId !== threadId) fail(409, 'Message ID already used.');
        return previous;
    }
    let attachment = {};
    if (file) {
        const uploaded = await upload({ conversationId: `support-${threadId}`, userId: user.id, file });
        attachment = { attachmentKey: uploaded.key, attachmentName: file.originalname.slice(0, 200), attachmentMimeType: file.mimetype, attachmentSize: file.size };
    }
    return db.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM "SupportThread" WHERE id = ${threadId} FOR UPDATE`;
        const duplicate = await tx.supportMessage.findUnique({ where: { senderId_clientId: { senderId: user.id, clientId: body.clientId } }, select: messageSelect });
        if (duplicate) return duplicate;
        const recent = await tx.supportMessage.count({ where: { senderId: user.id, createdAt: { gt: new Date(Date.now() - 60000) } } });
        if (recent >= 12) fail(429, 'Please wait a minute before sending more messages.');
        const currentThread = await tx.supportThread.findUnique({ where: { id: threadId } });
        // Keep read cursors strictly ordered even for simultaneous sends / DB transaction timestamps.
        const createdAt = new Date(Math.max(Date.now(), new Date(currentThread.lastMessageAt || 0).getTime() + 1));
        const message = await tx.supportMessage.create({ data: { threadId, senderId: user.id, clientId: body.clientId, content, createdAt, ...attachment }, select: messageSelect });
        await tx.supportThread.update({ where: { id: threadId }, data: { lastMessageAt: message.createdAt } });
        const recipients = await tx.user.findMany({ where: user.role === 'CUSTOMER'
            ? { role: 'ADMIN', suspendedAt: null }
            : { id: thread.customerId, role: 'CUSTOMER', suspendedAt: null }, select: { id: true } });
        const senderName = message.sender.username || message.sender.profile?.displayName || 'Support';
        if (recipients.length) await tx.notification.createMany({ data: recipients.map(recipient => ({
            id: supportNotificationId(message.id, recipient.id), userId: recipient.id,
            type: 'CHAT_MESSAGE', title: senderName,
            message: (content || message.attachmentName || 'Attachment').slice(0, 180), createdAt: message.createdAt,
            data: { supportThreadId: threadId, messageId: message.id, senderId: user.id, senderName,
                senderInitial: senderName.charAt(0).toUpperCase(), boostType: 'Support chat',
                targetPath: user.role === 'CUSTOMER' ? `/admin/support?thread=${encodeURIComponent(threadId)}` : '/account/dashboard?support=open' },
        })), skipDuplicates: true });
        // Presence means an admin is on the site, not that this message was read.
        // Queue every recipient; the worker cancels reminders when actually read.
        if (recipients.length) await tx.supportEmailAlert.createMany({ data: recipients.map(recipient => ({
            // Legacy column name: adminId is the recipient FK for either direction.
            adminId: recipient.id, messageId: message.id, nextAttemptAt: new Date(message.createdAt.getTime() + EMAIL_DELAY_MS),
        })), skipDuplicates: true });
        return message;
    });
}

async function markSupportRead(db, user, threadId, messageId) {
    return db.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM "SupportThread" WHERE id = ${threadId} FOR UPDATE`;
        await authorizeThread(tx, user, threadId);
        const message = await tx.supportMessage.findUnique({ where: { id: messageId } });
        if (!message || message.threadId !== threadId) fail(400, 'Invalid message.');
        const field = user.role === 'ADMIN' ? 'adminReadAt' : 'customerReadAt';
        await tx.supportThread.updateMany({ where: { id: threadId, [field]: { lt: message.createdAt } }, data: { [field]: message.createdAt } });
        await tx.notification.updateMany({ where: {
            type: 'CHAT_MESSAGE', read: false, data: { path: ['supportThreadId'], equals: threadId },
            createdAt: { lte: message.createdAt },
            ...(user.role === 'ADMIN' ? { user: { role: 'ADMIN' } } : { userId: user.id }),
        }, data: { read: true } });
    });
}

module.exports = { identitySelect, messageSelect, fail, onlineAdmins, authorizeThread, validateMessage, saveSupportMessage, markSupportRead, supportNotificationId, EMAIL_DELAY_MS };
