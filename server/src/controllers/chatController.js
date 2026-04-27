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

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        customer: {
          select: {
            id: true,
            email: true,
            username: true,
            role: true,
            profile: true,
          },
        },
        assignments: {
          include: {
            booster: {
              select: {
                id: true,
                email: true,
                username: true,
                role: true,
                createdAt: true,
                profile: true,
              },
            },
          },
        },
      },
    });

    if (!order) {
      return res.status(404).json({
        ok: false,
        message: "Order not found",
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

    // Add current user as participant
    await ensureParticipant(conversation.id, req);

    // Always add customer as participant
    if (order.customerId) {
      await prisma.conversationParticipant.upsert({
        where: {
          conversationId_userId: {
            conversationId: conversation.id,
            userId: order.customerId,
          },
        },
        update: {},
        create: {
          conversationId: conversation.id,
          userId: order.customerId,
          roleAtJoin: "CUSTOMER",
        },
      });
    }

    // Add all assigned boosters as participants
    const assignedBoosters = order.assignments
      .map((assignment) => assignment.booster)
      .filter(Boolean);

    for (const booster of assignedBoosters) {
      await prisma.conversationParticipant.upsert({
        where: {
          conversationId_userId: {
            conversationId: conversation.id,
            userId: booster.id,
          },
        },
        update: {},
        create: {
          conversationId: conversation.id,
          userId: booster.id,
          roleAtJoin: booster.role || "PROVIDER",
        },
      });
    }

    const refreshedConversation = await prisma.conversation.findUnique({
      where: { id: conversation.id },
      include: {
        participants: {
          include: {
            user: {
              select: {
                id: true,
                email: true,
                username: true,
                role: true,
                createdAt: true,
                profile: true,
              },
            },
          },
        },
      },
    });

    return res.json({
      ok: true,
      conversation: refreshedConversation,
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
    const content = req.body.content || req.body.text;

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