function orderEarnings(order) {
    // amountCents is the discounted service subtotal before gold redemption;
    // Stripe settlement adds redeemed gold back to amount_subtotal when saving it.
    if (!Number.isInteger(order.amountCents)) return null;
    const revenueCents = Math.max(0, order.amountCents - (order.goldDiscountCents || 0));
    const boosterCents = Math.round(revenueCents * 70 / 100);
    const records = new Map((order.contributions || []).map(c => [c.boosterId, c]));
    for (const a of order.assignments || []) if (!records.has(a.boosterId)) records.set(a.boosterId, a);
    const assignments = [...records.values()];
    const ready = assignments.length > 0 && assignments.every(a => Number.isInteger(a.approvedMatches) && a.approvedMatches >= 0 && a.approvedMatches === a.submittedMatches);
    const totalMatches = assignments.reduce((sum, a) => sum + (a.approvedMatches || 0), 0);
    const shares = ready && totalMatches > 0 ? assignments.map(a => ({ boosterId: a.boosterId,
        matches: a.approvedMatches, cents: Math.floor(boosterCents * a.approvedMatches / totalMatches),
        remainder: boosterCents * a.approvedMatches % totalMatches,
    })).sort((a, b) => b.remainder - a.remainder || a.boosterId.localeCompare(b.boosterId)) : [];
    // Largest-remainder allocation conserves every cent without favoring low contributions.
    let remaining = boosterCents - shares.reduce((sum, share) => sum + share.cents, 0);
    for (const share of shares) { if (remaining > 0) { share.cents++; remaining--; } delete share.remainder; }
    return { revenueCents, boosterCents, platformCents: revenueCents - boosterCents, shares };
}
module.exports = { orderEarnings };
