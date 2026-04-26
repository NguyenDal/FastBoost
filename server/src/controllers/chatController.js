const prisma = require("../prisma");

function getUserId(req) {
  return req.user?.id || req.user?.userId;
}

function getUserRole(req) {
  return req.user?.role;
}

async function canAccessOrder(req, orderId) {
  const userId = getUserId(req);
  const userRole = getUserRole(req);

  if (!userId) return false;
  if (userRole === "ADMIN") return true;

  const order = await prisma.order.findUnique({
    where: { id: orderId },
  });

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

async function ensureParticipant(conversationId, req) {
  const userId = getUserId(req);
  const userRole = getUserRole(req);

  if (!userId) return;

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

exports.getOrCreateOrderConversation = async (req, res) => {
  try {
    const { orderId } = req.params;

    const allowed = await canAccessOrder(req, orderId);

    if (!allowed) {
      return res.status(403).json({
        ok: false,
        message: "Forbidden",
      });
    }

    let conversation = await prisma.conversation.findUnique({
      where: { orderId },
    });

    if (!conversation) {
      conversation = await prisma.conversation.create({
        data: { orderId },
      });
    }

    await ensureParticipant(conversation.id, req);

    const participants = await prisma.conversationParticipant.findMany({
      where: { conversationId: conversation.id },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            role: true,
          },
        },
      },
    });

    return res.json({
      ok: true,
      conversation,
      participants,
    });
  } catch (error) {
    console.error("getOrCreateOrderConversation error:", error);

    return res.status(500).json({
      ok: false,
      message: "Failed to get conversation",
      error: error.message,
    });
  }
};

exports.getMessages = async (req, res) => {
  try {
    const { conversationId } = req.params;

    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      include: {
        order: true,
      },
    });

    if (!conversation) {
      return res.status(404).json({
        ok: false,
        message: "Conversation not found",
      });
    }

    const allowed = await canAccessOrder(req, conversation.orderId);

    if (!allowed) {
      return res.status(403).json({
        ok: false,
        message: "Forbidden",
      });
    }

    await ensureParticipant(conversationId, req);

    const messages = await prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: "asc" },
      include: {
        sender: {
          select: {
            id: true,
            email: true,
            role: true,
          },
        },
      },
    });

    return res.json({
      ok: true,
      messages,
    });
  } catch (error) {
    console.error("getMessages error:", error);

    return res.status(500).json({
      ok: false,
      message: "Failed to load messages",
      error: error.message,
    });
  }
};

exports.postMessage = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { content } = req.body;

    const senderId = getUserId(req);

    if (!content || !content.trim()) {
      return res.status(400).json({
        ok: false,
        message: "Message content is required",
      });
    }

    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      include: {
        order: true,
      },
    });

    if (!conversation) {
      return res.status(404).json({
        ok: false,
        message: "Conversation not found",
      });
    }

    const allowed = await canAccessOrder(req, conversation.orderId);

    if (!allowed) {
      return res.status(403).json({
        ok: false,
        message: "Forbidden",
      });
    }

    await ensureParticipant(conversationId, req);

    const message = await prisma.message.create({
      data: {
        conversationId,
        senderId,
        content: content.trim(),
      },
      include: {
        sender: {
          select: {
            id: true,
            email: true,
            role: true,
          },
        },
      },
    });

    await prisma.conversation.update({
      where: { id: conversationId },
      data: {
        lastMessageAt: message.createdAt,
      },
    });

    return res.status(201).json({
      ok: true,
      message,
    });
  } catch (error) {
    console.error("postMessage error:", error);

    return res.status(500).json({
      ok: false,
      message: "Failed to send message",
      error: error.message,
    });
  }
};