const cashbackRates = new Set([3, 5, 10, 15]);

// Mirror the wallet's cent rounding, using only a ready server quote and the
// customer's current rate. Checkout can still change the amount paid or tier.
export function orderCashbackEstimate({ totalCents, cashbackPercent, eligible }) {
    if (!eligible || !cashbackRates.has(cashbackPercent)
        || !Number.isSafeInteger(totalCents) || totalCents <= 0 || totalCents > 2147483647) return null;
    const amountCents = Math.round(totalCents * cashbackPercent / 100);
    return amountCents > 0 ? amountCents : null;
}
