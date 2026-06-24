const prisma = require("../prisma");
const {
  uploadChatAttachmentToS3,
  createChatAttachmentSignedUrl,
} = require("../utils/s3Upload");
const {
  createChatMessageNotifications,
} = require("../utils/chatNotifications");

function getUserId(req) {
  return req.user?.id || req.user?.userId;
}

function getUserRole(req) {
  return req.user?.role;
}

function formatAttachmentContent(file) {
  const name = file?.originalname || "Attachment";
  return `Sent an attachment: ${name}`;
}

function pickAttachmentType(mimeType = "", fileName = "") {
  const lowerName = String(fileName).toLowerCase();

  if (mimeType.startsWith("image/")) return "Image";
  if (mimeType.includes("pdf") || lowerName.endsWith(".pdf")) return "PDF";
  if (mimeType.includes("word") || lowerName.endsWith(".doc") || lowerName.endsWith(".docx")) return "Word";
  if (mimeType.includes("excel") || lowerName.endsWith(".xls") || lowerName.endsWith(".xlsx")) return "Excel";
  if (lowerName.endsWith(".zip") || lowerName.endsWith(".rar") || lowerName.endsWith(".7z")) return "Archive";
  if (mimeType.includes("text") || lowerName.endsWith(".txt")) return "Text";

  return "File";
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
            username: true,
            role: true,
            profile: true,
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
            username: true,
            role: true,
            profile: true,
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

    await createChatMessageNotifications({
      prisma,
      conversationId,
      senderId,
      message,
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

exports.uploadAttachmentMessage = async (req, res) => {
  try {
    const { conversationId } = req.params;
    const senderId = getUserId(req);

    if (!senderId) {
      return res.status(401).json({
        ok: false,
        message: "Not authorized",
      });
    }

    if (!req.file) {
      return res.status(400).json({
        ok: false,
        message: "Please choose a file to upload.",
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

    const uploaded = await uploadChatAttachmentToS3({
      conversationId,
      userId: senderId,
      file: req.file,
    });

    const message = await prisma.message.create({
      data: {
        conversationId,
        senderId,
        content: formatAttachmentContent(req.file),
        attachmentKey: uploaded.key,
        attachmentUrl: uploaded.url,
        attachmentName: req.file.originalname || "attachment",
        attachmentMimeType: req.file.mimetype || "application/octet-stream",
        attachmentSize: req.file.size || 0,
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
      data: {
        lastMessageAt: message.createdAt,
      },
    });

    await createChatMessageNotifications({
      prisma,
      conversationId,
      senderId,
      message,
    });

    return res.status(201).json({
      ok: true,
      message: {
        ...message,
        attachmentType: pickAttachmentType(
          message.attachmentMimeType,
          message.attachmentName
        ),
      },
    });
  } catch (error) {
    console.error("uploadAttachmentMessage error:", error);

    return res.status(500).json({
      ok: false,
      message: error.message || "Failed to upload attachment",
    });
  }
};

exports.getAttachmentViewUrl = async (req, res) => {
  try {
    const { messageId } = req.params;

    const message = await prisma.message.findUnique({
      where: { id: messageId },
      include: {
        conversation: {
          include: {
            order: true,
          },
        },
      },
    });

    if (!message || !message.attachmentKey) {
      return res.status(404).json({
        ok: false,
        message: "Attachment not found",
      });
    }

    const allowed = await canAccessOrder(req, message.conversation.orderId);

    if (!allowed) {
      return res.status(403).json({
        ok: false,
        message: "Forbidden",
      });
    }

    const viewUrl = await createChatAttachmentSignedUrl({
      key: message.attachmentKey,
      filename: message.attachmentName,
    });

    return res.json({
      ok: true,
      viewUrl,
      attachmentName: message.attachmentName,
      attachmentMimeType: message.attachmentMimeType,
      attachmentSize: message.attachmentSize,
    });
  } catch (error) {
    console.error("getAttachmentViewUrl error:", error);

    return res.status(500).json({
      ok: false,
      message: "Failed to open attachment",
    });
  }
};