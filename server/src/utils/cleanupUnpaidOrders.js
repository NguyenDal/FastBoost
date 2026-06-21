const prisma = require("../prisma");

async function cleanupOldUnpaidOrders() {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const result = await prisma.order.deleteMany({
        where: {
            status: "PENDING",
            paymentStatus: {
                not: "PAID",
            },
            paidAt: null,
            stripePaymentIntentId: null,
            createdAt: {
                lt: cutoff,
            },
        },
    });

    if (result.count > 0) {
        console.log(`[Cleanup] Removed ${result.count} old unpaid checkout orders.`);
    }

    return result;
}

module.exports = {
    cleanupOldUnpaidOrders,
};