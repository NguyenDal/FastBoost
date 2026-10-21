// Only persisted campaign metadata may label receipts; current promotions must
// never rewrite the description of a customer's historical purchase.
function savedPromotion(order, amountCents) {
    const title = typeof order.promotionTitle === 'string' ? order.promotionTitle.trim() : '';
    const discountPercent = order.promotionPercent == null ? null : Number(order.promotionPercent);
    if (!title || !Number.isSafeInteger(amountCents) || amountCents <= 0 || order.couponSaleId ||
        !Number.isFinite(discountPercent) || discountPercent <= 0 || discountPercent > 100) return null;
    return { title, discountPercent, ...(order.promotionAppliesTo ? { appliesTo: order.promotionAppliesTo } : {}) };
}

function checkoutSummary(order, goldRedeemed = order.goldRedeemed || 0, goldDiscountCents = order.goldDiscountCents || 0,
    cashAmountCents = order.cashAmountCents ?? Math.max(0, (order.amountCents ?? Math.round(Number(order.totalPrice || 0) * 100)) - goldDiscountCents)) {
    const cents = (value) => Math.round(Number(value || 0) * 100);
    const addonPriceCents = cents(order.addonPrice);
    const referralDiscountCents = cents(order.referralDiscount);
    const orderAmountCents = order.amountCents ?? cents(order.totalPrice);
    // Older orders may have no stored pricing breakdown.
    const basePriceCents = Math.max(cents(order.basePrice), (order.couponOriginalAmountCents ?? orderAmountCents) + cents(order.couponOriginalReferralDiscount ?? order.referralDiscount) - addonPriceCents);
    const title = order.boostType || order.service?.title || "FastBoost Order";
    const serviceType = title.replace(/^TFT\s+/i, "");
    const currentRank = serviceType === "Placement Boost" ? order.peakRank : [order.currentRank, order.currentDivision].filter(Boolean).join(" ");
    const targetRank = serviceType === "Rank Boost" ? [order.desiredRank, order.desiredDivision].filter(Boolean).join(" ") : "";
    const quantity = serviceType === "Placement Boost" ? ["Placement Matches", order.placementGames]
        : serviceType === "Win Boost" ? ["Ranked Wins", order.desiredWins]
        : serviceType === "Pro Duo" ? ["Games", order.numberOfGames] : null;
    const details = [[serviceType === "Placement Boost" ? "Peak Rank" : "Current Rank", currentRank], ["Target Rank", targetRank], quantity, ["Queue Type", order.queueType], ["Server / Region", order.region]].filter(row => row && row[1]);
    const summary = {
        orderId: order.id,
        orderNumber: order.orderNumber,
        serviceId: order.serviceId,
        title,
        serviceType,
        details,
        quantity: quantity && quantity[1] ? { label: quantity[0], value: quantity[1] } : null,
        game: /^TFT/i.test(order.boostType || order.service?.title || "") ? "tft" : "lol",
        email: order.customer?.email || "",
        currentRank,
        targetRank,
        queueType: order.queueType,
        region: order.region,
        currency: order.currency || "usd",
        basePriceCents,
        addonPriceCents,
        saleDiscountCents: order.couponSaleId ? 0 : Math.max(0, basePriceCents + addonPriceCents - referralDiscountCents - orderAmountCents),
        promoDiscount: order.couponSaleId ? { title: order.couponTitle, code: order.couponCode, amountCents: order.couponDiscountCents } : null,
        referralDiscountCents,
        goldRedeemed,
        goldDiscountCents,
        totalCents: cashAmountCents,
    };
    summary.priceSummary = {
        currency: summary.currency,
        subtotalCents: summary.basePriceCents + summary.addonPriceCents,
        promotionCents: summary.saleDiscountCents,
        coupon: summary.promoDiscount,
        referralCents: summary.referralDiscountCents,
        goldRedeemed: summary.goldRedeemed,
        goldDiscountCents: summary.goldDiscountCents,
        totalCents: summary.totalCents,
    };
    const promotion = savedPromotion(order, summary.saleDiscountCents);
    if (promotion) summary.priceSummary.promotion = promotion;
    if (order.walletAmountCents > 0) {
        summary.walletAmountCents = order.walletAmountCents;
        summary.walletPurchasedCents = order.walletPurchasedCents || 0;
        summary.walletPromotionalCents = order.walletPromotionalCents || 0;
        summary.paymentMethod = order.walletAmountCents === cashAmountCents ? 'account_balance' : 'wallet_and_card';
        summary.priceSummary.walletAmountCents = order.walletAmountCents;
    }
    return summary;
}

function checkoutTenderSummary(order, goldRedeemed, goldDiscountCents, orderTotalCents, walletAppliedCents = 0, walletAvailableCents = 0) {
    const summary = checkoutSummary(order, goldRedeemed, goldDiscountCents, orderTotalCents);
    const cardAmountCents = Math.max(0, orderTotalCents - walletAppliedCents);
    return { ...summary, orderTotalCents, walletAppliedCents, walletAvailableCents, cardAmountCents, totalCents: cardAmountCents,
        priceSummary: { ...summary.priceSummary, walletAppliedCents, cardAmountCents } };
}

function savedOrderPriceSummary(order) {
    return { ...checkoutSummary(order).priceSummary, adminBreakdown: savedAdminPriceBreakdown(order) };
}

function savedAdminPriceBreakdown(order) {
    const integerCents = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
    const moneyCents = value => typeof value === 'number' && Number.isFinite(value) && value >= 0
        ? integerCents(Math.round(value * 100)) : null;
    const amountCents = integerCents(order.amountCents) ?? moneyCents(order.totalPrice);
    const goldDiscountCents = integerCents(order.goldDiscountCents) ?? 0;
    const subtotalCents = amountCents === null ? null : Math.max(0, amountCents - goldDiscountCents);
    const totalCents = integerCents(order.cashAmountCents) ?? subtotalCents;
    let basePriceCents = moneyCents(order.basePrice);
    let addonPriceCents = moneyCents(order.addonPrice);
    // The schema defaulted old pricing snapshots to zero. A positive service
    // amount is not evidence that it was the original undiscounted base price.
    if (basePriceCents === 0 && (addonPriceCents ?? 0) === 0 && amountCents > 0) {
        basePriceCents = null;
        addonPriceCents = null;
    }
    const referralCents = moneyCents(order.referralDiscount) ?? 0;
    const coupon = order.couponSaleId ? {
        title: order.couponTitle,
        code: order.couponCode,
        amountCents: integerCents(order.couponDiscountCents),
    } : null;
    const grossCents = basePriceCents !== null && addonPriceCents !== null ? basePriceCents + addonPriceCents : null;
    // Promotions are the remaining saved discount. Coupons replace promotions;
    // neither current catalog prices nor pre-coupon referral values are reused.
    const remainingDiscount = grossCents !== null && amountCents !== null ? grossCents - referralCents - amountCents : null;
    const promotionCents = coupon ? 0 : remainingDiscount !== null && remainingDiscount >= 0 ? remainingDiscount : null;
    const itemizedSubtotal = grossCents !== null && promotionCents !== null && (!coupon || coupon.amountCents !== null)
        ? grossCents - promotionCents - (coupon?.amountCents || 0) - referralCents - goldDiscountCents : null;
    const promotion = savedPromotion(order, promotionCents);
    return {
        basePriceCents, addonPriceCents, promotionCents, coupon, referralCents,
        ...(promotion ? { promotion } : {}),
        goldRedeemed: integerCents(order.goldRedeemed) ?? 0, goldDiscountCents,
        subtotalCents,
        // No tax amount is persisted today. Do not classify the difference
        // between Stripe's total and service subtotal as tax without evidence.
        taxCents: null,
        totalCents,
        hasUnitemizedAdjustment: (subtotalCents !== null && totalCents !== null && totalCents !== subtotalCents)
            || (grossCents !== null && subtotalCents !== null && itemizedSubtotal !== subtotalCents),
    };
}

module.exports = { checkoutSummary, checkoutTenderSummary, savedOrderPriceSummary };
