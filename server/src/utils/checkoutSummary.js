function checkoutSummary(order, goldRedeemed, goldDiscountCents, cashAmountCents) {
    const cents = (value) => Math.round(Number(value || 0) * 100);
    const addonPriceCents = cents(order.addonPrice);
    const referralDiscountCents = cents(order.referralDiscount);
    const orderAmountCents = order.amountCents || cents(order.totalPrice);
    // Older orders may have no stored pricing breakdown.
    const basePriceCents = Math.max(cents(order.basePrice), orderAmountCents + referralDiscountCents - addonPriceCents);
    const title = order.boostType || order.service?.title || "FastBoost Order";
    const serviceType = title.replace(/^TFT\s+/i, "");
    const currentRank = serviceType === "Placement Boost" ? order.peakRank : [order.currentRank, order.currentDivision].filter(Boolean).join(" ");
    const targetRank = serviceType === "Rank Boost" ? [order.desiredRank, order.desiredDivision].filter(Boolean).join(" ") : "";
    const quantity = serviceType === "Placement Boost" ? ["Placement Matches", order.placementGames]
        : serviceType === "Win Boost" ? ["Ranked Wins", order.desiredWins]
        : serviceType === "Pro Duo" ? ["Games", order.numberOfGames] : null;
    const details = [[serviceType === "Placement Boost" ? "Peak Rank" : "Current Rank", currentRank], ["Target Rank", targetRank], quantity, ["Queue Type", order.queueType], ["Server / Region", order.region]].filter(row => row && row[1]);
    return {
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
