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

  const receivers = conversation.participants.filter(
    (participant) => String(participant.userId) !== String(senderId)
  );

  if (!receivers.length) return;

  const shortMessage =
    message.content && message.content.length > 90
      ? `${message.content.slice(0, 90)}...`
      : message.content || "New message";

  await prisma.notification.createMany({
    data: receivers.map((receiver) => ({
      userId: receiver.userId,
      type: "CHAT_MESSAGE",
      title: `New message from ${senderName}`,
      message: shortMessage,
      data: {
        conversationId,
        messageId: message.id,
        orderId: conversation.order?.id || null,
        orderNumber: conversation.order?.id
          ? conversation.order.id.slice(0, 8)
          : null,
        boostType: conversation.order?.boostType || null,
        senderId,
        senderName,
        targetPath: conversation.order?.id
          ? `/match/${conversation.order.id}`
          : null,
      },
    })),
  });
}

module.exports = {
  createChatMessageNotifications,
};