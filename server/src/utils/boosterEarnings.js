const { orderEarnings } = require('./earnings');

const EARNINGS_BATCH_SIZE = 100;

// Profiles need confirmed totals, not report rows, identities, or estimates.
// Keep every contributor on a matching order: filtering nested relations by the
// requested booster would change the denominator and overpay their share.
async function boosterEarnings(db, boosterId) {
    const totals = {};
    let after;
    for (;;) {
        const orders = await db.order.findMany({
            where: {
                paymentStatus: 'PAID', status: 'COMPLETED',
                ...(boosterId ? { OR: [
                    { assignments: { some: { boosterId } } },
                    { contributions: { some: { boosterId } } },
                    { matches: { some: { boosterId } } },
                ] } : {}),
                ...(after ? { id: { gt: after } } : {}),
            },
            select: {
                id: true, boostType: true, queueType: true, amountCents: true,
                goldDiscountCents: true, cashAmountCents: true, currency: true,
                matchHistoryEnabled: true, matchHistoryConfirmedAt: true,
                assignments: { select: { boosterId: true } },
                contributions: { select: { boosterId: true, submittedMatches: true, approvedMatches: true } },
                matches: {
                    where: { boosterId: { not: null }, status: { in: ['APPROVED', 'PENDING'] } },
                    select: { game: true, details: true, status: true, boosterId: true },
                },
            },
            orderBy: { id: 'asc' }, take: EARNINGS_BATCH_SIZE,
        });
        for (const order of orders) {
            const amounts = orderEarnings(order);
            if (!amounts) continue;
            const currency = String(order.currency || 'UNKNOWN').toUpperCase();
            for (const share of amounts.shares) {
                if (boosterId && share.boosterId !== boosterId) continue;
                const income = totals[share.boosterId] ||= {};
                income[currency] = (income[currency] || 0) + share.cents;
            }
        }
        if (orders.length < EARNINGS_BATCH_SIZE) return totals;
        after = orders[orders.length - 1].id;
    }
}

module.exports = { boosterEarnings, EARNINGS_BATCH_SIZE };
