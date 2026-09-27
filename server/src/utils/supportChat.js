const identitySelect = { id: true, username: true, role: true, profile: { select: { displayName: true, profileImageUrl: true } } };
const messageSelect = { id: true, threadId: true, senderId: true, clientId: true, content: true, createdAt: true, attachmentName: true, attachmentMimeType: true, attachmentSize: true, sender: { select: identitySelect } };
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };

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

// The message and every offline email alert commit together. Retries reuse the
// sender's message ID rather than delivering duplicate messages or alerts.
async function saveSupportMessage(db, user, threadId, body, file, upload) {
    const content = validateMessage(body, file);
    await authorizeThread(db, user, threadId);
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
        const message = await tx.supportMessage.create({ data: { threadId, senderId: user.id, clientId: body.clientId, content, ...attachment }, select: messageSelect });
        await tx.supportThread.update({ where: { id: threadId }, data: { lastMessageAt: message.createdAt } });
        if (user.role === 'CUSTOMER' && !(await onlineAdmins(tx)).length) {
            const admins = await tx.user.findMany({ where: { role: 'ADMIN', suspendedAt: null }, select: { id: true } });
            if (admins.length) await tx.supportEmailAlert.createMany({ data: admins.map(admin => ({ adminId: admin.id, messageId: message.id })), skipDuplicates: true });
        }
        return message;
    });
}

module.exports = { identitySelect, messageSelect, fail, onlineAdmins, authorizeThread, validateMessage, saveSupportMessage };
