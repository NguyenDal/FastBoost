const currencies = new Set(Intl.supportedValuesOf('currency'));
const paidOrderStatuses = new Set(['PENDING', 'IN_PROGRESS', 'COMPLETED']);

// Use only settled, persisted order fields. A checkout URL, Stripe return or
// client quote is not proof of payment. This payload contains no customer data.
function purchaseConversion(order) {
    if (!order || order.paymentStatus !== 'PAID' || !paidOrderStatuses.has(order.status) ||
        typeof order.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(order.id) ||
        !Number.isSafeInteger(order.cashAmountCents) || order.cashAmountCents < 0 ||
        typeof order.currency !== 'string') return null;

    const currency = order.currency.toUpperCase();
    if (!currencies.has(currency)) return null;
    if (!(order.paidAt instanceof Date) && typeof order.paidAt !== 'string') return null;
    const paidAt = new Date(order.paidAt);
    if (!Number.isFinite(paidAt.getTime()) || paidAt.getTime() <= 0) return null;

    return {
        transaction_id: order.id,
        // Settled service value after discounts, including wallet + card tender.
        // Gold-only purchases have zero cash value; wallet funding is separate.
        value: order.cashAmountCents / 100,
        currency,
        paidAt: paidAt.toISOString(),
    };
}

module.exports = { purchaseConversion };
