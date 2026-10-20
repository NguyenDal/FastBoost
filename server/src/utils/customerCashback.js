const { createWalletService } = require('./customerWallet');
// These helpers only use the caller's transaction. No Stripe/DB client is loaded.
const wallet = createWalletService({});
const rates = new Set([0, 3, 5, 10, 15]);
const selection = { id: true, customerId: true, cashbackPercent: true, paymentStatus: true,
    status: true, currency: true, cashAmountCents: true };

function cashbackPercentForSpend(dollars) {
    return dollars >= 1500 ? 15 : dollars >= 1000 ? 10 : dollars >= 500 ? 5 : dollars >= 200 ? 3 : 0;
}

// Snapshot the customer's existing tier at successful payment. Completing an old
// order or visiting a page must never create a retroactive cashback entitlement.
async function snapshotCashbackPercent(tx, order) {
    if (order.cashbackPercent != null) {
        if (!rates.has(order.cashbackPercent)) throw new Error('Invalid saved cashback rate');
        return order.cashbackPercent;
    }
    const stats = await tx.order.aggregate({ where: { customerId: order.customerId,
        status: 'COMPLETED', paymentStatus: 'PAID', id: { not: order.id } }, _sum: { totalPrice: true } });
    const spend = Number(stats._sum.totalPrice || 0);
    if (!Number.isFinite(spend) || spend < 0) throw new Error('Invalid completed spend');
    return cashbackPercentForSpend(spend);
}

function cashbackTarget(order) {
    if (!order || !rates.has(order.cashbackPercent) || order.cashbackPercent === 0 ||
        order.paymentStatus !== 'PAID' || order.status !== 'COMPLETED' ||
        String(order.currency || '').toLowerCase() !== 'usd') return 0;
    if (!Number.isSafeInteger(order.cashAmountCents) || order.cashAmountCents < 0 || order.cashAmountCents > 2147483647) {
        throw new Error('Cashback requires a valid saved order total');
    }
    return Math.round(order.cashAmountCents * order.cashbackPercent / 100);
}

// The ledger barrier, when enabled, precedes this lock. Every existing order
// locks its customer BEFORE the mutation's order lock, including legacy orders:
// a concurrent payment can replace a null rate before we acquire the order lock.
async function prepareCashbackMutation(tx, orderId) {
    const before = await tx.order.findUnique({ where: { id: orderId }, select: selection });
    if (before?.customerId) {
        await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${before.customerId} FOR UPDATE`;
    }
    return before;
}

async function reconcileCashbackMutation(tx, orderId, before) {
    const after = await tx.order.findUnique({ where: { id: orderId }, select: selection });
    const known = after || before;
    if (!known || !rates.has(known.cashbackPercent) || known.cashbackPercent === 0) return;
    if (before?.customerId && after?.customerId && before.customerId !== after.customerId) throw new Error('Cashback order owner cannot change');
    await wallet.adjustCashback(tx, { orderId, userId: known.customerId, targetCents: cashbackTarget(after) });
}

module.exports = { cashbackPercentForSpend, snapshotCashbackPercent, cashbackTarget,
    prepareCashbackMutation, reconcileCashbackMutation };
