function normalizeGoldToUse(rawGoldToUse, availableGold, totalAmountCents) {
    let requestedGold = Math.floor(Number(rawGoldToUse || 0));

    if (!Number.isFinite(requestedGold) || requestedGold < 0) {
        requestedGold = 0;
    }

    requestedGold = availableGold >= 100 ? Math.min(requestedGold, availableGold) : 0;

    // 1 gold = $0.10 = 10 cents
    const maxRedeemableGoldByOrder = Math.floor(totalAmountCents / 10);
    requestedGold = Math.min(requestedGold, maxRedeemableGoldByOrder);

    let discountCents = requestedGold * 10;
    let cashAmountCents = Math.max(0, totalAmountCents - discountCents);

    // Stripe card payments cannot be too tiny.
    // If remaining cash is below $0.50, reduce redemption enough to make cash valid,
    // unless gold fully covers the order.
    if (cashAmountCents > 0 && cashAmountCents < 50 && requestedGold > 0) {
        const neededCentsBack = 50 - cashAmountCents;
        const goldToRemove = Math.ceil(neededCentsBack / 10);

        requestedGold = Math.max(0, requestedGold - goldToRemove);
        discountCents = requestedGold * 10;
        cashAmountCents = Math.max(0, totalAmountCents - discountCents);
    }

    return {
        goldRedeemed: requestedGold,
        goldDiscountCents: discountCents,
        cashAmountCents,
    };
}

module.exports = { normalizeGoldToUse };
