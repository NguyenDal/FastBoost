const dateValue = value => {
    if (value == null) return null;
    const timestamp = new Date(value).getTime();
    return Number.isFinite(timestamp) ? timestamp : null;
};
const wholeOrderScopes = new Set(['TOTAL', 'ORDER_TOTAL', 'WHOLE_ORDER', 'WHOLE_ORDER_TOTAL']);

// Legacy orders saved monetary amounts, but not their automatic campaign ID or
// label. This is a conservative read-time match, never a rewritten price snapshot.
// Edited/deleted campaign history cannot be recovered from current records.
async function historicalOrderPromotion(db, order, breakdown) {
    const createdAt = dateValue(order.createdAt);
    if (createdAt === null || typeof order.serviceId !== 'string' || !order.serviceId || order.couponSaleId
        || !Number.isSafeInteger(breakdown?.promotionCents) || breakdown.promotionCents <= 0
        || !Number.isSafeInteger(breakdown.basePriceCents) || breakdown.basePriceCents < 0
        || !Number.isSafeInteger(breakdown.addonPriceCents) || breakdown.addonPriceCents < 0) return null;

    try {
        const campaigns = await db.serviceSale.findMany({
            where: { couponCode: null, createdAt: { lte: new Date(createdAt) }, OR: [
                { scope: 'SERVICE', serviceId: order.serviceId }, { scope: 'GLOBAL', serviceId: null },
            ] },
            select: { title: true, discountPercent: true, appliesTo: true, active: true,
                scope: true, serviceId: true, createdAt: true, updatedAt: true, startsAt: true, endsAt: true },
        });
        // A subsequently edited campaign may previously have had a different
        // window, priority or percentage. Do not pick a surviving alternative.
        if (campaigns.some(campaign => dateValue(campaign.updatedAt) === null || dateValue(campaign.updatedAt) > createdAt)) return null;
        const applicable = campaigns.filter(campaign => {
            const started = dateValue(campaign.startsAt);
            const ended = dateValue(campaign.endsAt);
            const created = dateValue(campaign.createdAt);
            return campaign.active === true && created !== null && created <= createdAt
                && (campaign.startsAt == null || (started !== null && started <= createdAt))
                && (campaign.endsAt == null || (ended !== null && ended >= createdAt));
        });
        // Service promotions take precedence over global promotions at creation.
        // Multiple eligible campaigns remain generic rather than guessing which
        // was selected near a time boundary or among equal timestamps.
        const serviceCampaigns = applicable.filter(campaign => campaign.scope === 'SERVICE' && campaign.serviceId === order.serviceId);
        const candidates = serviceCampaigns.length ? serviceCampaigns
            : applicable.filter(campaign => campaign.scope === 'GLOBAL' && campaign.serviceId == null);
        if (candidates.length !== 1) return null;
        const campaign = candidates[0];
        const percent = Number(campaign.discountPercent);
        if (!Number.isFinite(percent)) return null;
        const discountPercent = Math.min(90, Math.max(0, percent));
        const title = typeof campaign.title === 'string' ? campaign.title.trim() : '';
        if (!title || !Number.isFinite(discountPercent) || discountPercent <= 0) return null;
        const appliesTo = String(campaign.appliesTo || 'BASE_PRICE').toUpperCase();
        if (appliesTo !== 'BASE_PRICE' && !wholeOrderScopes.has(appliesTo)) return null;
        const sourceCents = breakdown.basePriceCents + (wholeOrderScopes.has(appliesTo) ? breakdown.addonPriceCents : 0);
        const expectedDiscount = Math.round((sourceCents / 100 * discountPercent / 100 + Number.EPSILON) * 100);
        if (expectedDiscount !== breakdown.promotionCents) return null;
        return { title, discountPercent, source: 'historical_match' };
    } catch {
        // Optional labels must not make a saved order unreadable. A lookup error
        // leaves its recorded amounts and the generic Promotion label intact.
        return null;
    }
}

module.exports = { historicalOrderPromotion };
