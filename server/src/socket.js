const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const prisma = require("./prisma");

function getSocketUserId(socket) {
    return socket.user?.id || socket.user?.userId;
}

async function ensureConversationForOrder(orderId) {
    let convo = await prisma.conversation.findUnique({ where: { orderId } });
    if (!convo) {
        convo = await prisma.conversation.create({ data: { orderId } });
    }
    return convo;
}

async function canAccessOrder(user, orderId) {
    if (!user) return false;

    const userId = user.id || user.userId;
    const userRole = user.role;

    if (!userId) return false;
    if (userRole === "ADMIN") return true;

    const order = await prisma.order.findUnique({ where: { id: orderId } });
    if (!order) return false;

    if (order.customerId === userId) return true;

    const assignment = await prisma.orderAssignment.findFirst({
        where: {
            orderId,
            boosterId: userId,
        },
    });

    return Boolean(assignment);
}

async function ensureParticipant(conversationId, user) {
    const userId = user.id || user.userId;
    const userRole = user.role;

    if (!userId) {
        throw new Error("Socket user ID missing");
    }

    await prisma.conversationParticipant.upsert({
        where: {
            conversationId_userId: {
                conversationId,
                userId,
            },
        },
        update: {},
        create: {
            conversationId,
            userId,
            roleAtJoin: userRole || "CUSTOMER",
        },
    });
}

function initSocket(httpServer) {
    const io = new Server(httpServer, {
        cors: { origin: "*" },
    });

    io.use((socket, next) => {
        try {
            const token = socket.handshake.auth?.token ||
                (socket.handshake.headers?.authorization || "").split(" ")[1];
            if (!token) return next(new Error("Unauthorized"));
            const payload = jwt.verify(token, process.env.JWT_SECRET);
            socket.user = payload;
            next();
        } catch (err) {
            next(new Error("Unauthorized"));
        }
    });

    io.on("connection", (socket) => {
        socket.on("chat:join", async ({ orderId }, cb) => {
            try {
                if (!orderId) return cb?.({ ok: false, message: "orderId required" });
                const allowed = await canAccessOrder(socket.user, orderId);
                if (!allowed) return cb?.({ ok: false, message: "Forbidden" });

                const convo = await ensureConversationForOrder(orderId);
                await ensureParticipant(convo.id, socket.user);

                const room = `conv:${convo.id}`;
                socket.join(room);

                const recent = await prisma.message.findMany({
                    where: { conversationId: convo.id },
                    orderBy: { createdAt: "desc" },
                    take: 20,
                    include: {
                        sender: {
                            select: {
                                id: true,
                                email: true,
                                username: true,
                                role: true,
                                profile: true,
                            },
                        },
                    },
                });

                cb?.({ ok: true, conversationId: convo.id, messages: recent.reverse() });
            } catch (err) {
                cb?.({ ok: false, message: "Join failed" });
            }
        });

        socket.on("chat:message", async ({ conversationId, content }, cb) => {
            try {
                const userId = getSocketUserId(socket);

                if (!conversationId || !content?.trim()) {
                    return cb?.({ ok: false, message: "Invalid payload" });
                }

                if (!userId) {
                    return cb?.({ ok: false, message: "User ID missing from token" });
                }

                const member = await prisma.conversationParticipant.findUnique({
                    where: {
                        conversationId_userId: {
                            conversationId,
                            userId,
                        },
                    },
                });

                if (!member) {
                    return cb?.({ ok: false, message: "Forbidden" });
                }

                const msg = await prisma.message.create({
                    data: {
                        conversationId,
                        senderId: userId,
                        content: content.trim(),
                    },
                    include: {
                        sender: {
                            select: {
                                id: true,
                                email: true,
                                username: true,
                                role: true,
                                profile: true,
                            },
                        },
                    },
                });

                await prisma.conversation.update({
                    where: { id: conversationId },
                    data: { lastMessageAt: msg.createdAt },
                });

                const room = `conv:${conversationId}`;

                io.to(room).emit("chat:message", msg);

                cb?.({ ok: true, message: msg });
            } catch (err) {
                console.error("socket chat:message error:", err);

                cb?.({
                    ok: false,
                    message: "Send failed",
                    error: err.message,
                });
            }
        });

        socket.on("chat:typing", async ({ conversationId, isTyping }) => {
            try {
                if (!conversationId) return;

                const userId = getSocketUserId(socket);

                if (!userId) return;

                const member = await prisma.conversationParticipant.findUnique({
                    where: {
                        conversationId_userId: {
                            conversationId,
                            userId,
                        },
                    },
                });

                if (!member) return;

                const room = `conv:${conversationId}`;

                socket.to(room).emit("chat:typing", {
                    userId,
                    isTyping: !!isTyping,
                });
            } catch (err) {
                console.error("socket chat:typing error:", err);
            }
        });
    });

    return io;
}

module.exports = { initSocket };
