const MONEY_FIELDS = ['revenueCents', 'platformCents', 'boosterCents', 'confirmedBoosterCents', 'unallocatedCents'];
const monthFormatter = new Intl.DateTimeFormat('en', { month: 'short', year: 'numeric', timeZone: 'UTC' });
const count = value => Number.isInteger(value) && value > 0 ? value : 0;
const cents = value => Number.isInteger(value) && value >= 0 ? value : 0;
const hasAmount = row => row.amountKnown === true && Number.isInteger(row.revenueCents) && row.revenueCents >= 0;
const average = (amount, denominator) => denominator > 0 ? Math.round(amount / denominator) : null;
const monthNumber = day => Number(day.slice(0, 4)) * 12 + Number(day.slice(5, 7)) - 1;

function validDay(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function paidDay(value) {
    if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString().slice(0, 10) : null;
    if (typeof value !== 'string' || !validDay(value.slice(0, 10))) return null;
    const parsed = new Date(value.length === 10 ? `${value}T00:00:00.000Z` : value);
    return Number.isFinite(parsed.getTime()) ? parsed.toISOString().slice(0, 10) : null;
}

/** Count-only orders require each involved booster's submission to be reviewed.
 * Individual-history orders instead review the submitted match evidence.
 */
export function earningsApprovalProgress(row) {
    if (row.reviewMode !== 'contributions') {
        const total = count(row.matchCounts?.submitted);
        const hasSavedMatches = total > 0 || ['total', 'approved', 'pending', 'rejected', 'unsubmitted'].some(field => count(row.matchCounts?.[field]) > 0);
        const boosterCount = new Set((row.boosters || []).map(booster => booster.id).filter(Boolean)).size;
        // Before any evidence is saved, show the people still owing a submission.
        // An assignment establishes no played or approved matches.
        if (!hasSavedMatches && boosterCount) return { approved: 0, total: boosterCount,
            unit: boosterCount === 1 ? 'booster' : 'boosters', pending: 0, returned: 0 };
        return { approved: count(row.matchCounts?.approved), total, unit: total === 1 ? 'match' : 'matches',
            pending: count(row.matchCounts?.pending), returned: count(row.matchCounts?.rejected) };
    }
    const records = new Map((row.contributions || []).filter(record => record.boosterId).map(record => [record.boosterId, record]));
    const boosterIds = new Set([...(row.boosters || []).map(booster => booster.id), ...records.keys()].filter(Boolean));
    let approved = 0, pending = 0, returned = 0;
    for (const record of records.values()) {
        if (Number.isInteger(record.approvedMatches) && record.approvedMatches >= 0 && record.approvedMatches === record.submittedMatches) approved++;
        else if (record.reviewedAt && record.approvedMatches == null) returned++;
        else pending++;
    }
    return { approved, total: boosterIds.size, unit: boosterIds.size === 1 ? 'booster' : 'boosters', pending, returned };
}

/** This is a completed-and-paid cohort. Dates consistently refer to UTC payment dates. */
export function filterEarningsRows(rows, { currency = '', from = '', to = '' } = {}) {
    if ((from && !validDay(from)) || (to && !validDay(to)) || (from && to && from > to)) return [];
    const selectedCurrency = String(currency).trim().toUpperCase();
    return rows.filter(row => {
        if (selectedCurrency && String(row.currency).toUpperCase() !== selectedCurrency) return false;
        if (!from && !to) return true;
        const day = paidDay(row.paidAt);
        return day !== null && (!from || day >= from) && (!to || day <= to);
    });
}

/** Call after selecting one currency; unknown money never becomes an invented zero. */
export function summarizeEarnings(rows) {
    const summary = Object.fromEntries(MONEY_FIELDS.map(field => [field, 0]));
    Object.assign(summary, { orderCount: rows.length, pricedOrderCount: 0, missingAmounts: 0,
        confirmedOrders: 0, reviewOrders: 0, pendingMatches: 0, readyOrders: 0 });
    const boosters = new Set();
    for (const row of rows) {
        if (row.reviewStatus === 'CONFIRMED') summary.confirmedOrders++;
        else summary.reviewOrders++;
        if (row.reviewStatus === 'READY_TO_CONFIRM') summary.readyOrders++;
        summary.pendingMatches += count(row.matchCounts?.pending);
        if (!hasAmount(row)) { summary.missingAmounts++; continue; }
        summary.pricedOrderCount++;
        for (const field of MONEY_FIELDS) summary[field] += cents(row[field]);
        for (const share of row.shares || []) if (share.boosterId && count(share.matches)) boosters.add(share.boosterId);
    }
    summary.boosterCount = boosters.size;
    summary.averageOrderCents = average(summary.revenueCents, summary.pricedOrderCount);
    summary.averageBoosterCents = average(summary.confirmedBoosterCents, summary.boosterCount);
    return summary;
}

/** Calendar-month average for the selected period, including months without sales.
 * Unbounded periods run from the first priced payment through the current month.
 * Unknown amounts and undated payments cannot contribute to monthly revenue.
 */
export function averageMonthlyRevenue(rows, { from = '', to = '', today = new Date().toISOString().slice(0, 10) } = {}) {
    if ((from && !validDay(from)) || (to && !validDay(to)) || !validDay(today) || (from && to && from > to)) return null;
    const dated = filterEarningsRows(rows, { from, to }).filter(hasAmount)
        .map(row => ({ row, day: paidDay(row.paidAt) })).filter(entry => entry.day);
    if (!dated.length) return from && to ? 0 : null;
    const first = from || dated.reduce((day, entry) => entry.day < day ? entry.day : day, dated[0].day);
    const last = to || dated.reduce((day, entry) => entry.day > day ? entry.day : day, today);
    const months = monthNumber(last) - monthNumber(first) + 1;
    return average(dated.reduce((sum, { row }) => sum + row.revenueCents, 0), months);
}

/** Each booster keeps only their own allocation; shared order revenue is never attributed here. */
export function summarizeBoosters(rows, directory = []) {
    const boosters = new Map();
    function getBooster(id, identity) {
        if (!id) return null;
        if (!boosters.has(id)) boosters.set(id, { id, name: 'Unknown booster', username: '',
            confirmedCents: 0, pendingCents: 0, matches: 0, orders: new Set(), confirmed: new Set(), pending: new Set() });
        const booster = boosters.get(id);
        if (identity?.username) booster.username = identity.username;
        if (identity?.displayName || identity?.username) booster.name = identity.displayName || identity.username;
        return booster;
    }
    for (const person of directory) getBooster(person.id, { username: person.username, displayName: person.profile?.displayName || person.displayName });
    for (const row of rows) {
        for (const identity of row.boosters || []) getBooster(identity.id, identity)?.orders.add(row.id);
        for (const share of row.shares || []) {
            const booster = getBooster(share.boosterId);
            if (!booster) continue;
            booster.orders.add(row.id);
            if (!hasAmount(row) || !count(share.matches)) continue;
            booster.confirmed.add(row.id);
            booster.confirmedCents += cents(share.cents);
            booster.matches += count(share.matches);
        }
        for (const share of row.estimatedShares || []) {
            const booster = getBooster(share.boosterId);
            if (!booster) continue;
            booster.orders.add(row.id);
            if (!hasAmount(row) || !count(share.matches)) continue;
            booster.pending.add(row.id);
            booster.pendingCents += cents(share.cents);
        }
    }
    return [...boosters.values()].map(({ orders, confirmed, pending, ...booster }) => ({ ...booster,
        orderCount: orders.size, confirmedOrders: confirmed.size, pendingOrders: pending.size,
        avgOrderCents: average(booster.confirmedCents, confirmed.size), avgMatchCents: average(booster.confirmedCents, booster.matches),
    })).sort((a, b) => b.confirmedCents - a.confirmedCents || b.pendingCents - a.pendingCents || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

/** Up to six calendar payment months, ending at the latest priced payment and preserving gaps. */
export function buildMonthlyRevenue(rows) {
    const dated = rows.filter(hasAmount).map(row => ({ row, day: paidDay(row.paidAt) })).filter(entry => entry.day);
    if (!dated.length) return [];
    const months = dated.map(entry => monthNumber(entry.day));
    const latest = Math.max(...months);
    const earliest = Math.max(Math.min(...months), latest - 5);
    const buckets = new Map();
    for (let month = earliest; month <= latest; month++) {
        const key = `${Math.floor(month / 12).toString().padStart(4, '0')}-${(month % 12 + 1).toString().padStart(2, '0')}`;
        buckets.set(key, { key, label: monthFormatter.format(new Date(`${key}-01T00:00:00.000Z`)),
            revenueCents: 0, platformCents: 0, boosterCents: 0, orderCount: 0 });
    }
    for (const { row, day } of dated) {
        const bucket = buckets.get(day.slice(0, 7));
        if (!bucket) continue;
        for (const field of ['revenueCents', 'platformCents', 'boosterCents']) bucket[field] += cents(row[field]);
        bucket.orderCount++;
    }
    return [...buckets.values()];
}

/** Quote every cell and make untrusted spreadsheet formula prefixes literal text. */
export function toCsv(headers, rows) {
    const cell = value => {
        let text = value == null ? '' : String(value);
        if (typeof value === 'string' && /^[\s\uFEFF]*[=+\-@]/u.test(text)) text = `'${text}`;
        return `"${text.replace(/"/g, '""')}"`;
    };
    return `\uFEFF${[headers, ...rows].map(row => row.map(cell).join(',')).join('\r\n')}\r\n`;
}
