export function formatOrderTotal(order) {
    const summary = order?.priceSummary;
    if (!Number.isFinite(summary?.totalCents)) return '—';
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: summary.currency || 'CAD' }).format(summary.totalCents / 100);
}
