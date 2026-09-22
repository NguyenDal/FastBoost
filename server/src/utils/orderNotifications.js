async function notifyOrderStatus(prisma, order) {
    if (!["COMPLETED", "CANCELLED"].includes(order.status)) return;
    const completed = order.status === "COMPLETED";
    const status = completed ? "completed" : "cancelled";
    await prisma.notification.upsert({
        where: { id: `order-${order.id}-${status}` },
        update: {},
        create: {
            id: `order-${order.id}-${status}`,
            userId: order.customerId,
            type: completed ? "ORDER_COMPLETED" : "ORDER_CANCELLED",
            title: `Your order has been ${status}!`,
            message: `Your ${order.service?.title || order.boostType || "service"} order #${order.orderNumber} is now ${status}.`,
            data: { orderId: order.id, orderNumber: order.orderNumber, targetPath: `/match/${order.id}` },
        },
    });
}

module.exports = { notifyOrderStatus };

