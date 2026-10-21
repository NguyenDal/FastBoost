export function getSaleDisplayStatus(sale, nowMs = Date.now()) {
    if (!sale?.active) return 'NONE';
    const endsAt = sale.endsAt ? new Date(sale.endsAt).getTime() : null;
    if (endsAt !== null && endsAt <= nowMs) return 'EXPIRED';
    const startsAt = sale.startsAt ? new Date(sale.startsAt).getTime() : null;
    return startsAt !== null && startsAt > nowMs ? 'SCHEDULED' : 'ACTIVE';
}

export function isCurrentSale(sale, nowMs = Date.now()) {
    return ['ACTIVE', 'SCHEDULED'].includes(getSaleDisplayStatus(sale, nowMs));
}
