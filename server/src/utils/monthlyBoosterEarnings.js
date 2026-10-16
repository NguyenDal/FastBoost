const { TIME_ZONE, earningsMonth, monthPeriod, previousMonth } = require('./monthlyEarningsPeriod');
const { enabled, unavailable, withEarningsLedgerRead } = require('./boosterEarningsLedger');

function missingLedgerTable(error) {
    const cause = error?.meta?.driverAdapterError?.cause || error?.cause;
    if (![error?.code, error?.meta?.code, cause?.originalCode, cause?.code].some(code => code === 'P2021' || code === '42P01')) return false;
    const tablePattern = /^(?:\w+\.)?BoosterEarnings(?:LedgerState|Balance|Entry)$/;
    return [error?.meta?.table, error?.table, cause?.table].some(table => typeof table === 'string' && tablePattern.test(table.replace(/["`]/g, ''))) ||
        [error?.message, error?.meta?.message, cause?.originalMessage].some(message => typeof message === 'string' && /relation ["`](?:\w+\.)?BoosterEarnings(?:LedgerState|Balance|Entry)["`] does not exist/i.test(message));
}

async function activeState(db) {
    if (!enabled() || !db.boosterEarningsLedgerState || !db.boosterEarningsEntry) throw unavailable();
    try {
        const state = await db.boosterEarningsLedgerState.findUnique({ where: { id: 'global' } });
        if (!state) throw unavailable();
        return state;
    } catch (error) {
        if (missingLedgerTable(error)) throw unavailable();
        throw error;
    }
}

const totalsFrom = rows => [...rows.reduce((totals, row) => totals.set(row.currency, (totals.get(row.currency) || 0) + row.amountCents), new Map())]
    .sort(([a], [b]) => a.localeCompare(b)).map(([currency, amountCents]) => ({ currency, amountCents }));

async function readMonthlyEarnings(db, boosterId, now, currency) {
    const state = await activeState(db);
    try {
        const groups = await db.boosterEarningsEntry.groupBy({ by: ['period', 'kind', 'currency'], where: { boosterId, ...(currency ? { currency } : {}) }, _sum: { amountCents: true } });
        const rows = groups.map(group => ({ ...group, amountCents: group._sum.amountCents || 0 }));
        const month = earningsMonth(now);
        const firstMonth = earningsMonth(new Date(state.activatedAt));
        const reports = [];
        for (let period = previousMonth(month); period >= firstMonth; period = previousMonth(period)) {
            reports.push({ ...monthPeriod(period, now), totals: totalsFrom(rows.filter(row => row.period === period && row.kind !== 'OPENING')) });
        }
        return { ok: true, available: true, timeZone: TIME_ZONE, activatedAt: new Date(state.activatedAt).toISOString(),
            current: { ...monthPeriod(month, now), totals: totalsFrom(rows.filter(row => row.period === month && row.kind !== 'OPENING')) },
            openingBalances: totalsFrom(rows.filter(row => row.kind === 'OPENING')), reports };
    } catch (error) {
        if (missingLedgerTable(error)) throw unavailable();
        throw error;
    }
}

async function readMonthlyEarningsReport(db, boosterId, month, now, allowOpen = false, currency) {
    const period = monthPeriod(month, now);
    if (month > earningsMonth(now)) throw Object.assign(new Error('Earnings are not available for future months.'), { status: 400 });
    if (!period.closed && !allowOpen) throw Object.assign(new Error('Monthly reports are available after the calendar month ends.'), { status: 400 });
    const state = await activeState(db);
    if (month < earningsMonth(new Date(state.activatedAt))) throw Object.assign(new Error('Monthly earnings were not tracked in that month. Earlier confirmed earnings are shown separately as an opening balance.'), { status: 404 });
    try {
        const entries = [];
        let after;
        for (;;) {
            const page = await db.boosterEarningsEntry.findMany({
                where: { boosterId, period: month, kind: { not: 'OPENING' }, ...(currency ? { currency } : {}), ...(after ? { OR: [
                    { recognizedAt: { gt: after.recognizedAt } }, { recognizedAt: after.recognizedAt, id: { gt: after.id } },
                ] } : {}) },
                select: { id: true, orderId: true, orderNumber: true, serviceTitle: true, currency: true, amountCents: true, kind: true, recognizedAt: true },
                orderBy: [{ recognizedAt: 'asc' }, { id: 'asc' }], take: 250,
            });
            entries.push(...page);
            if (page.length < 250) break;
            after = page[page.length - 1];
        }
        return { ok: true, available: true, timeZone: TIME_ZONE, activatedAt: new Date(state.activatedAt).toISOString(), period,
            ...(!period.closed ? { asOf: now.toISOString() } : {}),
            totals: totalsFrom(entries), entries: entries.map(entry => ({ ...entry, recognizedAt: new Date(entry.recognizedAt).toISOString() })) };
    } catch (error) {
        if (missingLedgerTable(error)) throw unavailable();
        throw error;
    }
}

const loadMonthlyEarnings = (db, boosterId, options = {}) => withEarningsLedgerRead(db, (tx, now) => readMonthlyEarnings(tx, boosterId, now, options.currency), options);
const loadMonthlyEarningsReport = (db, boosterId, month, options = {}) => withEarningsLedgerRead(db, (tx, now) => readMonthlyEarningsReport(tx, boosterId, month, now, options.allowOpen === true, options.currency), options);

module.exports = { loadMonthlyEarnings, loadMonthlyEarningsReport, missingLedgerTable };
