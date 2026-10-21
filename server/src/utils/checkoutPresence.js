const { walletError } = require('./checkoutWallet');
const CHECKOUT_LEASE_MS = 4 * 60 * 1000;
const validViewId = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

function assertViewId(viewId) {
    if (!validViewId(viewId)) throw walletError('WALLET_VIEW_ID', 'A valid checkout view is required.', 400);
}

async function renewCheckoutPresence(db, userId, orderId, viewId, { create = false, paymentInProgress, now = new Date() } = {}) {
    assertViewId(viewId);
    const previous = await db.walletCheckoutPresence.findUnique({ where: { id: viewId } });
    if (previous && (previous.userId !== userId || previous.orderId !== orderId)) throw walletError('WALLET_VIEW_ID', 'This checkout view is unavailable.', 404);
    if (previous?.closedAt) throw walletError('WALLET_VIEW_CLOSED', 'This checkout view has closed. Refresh the checkout to continue.');
    if (previous && new Date(previous.expiresAt).getTime() <= now.getTime()) throw walletError('WALLET_VIEW_EXPIRED', 'This checkout view expired. Refresh the checkout to continue.');
    if (!previous && !create) throw walletError('WALLET_VIEW_MISSING', 'Refresh the checkout before continuing.');
    const expiresAt = new Date(now.getTime() + CHECKOUT_LEASE_MS);
    const data = { expiresAt, paymentProtectedUntil: paymentInProgress === true ? expiresAt : paymentInProgress === false ? null : previous?.paymentProtectedUntil || null };
    return previous ? db.walletCheckoutPresence.update({ where: { id: viewId }, data })
        : db.walletCheckoutPresence.create({ data: { id: viewId, userId, orderId, ...data } });
}

async function closeCheckoutPresence(db, userId, orderId, viewId, { paymentInProgress = false, now = new Date() } = {}) {
    assertViewId(viewId);
    const previous = await db.walletCheckoutPresence.findUnique({ where: { id: viewId } });
    if (previous && (previous.userId !== userId || previous.orderId !== orderId)) throw walletError('WALLET_VIEW_ID', 'This checkout view is unavailable.', 404);
    if (previous?.closedAt) return previous;
    const protectedUntil = paymentInProgress ? new Date(now.getTime() + CHECKOUT_LEASE_MS) : previous?.paymentProtectedUntil;
    const expiresAt = protectedUntil && new Date(protectedUntil).getTime() > now.getTime() ? new Date(protectedUntil) : now;
    const data = { closedAt: now, expiresAt, paymentProtectedUntil: protectedUntil || null };
    // A tombstone also closes a quote request that has not registered yet.
    return previous ? db.walletCheckoutPresence.update({ where: { id: viewId }, data })
        : db.walletCheckoutPresence.create({ data: { id: viewId, userId, orderId, ...data } });
}

module.exports = { CHECKOUT_LEASE_MS, assertViewId, renewCheckoutPresence, closeCheckoutPresence };
