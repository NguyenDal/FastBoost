export function formatOrderTotal(order) {
    const summary = order?.priceSummary;
    if (!Number.isFinite(summary?.totalCents)) return '—';
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: summary.currency || 'USD' }).format(summary.totalCents / 100);
}
