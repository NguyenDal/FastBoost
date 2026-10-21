const { CHECKOUT_LEASE_MS } = require('./checkoutPresence');
const { recoverHeldSession, validateHeldSession, releaseHold, isWalletOnlyHold } = require('./checkoutWallet');
const stripeOptions = { timeout: 8000, maxNetworkRetries: 0 };

async function reconcileFailedWalletCheckout(db, hold, stripe) {
    const session = await recoverHeldSession(hold, stripe);
    if (session.status === 'complete' && session.payment_status === 'paid') return { released: false, paidSession: session };
    if (session.status !== 'complete' || session.payment_status !== 'unpaid') return { released: false, pending: true };
    const intentId = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id;
    if (!intentId) return { released: false, pending: true };
    const intent = await stripe.paymentIntents.retrieve(intentId, {}, stripeOptions);
    const expectedMetadata = hold.stripeParametersJson.payment_intent_data.metadata;
    // A canceled PaymentIntent cannot charge again. A merely failed attempt
    // (requires_payment_method) can still be retried, so its hold stays reserved.
    if (intent.object !== 'payment_intent' || intent.id !== intentId || intent.status !== 'canceled' ||
        intent.currency !== 'usd' || intent.amount !== hold.cashAmountCents - hold.amountCents ||
        intent.livemode !== session.livemode || intent.amount_received !== 0 || intent.amount_capturable !== 0 ||
        !Object.entries(expectedMetadata).every(([key, value]) => intent.metadata?.[key] === value)) return { released: false, pending: true };
    await db.order.updateMany({ where: { id: hold.orderId, customerId: hold.userId, paymentStatus: { not: 'PAID' },
        stripeCheckoutSessionId: session.id }, data: { stripeCheckoutSessionId: null } });
    await db.walletCheckoutHold.deleteMany({ where: { id: hold.id, userId: hold.userId } });
    return { released: true, paid: false };
}

async function abandonWalletHold(db, hold, stripe, now = new Date()) {
    const order = await db.order.findUnique({ where: { id: hold.orderId }, select: { paymentStatus: true } });
    if (order?.paymentStatus === 'PAID') return { released: false, paid: true };
    const views = await db.walletCheckoutPresence.findMany({ where: { orderId: hold.orderId } });
    if (views.some(view => new Date(view.expiresAt).getTime() > now.getTime())) return { released: false, pending: true };
    // Legacy clients with no view ID get a short crash-recovery grace period.
    if (new Date(hold.createdAt).getTime() + CHECKOUT_LEASE_MS > now.getTime()
        && !views.some(view => view.closedAt && new Date(view.closedAt).getTime() >= new Date(hold.createdAt).getTime())) return { released: false, pending: true };
    await db.walletCheckoutPresence.updateMany({ where: { orderId: hold.orderId, closedAt: null }, data: { closedAt: now, expiresAt: now } });
    if (isWalletOnlyHold(hold)) { await releaseHold(db, hold, null); return { released: true, paid: false }; }
    let session = await recoverHeldSession(hold, stripe);
    if (session.status === 'complete') return session.payment_status === 'paid'
        ? { released: false, paidSession: session } : reconcileFailedWalletCheckout(db, hold, stripe);
    if (session.status === 'open' && session.payment_status === 'unpaid') {
        const intentId = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id;
        if (intentId) {
            const intent = await stripe.paymentIntents.retrieve(intentId, {}, stripeOptions);
            if (['processing', 'succeeded', 'requires_capture'].includes(intent.status)) return { released: false, pending: true };
        }
        try { session = await stripe.checkout.sessions.expire(session.id, {}, stripeOptions); }
        catch { session = await stripe.checkout.sessions.retrieve(session.id, {}, stripeOptions); }
        validateHeldSession(hold, session);
    }
    if (session.status === 'complete' && session.payment_status === 'paid') return { released: false, paidSession: session };
    if (session.status !== 'expired' || session.payment_status !== 'unpaid') return { released: false, pending: true };
    await releaseHold(db, hold, session);
    return { released: true, paid: false };
}

async function abandonOwnedWalletHolds(db, userId, stripe, now = new Date()) {
    const holds = await db.walletCheckoutHold.findMany({ where: { userId } });
    const paid = [];
    for (const initial of holds) {
        await db.$queryRaw`SELECT id FROM "Order" WHERE id = ${initial.orderId} FOR UPDATE`;
        const hold = await db.walletCheckoutHold.findUnique({ where: { id: initial.id } });
        if (!hold) continue;
        try {
            const outcome = await abandonWalletHold(db, hold, stripe, now);
            if (outcome.paidSession) paid.push({ orderId: hold.orderId, userId: hold.userId, session: outcome.paidSession });
        } catch (error) { console.error('[Wallet checkout cleanup] Deferred:', error.code || error.name); }
    }
    return paid;
}

async function sweepAbandonedWalletCheckouts(prisma, stripe, settlePaid, now = new Date(), cursorState = {}) {
    const candidates = await prisma.walletCheckoutHold.findMany({
        where: { order: { walletCheckoutPresences: { none: { expiresAt: { gt: now } } } },
            ...(cursorState.after ? { OR: [{ createdAt: { gt: cursorState.after.createdAt } },
                { createdAt: cursorState.after.createdAt, id: { gt: cursorState.after.id } }] } : {}) },
        take: 25, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { id: true, userId: true, orderId: true, createdAt: true },
    });
    // Advance even when Stripe cannot yet resolve an older hold. Deleted rows do
    // not invalidate this value cursor, and deferred holds cannot starve others.
    cursorState.after = candidates.length === 25 ? { id: candidates.at(-1).id, createdAt: candidates.at(-1).createdAt } : null;
    for (const candidate of candidates) {
        try {
            const outcome = await prisma.$transaction(async db => {
                await db.$queryRaw`SELECT id FROM "User" WHERE id = ${candidate.userId} FOR UPDATE`;
                await db.$queryRaw`SELECT id FROM "Order" WHERE id = ${candidate.orderId} FOR UPDATE`;
                const hold = await db.walletCheckoutHold.findUnique({ where: { id: candidate.id } });
                return hold ? abandonWalletHold(db, hold, stripe, now) : {};
            }, { maxWait: 15000, timeout: 30000 });
            if (outcome.paidSession) {
                const order = await prisma.order.findUnique({ where: { id: candidate.orderId } });
                if (order) await settlePaid(order, outcome.paidSession);
            }
        } catch (error) { console.error('[Wallet checkout cleanup] Deferred:', error.code || error.name); }
    }
    await prisma.walletCheckoutPresence.deleteMany({ where: { expiresAt: { lt: new Date(now.getTime() - 24 * 60 * 60 * 1000) } } });
}

function startCheckoutPresenceWorker(prisma, stripe, settlePaid) {
    let busy = false;
    const cursorState = {};
    const run = async () => {
        if (busy) return;
        busy = true;
        try { await sweepAbandonedWalletCheckouts(prisma, stripe, settlePaid, new Date(), cursorState); }
        catch (error) { console.error('[Wallet checkout cleanup] Unavailable:', error.code || error.name); }
        finally { busy = false; }
    };
    void run();
    const timer = setInterval(run, 60 * 1000);
    timer.unref?.();
    return () => clearInterval(timer);
}

module.exports = { abandonWalletHold, abandonOwnedWalletHolds, sweepAbandonedWalletCheckouts, startCheckoutPresenceWorker, reconcileFailedWalletCheckout };
