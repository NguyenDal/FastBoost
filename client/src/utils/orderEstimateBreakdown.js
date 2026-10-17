const addonLabels = Object.freeze({
    duoMode: 'Duo',
    priorityOrder: 'Express',
    premiumCoaching: 'Coaching',
    soloOnly: 'Solo only',
    highMMRDuo: 'High MMR',
    untrackableDuo: 'Untrackable',
    bonusWin: 'Bonus win',
    championPreference: 'Roles/champions',
    liveStream: 'Stream games',
    appearOffline: 'Appear offline',
});

const cents = value => typeof value === 'number' && Number.isFinite(value)
    ? Math.round((value + Number.EPSILON) * 100) : null;

// Only present the server's quote; rates, eligibility and pricing rules remain
// server-owned. Referral is the existing first-purchase estimate shown by the form.
export function orderEstimateBreakdown(quote, { selections = {}, championPreferenceEnabled = false, referralDiscount = 0 } = {}) {
    if (!quote) return null;
    const baseCents = cents(quote.basePrice);
    const quotedTotalCents = cents(quote.totalPrice);
    if (baseCents === null || quotedTotalCents === null) return null;
    const promotionCents = Number.isSafeInteger(quote.promotion?.amountCents)
        ? quote.promotion.amountCents : cents(quote.saleDiscount) || 0;
    const rows = [{ key: 'base', label: 'Base price', amountCents: baseCents, kind: 'base' }];
    if (promotionCents > 0) {
        const percentage = quote.promotion?.discountPercent > 0 ? ` (${quote.promotion.discountPercent}%)` : '';
        rows.push({ key: 'promotion', label: `${quote.promotion?.title || 'Promotion'}${percentage}`,
            amountCents: -promotionCents, kind: 'discount' });
    }
    const addons = Array.isArray(quote.addons)
        ? quote.addons.filter(row => Number.isSafeInteger(row.amountCents)).map(row => ({
            key: row.key, label: addonLabels[row.key] || 'Add-on', amountCents: row.amountCents, kind: 'addon',
        }))
        : (cents(quote.addonPrice) > 0 ? [{ key: 'addons', label: 'Add-ons', amountCents: cents(quote.addonPrice), kind: 'addon' }] : []);
    // These options are free and do not participate in the pricing request.
    for (const key of ['liveStream', 'appearOffline']) {
        if (selections[key]) addons.push({ key, label: addonLabels[key], amountCents: 0, kind: 'addon' });
    }
    if (championPreferenceEnabled && (Array.isArray(quote.addons) || !(cents(quote.addonPrice) > 0))
        && !addons.some(row => row.key === 'championPreference')) {
        addons.push({ key: 'championPreference', label: addonLabels.championPreference, amountCents: 0, kind: 'addon' });
    }
    rows.push(...addons);
    const referralCents = Math.max(0, Math.min(quotedTotalCents, cents(referralDiscount) || 0));
    if (referralCents > 0) rows.push({ key: 'referral', label: 'Referral discount', amountCents: -referralCents, kind: 'discount' });
    const subtotalCents = quotedTotalCents - referralCents;
    // Independently rounded quote components can differ by a cent. Expose that
    // adjustment rather than changing an add-on, promotion or payable estimate.
    const roundingCents = subtotalCents - rows.reduce((sum, row) => sum + row.amountCents, 0);
    if (roundingCents !== 0) rows.push({ key: 'rounding', label: 'Rounding', amountCents: roundingCents, kind: 'rounding' });
    return { rows, subtotalCents };
}
