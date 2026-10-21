const { randomUUID } = require('node:crypto');
const stripeOptions = { timeout: 8000, maxNetworkRetries: 0 };
const walletError = (code, message, status = 409) => Object.assign(new Error(message), { code, status });
const unavailable = () => walletError('WALLET_CHECKOUT_PENDING', 'Your existing wallet payment is being confirmed. Please check that payment before changing it.');
const isWalletOnlyHold = hold => Boolean(hold?.stripeParametersJson?.walletOnly === true && hold.amountCents === hold.cashAmountCents && !hold.stripeCheckoutSessionId);

function validateHeldSession(hold, session) {
    const quote = hold.stripeParametersJson;
    const metadata = session?.metadata || {};
    const configuredMode = /^(?:sk|rk)_(live|test)_/.exec(process.env.STRIPE_SECRET_KEY || '')?.[1];
    if (!session || session.object !== 'checkout.session' || session.mode !== 'payment' || session.ui_mode !== 'elements' ||
        session.currency !== 'usd' || session.amount_subtotal !== hold.cashAmountCents - hold.amountCents ||
        session.amount_total !== session.amount_subtotal || typeof session.livemode !== 'boolean' ||
        (configuredMode && session.livemode !== (configuredMode === 'live')) ||
        (hold.stripeCheckoutSessionId && hold.stripeCheckoutSessionId !== session.id) ||
        metadata.walletHoldId !== hold.id || metadata.orderId !== hold.orderId || metadata.customerId !== hold.userId ||
        metadata.walletAppliedCents !== String(hold.amountCents) || metadata.orderTotalCents !== String(hold.cashAmountCents) ||
        metadata.cashAmountCents !== String(hold.cashAmountCents - hold.amountCents) ||
        metadata.goldRedeemed !== String(hold.goldRedeemed) || metadata.goldDiscountCents !== String(hold.goldDiscountCents) ||
        metadata.couponCode !== quote.metadata.couponCode) {
        throw walletError('WALLET_QUOTE_CHANGED', 'The saved wallet checkout could not be verified. Please contact support.', 400);
    }
}

async function recoverHeldSession(hold, stripe) {
    if (isWalletOnlyHold(hold)) return null;
    let session;
    if (hold.stripeCheckoutSessionId) session = await stripe.checkout.sessions.retrieve(hold.stripeCheckoutSessionId, {}, stripeOptions);
    else {
        // The immutable absolute expiry also prevents an old pruned Stripe key
        // from accidentally creating a second payable session after a restart.
        if (Date.now() - new Date(hold.createdAt).getTime() > 23 * 60 * 60 * 1000) {
            throw walletError('WALLET_CHECKOUT_REVIEW_REQUIRED', 'An earlier wallet checkout needs support review before its reserved funds can be changed.');
        }
        const created = await stripe.checkout.sessions.create(hold.stripeParametersJson,
            { ...stripeOptions, idempotencyKey: `wallet-checkout-v1-${hold.id}` });
        session = await stripe.checkout.sessions.retrieve(created.id, {}, stripeOptions);
    }
    validateHeldSession(hold, session);
    return session;
}

async function releaseHold(db, hold, session) {
    if (isWalletOnlyHold(hold)) {
        if (session != null) throw walletError('WALLET_QUOTE_CHANGED', 'A wallet-only reservation has no card checkout.', 400);
        return db.walletCheckoutHold.deleteMany({ where: { id: hold.id, userId: hold.userId } });
    }
    validateHeldSession(hold, session);
    if (session.status !== 'expired' || session.payment_status !== 'unpaid') throw unavailable();
    return db.walletCheckoutHold.deleteMany({ where: { id: hold.id, userId: hold.userId } });
}

async function closeHeldCheckout(db, hold, stripe) {
    if (isWalletOnlyHold(hold)) { await releaseHold(db, hold, null); return null; }
    let session = await recoverHeldSession(hold, stripe);
    if (session.status === 'open' && session.payment_status === 'unpaid') {
        try { session = await stripe.checkout.sessions.expire(session.id, {}, stripeOptions); }
        catch { session = await stripe.checkout.sessions.retrieve(session.id, {}, stripeOptions); }
        validateHeldSession(hold, session);
    }
    await releaseHold(db, hold, session);
    return session;
}

async function releaseExpiredWalletHolds(db, userId, stripe) {
    const holds = await db.walletCheckoutHold.findMany({ where: { userId } });
    for (const hold of holds) {
        if (Number(hold.stripeParametersJson?.expires_at) * 1000 > Date.now()) continue;
        if (isWalletOnlyHold(hold)) { await releaseHold(db, hold, null); continue; }
        // Unknown old creates remain held for review; never replay a pruned key.
        if (!hold.stripeCheckoutSessionId) continue;
        const session = await recoverHeldSession(hold, stripe);
        if (session.status === 'expired' && session.payment_status === 'unpaid') await releaseHold(db, hold, session);
    }
}

function heldStripeParameters(order, hold, clientUrl) {
    const cardAmount = hold.cashAmountCents - hold.amountCents;
    const metadata = { editableEmail: '1', orderNumber: order.orderNumber, orderId: order.id, customerId: order.customerId,
        goldRedeemed: String(hold.goldRedeemed), goldDiscountCents: String(hold.goldDiscountCents),
        cashAmountCents: String(cardAmount), walletAppliedCents: String(hold.amountCents), orderTotalCents: String(hold.cashAmountCents),
        walletHoldId: hold.id, couponCode: order.couponCode || '' };
    if (cardAmount === 0) return { walletOnly: true, expires_at: Math.floor(Date.now() / 1000) + 23 * 60 * 60, metadata };
    return {
        mode: 'payment', ui_mode: 'elements', payment_method_types: ['card', 'link'],
        adaptive_pricing: { enabled: false }, automatic_tax: { enabled: false },
        expires_at: Math.floor(Date.now() / 1000) + 23 * 60 * 60,
        line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: cardAmount,
            product_data: { name: order.service?.title || order.boostType || 'FastBoost Order', description: `Order #${order.orderNumber}` } } }],
        metadata,
        return_url: `${clientUrl}/checkout/${order.id}?session_id={CHECKOUT_SESSION_ID}`,
        payment_intent_data: { metadata: { orderId: order.id, orderNumber: order.orderNumber, couponCode: order.couponCode || '', walletHoldId: hold.id } },
    };
}

async function reserveWalletCheckout(db, wallet, order, { amountCents, cashAmountCents, goldRedeemed, goldDiscountCents, clientUrl }) {
    const available = await wallet.spendable(db, order.customerId);
    if (available.frozen) throw walletError('WALLET_FROZEN', 'Your wallet is on hold. Please contact support before using it.');
    if (amountCents > available.availableBalanceCents) throw walletError('WALLET_INSUFFICIENT', 'Your available wallet balance does not cover this amount. Please review your balance.');
    const purchasedCents = Math.min(available.availablePurchasedCents, amountCents);
    const hold = { id: randomUUID(), userId: order.customerId, orderId: order.id, amountCents,
        purchasedCents, promotionalCents: amountCents - purchasedCents, cashAmountCents,
        orderAmountCents: order.amountCents ?? Math.round(Number(order.totalPrice || 0) * 100), goldRedeemed, goldDiscountCents };
    return db.walletCheckoutHold.create({ data: { ...hold, stripeParametersJson: heldStripeParameters(order, hold, clientUrl) } });
}

module.exports = { validateHeldSession, recoverHeldSession, releaseHold, closeHeldCheckout,
    releaseExpiredWalletHolds, reserveWalletCheckout, unavailable, walletError, isWalletOnlyHold };
