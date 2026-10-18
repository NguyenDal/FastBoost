const { Server } = require("socket.io");
const prisma = require("./prisma");
const { verifySessionToken } = require("./utils/sessionToken");
const { withAuditedSocketMessage } = require('./utils/auditedSocketMessage');
const { canAccessOrderChat, validateOrderChatContent, saveOrderChatMessage, senderSelect } = require('./utils/orderChat');

async function refreshSocketUser(socket) {
    const token = socket.sessionToken || socket.handshake.auth?.token || (socket.handshake.headers?.authorization || '').split(' ')[1];
    socket.user = await verifySessionToken(token, { db: prisma });
    return socket.user;
}

async function conversationAccess(socket, conversationId) {
    const user = await refreshSocketUser(socket);
    const conversation = await prisma.conversation.findUnique({ where: { id: conversationId }, select: { id: true, orderId: true } });
    if (!conversation || !await canAccessOrderChat(prisma, user, conversation.orderId)) {
        throw Object.assign(new Error('Forbidden'), { status: 403 });
    }
    return conversation;
}

// A retained room membership is not authorization. Revalidate each recipient
// before every private emission, including sessions suspended or unassigned
// since joining, then evict subscriptions that no longer have access.
async function emitAuthorized(io, conversationId, event, payload, exceptId) {
    const room = 'conv:' + conversationId;
    const recipients = await io.in(room).fetchSockets();
    await Promise.all(recipients.map(async recipient => {
        try {
            await conversationAccess(recipient, conversationId);
            if (recipient.id !== exceptId) recipient.emit(event, payload);
        } catch {
            await recipient.leave(room);
        }
    }));
}

function initSocket(httpServer) {
    const io = new Server(httpServer, { cors: { origin: process.env.CLIENT_URL || false }, maxHttpBufferSize: 16 * 1024 });
    io.use(async (socket, next) => {
        try {
            socket.sessionToken = socket.handshake.auth?.token || (socket.handshake.headers?.authorization || '').split(' ')[1];
            await refreshSocketUser(socket);
            next();
        } catch { next(new Error('Unauthorized')); }
    });
    io.on('connection', socket => {
        socket.on('chat:join', async (payload, cb) => {
            const reply = typeof cb === 'function' ? cb : () => {};
            try {
                const orderId = payload?.orderId;
                if (typeof orderId !== 'string' || !orderId || orderId.length > 128) return reply({ ok: false, message: 'orderId required' });
                await refreshSocketUser(socket);
                if (!await canAccessOrderChat(prisma, socket.user, orderId)) return reply({ ok: false, message: 'Forbidden' });
                const conversation = await prisma.conversation.upsert({ where: { orderId }, create: { orderId }, update: {} });
                await prisma.conversationParticipant.upsert({
                    where: { conversationId_userId: { conversationId: conversation.id, userId: socket.user.userId } },
                    create: { conversationId: conversation.id, userId: socket.user.userId, roleAtJoin: socket.user.role }, update: {},
                });
                const messages = await prisma.message.findMany({ where: { conversationId: conversation.id }, orderBy: { createdAt: 'desc' }, take: 20,
                    include: { sender: { select: senderSelect } } });
                // Check again after asynchronous history reads before exposing it.
                await conversationAccess(socket, conversation.id);
                await socket.join('conv:' + conversation.id);
                reply({ ok: true, conversationId: conversation.id, messages: messages.reverse() });
            } catch { reply({ ok: false, message: 'Join failed' }); }
        });
        socket.on('chat:message', async (payload, cb) => {
            const reply = typeof cb === 'function' ? cb : () => {};
            try {
                const conversationId = payload?.conversationId;
                const content = validateOrderChatContent(payload?.content);
                if (typeof conversationId !== 'string' || !conversationId || conversationId.length > 128) return reply({ ok: false, message: 'Invalid payload' });
                await conversationAccess(socket, conversationId);
                const message = await withAuditedSocketMessage(prisma, socket.user, conversationId, () => saveOrderChatMessage(prisma, {
                    conversationId, senderId: socket.user.userId, content,
                }));
                await emitAuthorized(io, conversationId, 'chat:message', message);
                reply({ ok: true, message });
            } catch (error) {
                reply({ ok: false, message: [400, 429].includes(error.status) ? error.message : 'Send failed' });
            }
        });
        socket.on('chat:typing', async payload => {
            try {
                const conversationId = payload?.conversationId;
                if (typeof conversationId !== 'string' || !conversationId || conversationId.length > 128) return;
                // Bound typing events before database work.
                const now = Date.now();
                if (now - (socket.lastTypingAt || 0) < 1000) return;
                socket.lastTypingAt = now;
                await conversationAccess(socket, conversationId);
                await emitAuthorized(io, conversationId, 'chat:typing', { userId: socket.user.userId, isTyping: Boolean(payload.isTyping) }, socket.id);
            } catch {}
        });
    });
    return io;
}

module.exports = { initSocket };
