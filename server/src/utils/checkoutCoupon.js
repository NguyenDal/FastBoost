const stripeOptions = { timeout: 8000, maxNetworkRetries: 0 };
const cents = value => Math.round(Number(value || 0) * 100);
const couponError = message => Object.assign(new Error(message), { status: 400, code: "COUPON_UNAVAILABLE" });

// All checkout, payment and cancellation mutations take this lock first.
// This also serializes different drafts belonging to the same customer.
async function lockCheckout(db, accountId, orderId) {
    await db.$queryRaw`SELECT id FROM "User" WHERE id = ${accountId} FOR UPDATE`;
    await db.$queryRaw`SELECT id FROM "Order" WHERE id = ${orderId} FOR UPDATE`;
}

async function mutateCheckoutOrder(prisma, order, stripe, mutation, expire = true) {
    return prisma.$transaction(async db => {
        await lockCheckout(db, order.customerId, order.id);
        const current = await db.order.findUnique({ where: { id: order.id } });
        if (!current) return null;
        if (expire) await expireUnpaidSession(current, stripe);
        return mutation(db, current);
    }, { maxWait: 15000, timeout: 30000 });
}

async function expireUnpaidSession(order, stripe) {
    if (!order.stripeCheckoutSessionId || order.paymentStatus === "PAID") return;
    const session = await stripe.checkout.sessions.retrieve(order.stripeCheckoutSessionId, {}, stripeOptions);
    if (session.status === "complete") throw couponError("A payment is already being confirmed for this order. Please wait for confirmation before making changes.");
    if (session.status === "open") await stripe.checkout.sessions.expire(session.id, {}, stripeOptions);
}

function originalPricing(order) {
    const amount = order.couponOriginalAmountCents ?? order.amountCents ?? cents(order.totalPrice);
    const referral = cents(order.couponOriginalReferralDiscount ?? order.referralDiscount);
    const addons = cents(order.addonPrice);
    const base = Math.max(cents(order.basePrice), amount + referral - addons);
    return { amount, referral, addons, base, sale: Math.max(0, base + addons - referral - amount) };
}

function couponPricing(order, percent) {
    const original = originalPricing(order);
    const discount = Math.round(original.base * Number(percent) / 100);
    const subtotal = Math.max(0, original.base + original.addons - discount);
    // Preserve the existing referral percentage, applied after the winning discount.
    const referral = original.referral && original.amount + original.referral > 0
        ? Math.round(subtotal * original.referral / (original.amount + original.referral)) : 0;
    return { ...original, discount, newReferral: referral, total: Math.max(0, subtotal - referral) };
}

function restoredCouponFields(order) {
    const { amount, referral } = originalPricing(order);
    return { couponSaleId: null, couponCode: null, couponTitle: null, couponDiscountCents: 0,
        couponOriginalAmountCents: null, couponOriginalReferralDiscount: null,
        amountCents: amount, totalPrice: amount / 100, referralDiscount: referral / 100 };
}

// Claims protect payable Stripe sessions, but usedAt stays null until verified PAID.
// An unpaid claim can move to a different draft after its old session is expired.
async function claimCoupon(db, order, sale, stripe) {
    const claim = await db.couponUse.findUnique({ where: { accountId_saleId: { accountId: order.customerId, saleId: sale.id } }, include: { order: true } });
    if (claim?.usedAt) throw couponError("You have already used this coupon. It becomes available again if that order is cancelled.");
    let moved = false;
    if (claim && claim.orderId !== order.id) {
        await expireUnpaidSession(claim.order, stripe);
        await db.order.update({ where: { id: claim.orderId }, data: restoredCouponFields(claim.order) });
        await db.couponUse.delete({ where: { id: claim.id } });
        moved = true;
    }
    if (!claim || moved) await db.couponUse.create({ data: { accountId: order.customerId, saleId: sale.id, orderId: order.id } });
    return moved;
}

async function applyCheckoutCoupon(db, order, input, stripe, now = new Date()) {
    const explicit = input !== undefined;
    if (explicit && input !== null && typeof input !== "string") throw couponError("Please enter a valid coupon code.");
    const code = explicit ? String(input || "").trim().toUpperCase() : order.couponCode;
    if (!code && !order.couponSaleId) return null;
    let sale, unavailable;
    if (code) {
        if (!/^[A-Z0-9][A-Z0-9-]{3,31}$/.test(code)) throw couponError("Please check your coupon code and try again.");
        sale = await db.serviceSale.findUnique({ where: { couponCode: code } });
        unavailable = !sale || !sale.active ? "This coupon is not available. Please check the code or try another coupon."
            : sale.recipientAccountId && sale.recipientAccountId !== order.customerId ? "This coupon is reserved for another account."
            : sale.startsAt && new Date(sale.startsAt) > now ? "This coupon is not active yet."
            : sale.endsAt && new Date(sale.endsAt) <= now ? "This coupon has expired."
            : sale.scope !== "GLOBAL" && sale.serviceId !== order.serviceId ? "This coupon does not apply to this service." : null;
        if (!unavailable) {
            const claim = await db.couponUse.findUnique({ where: { accountId_saleId: { accountId: order.customerId, saleId: sale.id } } });
            if (claim?.usedAt) unavailable = "You have already used this coupon. It becomes available again if that order is cancelled.";
            // Refreshing an expired draft must not steal a coupon from another
            // checkout. The customer can explicitly Apply it again if desired.
            else if (!explicit && claim && claim.orderId !== order.id) unavailable = "This coupon is applied to another checkout.";
        }
        if (unavailable && explicit) throw couponError(unavailable);
    }
    if (!code || unavailable) {
        await expireUnpaidSession(order, stripe);
        await db.couponUse.deleteMany({ where: { orderId: order.id, usedAt: null } });
        Object.assign(order, await db.order.update({ where: { id: order.id }, data: restoredCouponFields(order) }));
        return { title: unavailable ? "Coupon no longer available" : "Coupon removed", message: unavailable ? `${unavailable} We have restored your original price. Please review your total.` : "Your original price has been restored. The coupon has not been used." };
    }
    const pricing = couponPricing(order, sale.discountPercent);
    if (order.couponSaleId && order.couponSaleId !== sale.id && pricing.discount <= order.couponDiscountCents) {
        return { title: "Your current coupon gives you the better price", message: "We kept your existing coupon because it gives an equal or larger discount. Coupons do not stack." };
    }
    if (pricing.discount <= pricing.sale) {
        return { title: "Your sale gives you the better price", message: "Your existing sale discount is equal to or larger than this coupon. We kept the sale price. Discounts do not stack, and this coupon has not been used." };
    }
    if (pricing.total < 50) throw couponError("This coupon cannot be applied to this order total. Please try another coupon.");
    if (order.couponSaleId && order.couponSaleId !== sale.id) await db.couponUse.deleteMany({ where: { orderId: order.id, usedAt: null } });
    const moved = await claimCoupon(db, order, sale, stripe);
    if (order.couponSaleId !== sale.id || order.couponDiscountCents !== pricing.discount) await expireUnpaidSession(order, stripe);
    Object.assign(order, await db.order.update({ where: { id: order.id }, data: {
        couponSaleId: sale.id, couponCode: sale.couponCode, couponTitle: sale.title,
        couponDiscountCents: pricing.discount, couponOriginalAmountCents: pricing.amount,
        couponOriginalReferralDiscount: pricing.referral / 100,
        amountCents: pricing.total, totalPrice: pricing.total / 100, referralDiscount: pricing.newReferral / 100,
    } }));
    if (!explicit && !moved) return null;
    return { title: "Coupon applied", message: `${sale.title} has been applied.${pricing.sale ? " It replaces your sale discount because it saves you more. Discounts do not stack." : ""}${moved ? " This coupon was moved from your other unpaid checkout; refresh that checkout before paying there." : ""} It will count as used only after payment succeeds.` };
}

module.exports = { lockCheckout, mutateCheckoutOrder, expireUnpaidSession, originalPricing, couponPricing, restoredCouponFields, applyCheckoutCoupon, stripeOptions };
