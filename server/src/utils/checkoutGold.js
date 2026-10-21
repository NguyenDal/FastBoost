const { stripeOptions, expireUnpaidSession } = require('./checkoutCoupon');
const { recoverHeldSession, isWalletOnlyHold } = require('./checkoutWallet');

const unavailable = () => Object.assign(new Error('Could not safely move Gold from another checkout. Please try again shortly.'), {
    status: 503, code: 'GOLD_CHECKOUT_UNAVAILABLE',
});
const confirming = () => Object.assign(new Error('Gold is applied to another payment that is being confirmed. Please wait for that payment before using Gold again.'), {
    status: 409, code: 'GOLD_CHECKOUT_IN_PROGRESS',
});

// Call under lockCheckout's customer lock. A Stripe checkout is payable after
// its database transaction ends, so serializing requests alone cannot reserve
// Gold. Expire other payable sessions before transferring their Gold to a draft.
async function releaseOtherGoldCheckouts(db, order, stripe) {
    const others = await db.order.findMany({
        where: { customerId: order.customerId, id: { not: order.id }, paymentStatus: { not: 'PAID' }, goldRedeemed: { gt: 0 } },
        select: { id: true, stripeCheckoutSessionId: true, amountCents: true, totalPrice: true,
            goldRedeemed: true, goldDiscountCents: true },
    });
    const sessions = [];
    // Inspect every session before expiring any: a completed payment needs to
    // settle its existing Gold allocation, even if its webhook has not arrived.
    for (const other of others) {
        let session;
        const hold = await db.walletCheckoutHold.findUnique({ where: { orderId: other.id } });
        if ((hold && !isWalletOnlyHold(hold)) || other.stripeCheckoutSessionId) {
            if (hold) session = await recoverHeldSession(hold, stripe);
            else {
                try { session = await stripe.checkout.sessions.retrieve(other.stripeCheckoutSessionId, {}, stripeOptions); }
                catch { throw unavailable(); }
            }
            if (session?.status === 'complete' || session?.payment_status === 'paid') throw confirming();
            if (!session || !['open', 'expired'].includes(session.status)) throw unavailable();
        }
        sessions.push({ other, session, hold });
    }
    for (const { other, session, hold } of sessions) {
        if (hold) await expireUnpaidSession(other, stripe, db);
        else if (session?.status === 'open') {
            // If confirmation wins the race, Stripe rejects expiration. Keep
            // the old allocation and fail this transaction instead of reusing it.
            try { await stripe.checkout.sessions.expire(other.stripeCheckoutSessionId, {}, stripeOptions); }
            catch { throw unavailable(); }
        }
        const result = await db.order.updateMany({
            where: { id: other.id, paymentStatus: { not: 'PAID' },
                stripeCheckoutSessionId: other.stripeCheckoutSessionId,
                goldRedeemed: other.goldRedeemed, goldDiscountCents: other.goldDiscountCents },
            data: { goldRedeemed: 0, goldDiscountCents: 0,
                cashAmountCents: other.amountCents ?? Math.round(Number(other.totalPrice || 0) * 100) },
        });
        if (result.count !== 1) throw unavailable();
    }
}

module.exports = { releaseOtherGoldCheckouts };
