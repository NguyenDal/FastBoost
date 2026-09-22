function checkoutSummary(order, goldRedeemed, goldDiscountCents, cashAmountCents) {
    const cents = (value) => Math.round(Number(value || 0) * 100);
    const addonPriceCents = cents(order.addonPrice);
    const referralDiscountCents = cents(order.referralDiscount);
    const orderAmountCents = order.amountCents || cents(order.totalPrice);
    // Older orders may have no stored pricing breakdown.
    const basePriceCents = Math.max(cents(order.basePrice), orderAmountCents + referralDiscountCents - addonPriceCents);
    return {
        orderId: order.id,
        serviceId: order.serviceId,
        title: order.service?.title || order.boostType || "FastBoost Order",
        game: /^TFT/i.test(order.boostType || order.service?.title || "") ? "tft" : "lol",
        email: order.customer?.email || "",
        currentRank: [order.currentRank, order.currentDivision].filter(Boolean).join(" "),
        targetRank: [order.desiredRank, order.desiredDivision].filter(Boolean).join(" "),
        queueType: order.queueType,
        region: order.region,
        currency: order.currency || process.env.STRIPE_CURRENCY || "cad",
        basePriceCents,
        addonPriceCents,
        saleDiscountCents: Math.max(0, basePriceCents + addonPriceCents - referralDiscountCents - orderAmountCents),
        referralDiscountCents,
        goldRedeemed,
        goldDiscountCents,
        totalCents: cashAmountCents,
    };
}

module.exports = { checkoutSummary };
