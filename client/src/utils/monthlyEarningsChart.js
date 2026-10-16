const currencyCode = value => typeof value === 'string' ? value.trim().toUpperCase() : '';
const amount = value => Number.isFinite(value) ? value : 0;

export function chronologicalMonths(summary) {
    const months = new Map();
    for (const period of [...(summary?.reports || []), summary?.current]) {
        if (period && /^\d{4}-(0[1-9]|1[0-2])$/.test(period.month)) months.set(period.month, period);
    }
    return [...months.values()].sort((a, b) => a.month.localeCompare(b.month));
}

export function monthAmount(month, currency) {
    const code = currencyCode(currency);
    if (!code) return 0;
    return (month?.totals || []).reduce((sum, total) => currencyCode(total.currency) === code ? sum + amount(total.amountCents) : sum, 0);
}

export function chartCurrencies(months) {
    return [...new Set(months.flatMap(month => (month.totals || []).map(total => currencyCode(total.currency))).filter(Boolean))].sort();
}

// Page zero shows the most recent months; each page reads oldest to newest.
export function monthWindow(months, { page = 0, size = 6 } = {}) {
    const pageSize = Number.isFinite(size) && size >= 1 ? Math.floor(size) : 6;
    const totalPages = Math.max(1, Math.ceil(months.length / pageSize));
    const currentPage = Math.min(totalPages - 1, Math.max(0, Number.isFinite(page) ? Math.floor(page) : 0));
    const end = Math.max(0, months.length - currentPage * pageSize);
    return { months: months.slice(Math.max(0, end - pageSize), end), page: currentPage, totalPages,
        hasOlder: currentPage < totalPages - 1, hasNewer: currentPage > 0 };
}

// Positions are percentages measured from the bottom. A bar's bottom is the
// smaller of baseline/position(value), and its height is their absolute gap.
export function chartScale(values) {
    const finite = values.filter(Number.isFinite);
    const min = Math.min(0, ...finite);
    const max = Math.max(0, ...finite) || (min === 0 ? 1 : 0);
    const position = value => Math.max(0, Math.min(100, (amount(value) - min) / (max - min) * 100));
    return { min, max, baseline: position(0), position };
}
