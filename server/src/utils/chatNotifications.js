async function createChatMessageNotifications({
  prisma,
  conversationId,
  senderId,
  message,
}) {
  if (!prisma || !conversationId || !senderId || !message?.id) return;

  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    include: {
      order: {
        select: {
          id: true,
          boostType: true,
          customerId: true,
        },
      },
      participants: {
        select: {
          userId: true,
        },
      },
    },
  });

  if (!conversation) return;

  const sender = await prisma.user.findUnique({
    where: { id: senderId },
    select: {
      id: true,
      email: true,
      username: true,
      role: true,
      profile: {
        select: {
          displayName: true,
        },
      },
    },
  });

  const senderName =
    sender?.profile?.displayName ||
    sender?.username ||
    sender?.email?.split("@")[0] ||
    "Someone";

  const boostTitle = conversation.order?.boostType || "Order chat";

  const receivers = conversation.participants.filter(
    (participant) => String(participant.userId) !== String(senderId)
  );

  if (!receivers.length) return;

  const shortMessage =
    message.content && message.content.length > 90
      ? `${message.content.slice(0, 90)}...`
      : message.content || "New message";

  for (const receiver of receivers) {
    const existingUnreadChatNotification = await prisma.notification.findFirst({
      where: {
        userId: receiver.userId,
        type: "CHAT_MESSAGE",
        active: true,
        read: false,
        data: {
          path: ["conversationId"],
          equals: conversationId,
        },
      },
    });

    // Keep one unread preview per conversation, updated to its latest message.
    if (existingUnreadChatNotification) {
      await prisma.notification.update({
        where: { id: existingUnreadChatNotification.id },
        data: {
          title: senderName,
          message: shortMessage,
          createdAt: message.createdAt || new Date(),
          data: {
            ...(existingUnreadChatNotification.data || {}),
            messageId: message.id,
            senderId,
            senderName,
            senderInitial: senderName.charAt(0).toUpperCase(),
          },
        },
      });
      continue;
    }

    await prisma.notification.create({
      data: {
        userId: receiver.userId,
        type: "CHAT_MESSAGE",
        title: senderName,
        message: shortMessage,
        data: {
          conversationId,
          messageId: message.id,
          orderId: conversation.order?.id || null,
          orderNumber: conversation.order?.id
            ? conversation.order.id.slice(0, 8)
            : null,
          boostType: boostTitle,
          senderId,
          senderName,
          senderInitial: senderName.charAt(0).toUpperCase(),
          targetPath: conversation.order?.id
            ? `/match/${conversation.order.id}`
            : null,
        },
      },
    });
  }
}

module.exports = {
  createChatMessageNotifications,
};
