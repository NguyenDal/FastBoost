const prisma = require("../prisma");

function shortOrderId(orderId) {
  return orderId ? orderId.slice(0, 8) : "";
}

function getOrderTitle(order) {
  if (!order) return "order";

  if (order.boostType === "Rank Boost") {
    return `${order.boostType} — ${order.currentRank || "Current"} to ${order.desiredRank || "Desired"}`;
  }

  if (order.boostType === "Placement Boost") {
    return `${order.boostType} — ${order.placementGames || 0} games`;
  }

  if (order.boostType === "Win Boost") {
    return `${order.boostType} — ${order.desiredWins || 0} wins`;
  }

  if (order.boostType === "Pro Duo") {
    return `${order.boostType} — ${order.numberOfGames || 0} games`;
  }

  return order.boostType || "order";
}

async function getOrCreateConversation(orderId) {
  let conversation = await prisma.conversation.findUnique({
    where: { orderId },
  });

  if (!conversation) {
    conversation = await prisma.conversation.create({
      data: { orderId },
    });
  }

  return conversation;
}

async function addConversationParticipant(conversationId, userId, roleAtJoin) {
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
      roleAtJoin,
    },
  });
}

exports.createAssignmentRequest = async (req, res) => {
  try {
    const { orderId, boosterId } = req.params;
    const adminId = req.user.id || req.user.userId;

    if (!adminId) {
      return res.status(401).json({
        ok: false,
        message: "Unauthorized: admin user id missing from token",
      });
    }

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        service: true,
        customer: {
          select: {
            id: true,
            email: true,
            username: true,
            role: true,
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

    const booster = await prisma.user.findUnique({
      where: { id: boosterId },
      select: {
        id: true,
        email: true,
        username: true,
        role: true,
      },
    });

    if (!booster || booster.role !== "PROVIDER") {
      return res.status(400).json({
        ok: false,
        message: "Selected user is not a provider",
      });
    }

    const existingAssignment = await prisma.orderAssignment.findUnique({
      where: {
        orderId_boosterId: {
          orderId,
          boosterId,
        },
      },
    });

    if (existingAssignment) {
      return res.status(409).json({
        ok: false,
        message: "Booster is already assigned to this order",
      });
    }

    const existingPending = await prisma.assignmentRequest.findFirst({
      where: {
        orderId,
        boosterId,
        status: "PENDING",
      },
    });

    if (existingPending) {
      return res.status(200).json({
        ok: true,
        message: "Assignment request already pending",
        request: existingPending,
      });
    }

    const request = await prisma.assignmentRequest.create({
      data: {
        status: "PENDING",
        order: {
          connect: {
            id: orderId,
          },
        },
        booster: {
          connect: {
            id: boosterId,
          },
        },
        requester: {
          connect: {
            id: adminId,
          },
        },
      },
    });

    await prisma.notification.create({
      data: {
        userId: boosterId,
        type: "ASSIGNMENT_REQUEST",
        title: "Assignment request",
        message: `Admin requested you for ${getOrderTitle(order)}.`,
        data: {
          requestId: request.id,
          orderId,
          boosterId,
          requestedBy: adminId,
          orderTitle: getOrderTitle(order),
        },
      },
    });

    return res.status(201).json({
      ok: true,
      message: "Assignment request sent",
      request,
    });
  } catch (error) {
    console.error("createAssignmentRequest error:", error);

    return res.status(500).json({
      ok: false,
      message: "Failed to create assignment request",
      error: error.message,
    });
  }
};

exports.cancelAssignmentRequest = async (req, res) => {
  try {
    const { requestId } = req.params;

    const request = await prisma.assignmentRequest.findUnique({
      where: { id: requestId },
    });

    if (!request) {
      return res.status(404).json({
        ok: false,
        message: "Assignment request not found",
      });
    }

    if (request.status !== "PENDING") {
      return res.status(400).json({
        ok: false,
        message: `Cannot cancel a ${request.status.toLowerCase()} request`,
      });
    }

    const updated = await prisma.assignmentRequest.update({
      where: { id: requestId },
      data: {
        status: "CANCELLED",
        respondedAt: new Date(),
      },
    });

    // Clear the actionable booster notification.
    await prisma.notification.updateMany({
      where: {
        userId: request.boosterId,
        type: "ASSIGNMENT_REQUEST",
        active: true,
        data: {
          path: ["requestId"],
          equals: requestId,
        },
      },
      data: {
        active: false,
        read: true,
      },
    });

    return res.json({
      ok: true,
      message: "Assignment request cancelled",
      request: updated,
    });
  } catch (error) {
    console.error("cancelAssignmentRequest error:", error);

    return res.status(500).json({
      ok: false,
      message: "Failed to cancel assignment request",
      error: error.message,
    });
  }
};

exports.acceptAssignmentRequest = async (req, res) => {
  try {
    const { requestId } = req.params;
    const userId = req.user?.id || req.user?.userId;

    if (!userId) {
      return res.status(401).json({
        ok: false,
        message: "Unauthorized: user id missing from token",
      });
    }

    const request = await prisma.assignmentRequest.findUnique({
      where: { id: requestId },
      include: {
        order: true,
        booster: {
          select: {
            id: true,
            email: true,
            username: true,
            role: true,
          },
        },
        requester: {
          select: {
            id: true,
            email: true,
            username: true,
            role: true,
          },
        },
      },
    });

    if (!request) {
      return res.status(404).json({
        ok: false,
        message: "Assignment request not found",
      });
    }

    if (request.boosterId !== userId) {
      return res.status(403).json({
        ok: false,
        message: "This request is not assigned to you",
      });
    }

    if (request.status !== "PENDING") {
      return res.status(400).json({
        ok: false,
        message: `Request is already ${request.status.toLowerCase()}`,
      });
    }

    const updated = await prisma.assignmentRequest.update({
      where: { id: requestId },
      data: {
        status: "ACCEPTED",
        respondedAt: new Date(),
      },
    });

    const assignment = await prisma.orderAssignment.upsert({
      where: {
        orderId_boosterId: {
          orderId: request.orderId,
          boosterId: request.boosterId,
        },
      },
      update: {},
      create: {
        orderId: request.orderId,
        boosterId: request.boosterId,
      },
    });

    await prisma.order.update({
      where: { id: request.orderId },
      data: {
        status: "IN_PROGRESS",
      },
    });

    const conversation = await getOrCreateConversation(request.orderId);

    await addConversationParticipant(conversation.id, request.order.customerId, "CUSTOMER");
    await addConversationParticipant(conversation.id, request.boosterId, "PROVIDER");

    await prisma.notification.updateMany({
      where: {
        userId: request.boosterId,
        type: "ASSIGNMENT_REQUEST",
        active: true,
        data: {
          path: ["requestId"],
          equals: requestId,
        },
      },
      data: {
        active: false,
        read: true,
      },
    });

    await prisma.notification.create({
      data: {
        userId: request.requestedBy,
        type: "ASSIGNMENT_ACCEPTED",
        title: "Assignment accepted",
        message: `${request.booster.username || request.booster.email} accepted Order #${shortOrderId(request.orderId)}.`,
        data: {
          requestId,
          orderId: request.orderId,
          boosterId: request.boosterId,
        },
      },
    });

    return res.json({
      ok: true,
      message: "Assignment accepted",
      request: updated,
      assignment,
    });
  } catch (error) {
    console.error("acceptAssignmentRequest error:", error);

    return res.status(500).json({
      ok: false,
      message: "Failed to accept assignment request",
      error: error.message,
    });
  }
};

exports.declineAssignmentRequest = async (req, res) => {
  try {
    const { requestId } = req.params;
    const userId = req.user?.id || req.user?.userId;

    if (!userId) {
      return res.status(401).json({
        ok: false,
        message: "Unauthorized: user id missing from token",
      });
    }

    const request = await prisma.assignmentRequest.findUnique({
      where: { id: requestId },
      include: {
        booster: {
          select: {
            id: true,
            email: true,
            username: true,
            role: true,
          },
        },
      },
    });

    if (!request) {
      return res.status(404).json({
        ok: false,
        message: "Assignment request not found",
      });
    }

    if (request.boosterId !== userId) {
      return res.status(403).json({
        ok: false,
        message: "This request is not assigned to you",
      });
    }

    if (request.status !== "PENDING") {
      return res.status(400).json({
        ok: false,
        message: `Request is already ${request.status.toLowerCase()}`,
      });
    }

    const updated = await prisma.assignmentRequest.update({
      where: { id: requestId },
      data: {
        status: "DECLINED",
        respondedAt: new Date(),
      },
    });

    await prisma.notification.updateMany({
      where: {
        userId: request.boosterId,
        type: "ASSIGNMENT_REQUEST",
        active: true,
        data: {
          path: ["requestId"],
          equals: requestId,
        },
      },
      data: {
        active: false,
        read: true,
      },
    });

    await prisma.notification.create({
      data: {
        userId: request.requestedBy,
        type: "ASSIGNMENT_DECLINED",
        title: "Assignment declined",
        message: `${request.booster.username || request.booster.email} declined Order #${shortOrderId(request.orderId)}.`,
        data: {
          requestId,
          orderId: request.orderId,
          boosterId: request.boosterId,
        },
      },
    });

    return res.json({
      ok: true,
      message: "Assignment declined",
      request: updated,
    });
  } catch (error) {
    console.error("declineAssignmentRequest error:", error);

    return res.status(500).json({
      ok: false,
      message: "Failed to decline assignment request",
      error: error.message,
    });
  }
};

exports.listOrderAssignmentRequests = async (req, res) => {
  try {
    const { orderId } = req.params;

    const requests = await prisma.assignmentRequest.findMany({
      where: { orderId },
      include: {
        booster: {
          select: {
            id: true,
            email: true,
            username: true,
            role: true,
            createdAt: true,
          },
        },
        requester: {
          select: {
            id: true,
            email: true,
            username: true,
            role: true,
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    return res.json({
      ok: true,
      requests,
    });
  } catch (error) {
    console.error("listOrderAssignmentRequests error:", error);

    return res.status(500).json({
      ok: false,
      message: "Failed to load assignment requests",
      error: error.message,
    });
  }
};