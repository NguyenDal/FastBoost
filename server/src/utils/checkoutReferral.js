const { expireUnpaidSession } = require('./checkoutCoupon');
const cents = value => Math.round(Number(value || 0) * 100);

// Call only while holding the customer's checkout lock. One discounted draft
// may have a payable session; switching drafts expires the previous one first.
async function enforceCheckoutReferral(db, order, stripe) {
    if (!(Number(order.referralDiscount) > 0 || Number(order.couponOriginalReferralDiscount) > 0)) return null;
    const paid = await db.order.findFirst({ where: { customerId: order.customerId, paymentStatus: 'PAID' }, select: { id: true } });
    if (paid) {
        await expireUnpaidSession(order, stripe);
        const amount = (order.amountCents ?? cents(order.totalPrice)) + cents(order.referralDiscount);
        const data = { referralDiscount: 0, amountCents: amount, totalPrice: amount / 100,
            goldRedeemed: 0, goldDiscountCents: 0, cashAmountCents: amount, stripeCheckoutSessionId: null };
        if (order.couponOriginalAmountCents != null) {
            data.couponOriginalAmountCents = order.couponOriginalAmountCents + cents(order.couponOriginalReferralDiscount);
            data.couponOriginalReferralDiscount = 0;
        }
        Object.assign(order, await db.order.update({ where: { id: order.id }, data }));
        return { title: 'Referral offer updated', message: 'Your first-purchase referral discount has already been used. Please review the updated total.' };
    }
    const others = await db.order.findMany({ where: { customerId: order.customerId, paymentStatus: { not: 'PAID' }, id: { not: order.id } } });
    for (const other of others) {
        if (!(Number(other.referralDiscount) > 0 || Number(other.couponOriginalReferralDiscount) > 0)) continue;
        // A completed Stripe session must settle before the entitlement moves.
        await expireUnpaidSession(other, stripe);
    }
    return null;
}

module.exports = { enforceCheckoutReferral };
