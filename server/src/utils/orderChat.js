const { canBoost } = require('./boosterAccess');
const { createChatMessageNotifications } = require('./chatNotifications');

const senderSelect = { id: true, username: true, role: true,
    profile: { select: { displayName: true, profileImageUrl: true } } };
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
// Legacy rows may contain a dead public S3 URL even without an attachment key.
// Never send that URL to the browser; key-backed rows use the signed endpoint.
const presentChatMessage = message => message ? { ...message, attachmentUrl: null } : message;

async function canAccessOrderChat(db, user, orderId) {
    const userId = user?.id || user?.userId;
    if (!userId || user.suspendedAt || typeof orderId !== 'string') return false;
    const order = await db.order.findUnique({ where: { id: orderId }, select: { customerId: true } });
    if (!order) return false;
    if (user.role === 'ADMIN' || order.customerId === userId) return true;
    if (!canBoost(user)) return false;
    return Boolean(await db.orderAssignment.findFirst({ where: { orderId, boosterId: userId }, select: { boosterId: true } }));
}

function validateOrderChatContent(content) {
    if (typeof content !== 'string' || !content.trim()) fail(400, 'Message content is required');
    if (content.trim().length > 4000) fail(400, 'Keep your message under 4,000 characters.');
    return content.trim();
}

async function saveOrderChatMessage(db, data) {
    return db.$transaction(async tx => {
        // Serializes all match-chat transports and conversations for this sender.
        await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${data.senderId} FOR UPDATE`;
        const conversation = await tx.conversation.findUnique({ where: { id: data.conversationId }, select: { orderId: true } });
        if (!conversation) fail(404, 'Conversation not found');
        await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${conversation.orderId} FOR UPDATE`;
        const actor = await tx.user.findUnique({ where: { id: data.senderId }, select: { id: true, role: true, hasBoosterAccess: true, suspendedAt: true } });
        if (!await canAccessOrderChat(tx, actor, conversation.orderId)) fail(403, 'Forbidden');
        const recent = await tx.message.count({ where: { senderId: data.senderId, createdAt: { gt: new Date(Date.now() - 60000) } } });
        if (recent >= 20) fail(429, 'Please wait a minute before sending more messages.');
        const message = await tx.message.create({ data, include: { sender: { select: senderSelect } } });
        await tx.conversation.update({ where: { id: data.conversationId }, data: { lastMessageAt: message.createdAt } });
        await createChatMessageNotifications({ prisma: tx, conversationId: data.conversationId, senderId: data.senderId, message });
        return message;
    });
}

module.exports = { canAccessOrderChat, validateOrderChatContent, saveOrderChatMessage, senderSelect, presentChatMessage };
