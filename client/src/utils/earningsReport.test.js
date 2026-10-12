import test from 'node:test';
import assert from 'node:assert/strict';
import { filterEarningsRows, summarizeEarnings, summarizeBoosters, buildMonthlyRevenue, averageMonthlyRevenue, toCsv } from './earningsReport.js';

function order(overrides = {}) {
    return { id: 'one', currency: 'CAD', paidAt: '2026-10-01T12:00:00.000Z', amountKnown: true,
        revenueCents: 10000, platformCents: 3000, boosterCents: 7000, confirmedBoosterCents: 7000, unallocatedCents: 0,
        reviewStatus: 'CONFIRMED', matchCounts: { pending: 0 }, boosters: [{ id: 'a', username: 'alpha', displayName: 'Alpha' }],
        shares: [{ boosterId: 'a', matches: 10, cents: 7000 }], estimatedShares: [], ...overrides };
}

test('monthly average includes selected empty months, crosses years, and excludes unknown and undated payments', () => {
    const rows = [order({ paidAt: '2025-12-15', revenueCents: 6000 }), order({ paidAt: '2026-02-10', revenueCents: 3000 }),
        order({ paidAt: null }), order({ amountKnown: false })];
    assert.equal(averageMonthlyRevenue(rows, { today: '2026-03-12' }), 2250);
    assert.equal(averageMonthlyRevenue(rows, { from: '2025-11-01', to: '2026-02-28' }), 2250);
    assert.equal(averageMonthlyRevenue(rows, { from: '2026-02-01', to: '2026-02-28' }), 3000);
    assert.equal(averageMonthlyRevenue(rows, { from: '2026-01-01', to: '2026-01-31' }), 0);
    assert.equal(averageMonthlyRevenue(rows, { from: '2026-02-30' }), null);
    assert.equal(averageMonthlyRevenue([order({ paidAt: null })]), null);
    assert.equal(averageMonthlyRevenue([order({ revenueCents: 0 })], { today: '2026-10-12' }), 0);
    assert.equal(averageMonthlyRevenue([], { today: '2026-10-12' }), null);
});

test('booster directory includes names before anyone has earnings and retains former contributors', () => {
    const result = summarizeBoosters([order()], [{ id: 'new', username: 'NewBooster', profile: { displayName: 'New Booster' } }]);
    assert.equal(result.length, 2);
    const newcomer = result.find(person => person.id === 'new');
    assert.equal(newcomer.name, 'New Booster');
    assert.equal(newcomer.confirmedCents, 0);
    assert.equal(newcomer.orderCount, 0);
    assert.equal(newcomer.avgOrderCents, null);
    assert.equal(result.find(person => person.id === 'a').confirmedCents, 7000);
});

test('currency and inclusive UTC payment date filters never mix currencies or drop boundary days', () => {
    const rows = [order({ id: 'before', paidAt: '2026-09-30T23:59:59.999Z' }), order({ id: 'start', paidAt: '2026-10-01T00:00:00.000Z' }),
        order({ id: 'end', paidAt: '2026-10-31T23:59:59.999Z' }), order({ id: 'after', paidAt: '2026-11-01T00:00:00.000Z' }),
        order({ id: 'usd', currency: 'USD' }), order({ id: 'offset', paidAt: '2026-09-30T21:00:00-05:00' })];
    assert.deepEqual(filterEarningsRows(rows, { currency: 'cad', from: '2026-10-01', to: '2026-10-31' }).map(row => row.id), ['start', 'end', 'offset']);
    assert.equal(filterEarningsRows(rows, { currency: 'USD' }).length, 1);
    assert.equal(filterEarningsRows(rows, { from: '2026-11-01' }).length, 1);
    assert.equal(filterEarningsRows(rows, { to: '2026-09-30' }).length, 1);
});

test('invalid or missing payment dates remain visible only without date bounds; invalid filters fail closed', () => {
    const rows = [order(), order({ id: 'undated', paidAt: null }), order({ id: 'invalid', paidAt: 'not a date' }),
        order({ id: 'rollover', paidAt: '2026-02-30T00:00:00.000Z' })];
    assert.equal(filterEarningsRows(rows).length, 4);
    assert.deepEqual(filterEarningsRows(rows, { from: '2026-01-01' }).map(row => row.id), ['one']);
    for (const filter of [{ from: '2026-02-30' }, { to: 'tomorrow' }, { from: '2026-10-02', to: '2026-10-01' }]) {
        assert.deepEqual(filterEarningsRows(rows, filter), []);
    }
});

test('report counts shared revenue once and bases averages on eligible priced orders and confirmed participants', () => {
    const rows = [order({ shares: [{ boosterId: 'a', matches: 9, cents: 6300 }, { boosterId: 'b', matches: 1, cents: 700 }, { boosterId: 'zero', matches: 0, cents: 0 }] }),
        order({ id: 'gold', revenueCents: 0, platformCents: 0, boosterCents: 0, confirmedBoosterCents: 0, shares: [{ boosterId: 'a', matches: 2, cents: 0 }] }),
        order({ id: 'unknown', amountKnown: false, revenueCents: null, platformCents: null, boosterCents: null, confirmedBoosterCents: null,
            reviewStatus: 'NEEDS_REVIEW', shares: [], matchCounts: { pending: 4 } }),
        order({ id: 'ready', revenueCents: 2000, platformCents: 600, boosterCents: 1400, confirmedBoosterCents: 0, unallocatedCents: 1400,
            reviewStatus: 'READY_TO_CONFIRM', shares: [] })];
    assert.deepEqual(summarizeEarnings(rows), { revenueCents: 12000, platformCents: 3600, boosterCents: 8400,
        confirmedBoosterCents: 7000, unallocatedCents: 1400, orderCount: 4, pricedOrderCount: 3, missingAmounts: 1,
        confirmedOrders: 2, reviewOrders: 2, pendingMatches: 4, readyOrders: 1, boosterCount: 2,
        averageOrderCents: 4000, averageBoosterCents: 3500 });
    assert.equal(summarizeEarnings([]).averageOrderCents, null);
    assert.equal(summarizeEarnings([rows[2]]).averageBoosterCents, null);
    assert.equal(summarizeEarnings([rows[1]]).averageOrderCents, 0);
    assert.equal(summarizeEarnings([rows[1]]).averageBoosterCents, 0);
});

test('per-booster results retain identities and historical shares, separate estimates, and exclude zero-match denominators', () => {
    const rows = [order({ boosters: [{ id: 'a', username: 'alpha', displayName: 'Alpha' }, { id: 'b', username: 'beta' }, { id: 'zero', username: 'Zero' }],
        shares: [{ boosterId: 'a', matches: 9, cents: 6300 }, { boosterId: 'b', matches: 1, cents: 700 }, { boosterId: 'zero', matches: 0, cents: 0 }] }),
        order({ id: 'second', shares: [{ boosterId: 'a', matches: 2, cents: 7000 }], boosters: [] }),
        order({ id: 'pending', reviewStatus: 'NEEDS_REVIEW', confirmedBoosterCents: 0, shares: [],
            boosters: [{ id: 'a', username: 'alpha', displayName: 'Alpha' }, { id: 'pending-only', username: 'new' }],
            estimatedShares: [{ boosterId: 'a', matches: 2, cents: 3500 }, { boosterId: 'pending-only', matches: 2, cents: 3500 }] }),
        order({ id: 'unknown', amountKnown: false, shares: [], boosters: [{ id: 'unpaid', username: 'Unpriced' }] })];
    const result = summarizeBoosters(rows);
    assert.deepEqual(result.find(row => row.id === 'a'), { id: 'a', name: 'Alpha', username: 'alpha', confirmedCents: 13300, pendingCents: 3500,
        matches: 11, orderCount: 3, confirmedOrders: 2, pendingOrders: 1, avgOrderCents: 6650, avgMatchCents: 1209 });
    assert.equal(result.find(row => row.id === 'b').confirmedCents, 700);
    assert.equal(result.find(row => row.id === 'zero').confirmedOrders, 0);
    assert.equal(result.find(row => row.id === 'zero').avgOrderCents, null);
    assert.equal(result.find(row => row.id === 'zero').avgMatchCents, null);
    assert.equal(result.find(row => row.id === 'pending-only').confirmedCents, 0);
    assert.equal(result.find(row => row.id === 'pending-only').pendingCents, 3500);
    assert.equal(result.find(row => row.id === 'unpaid').orderCount, 1);
    assert.equal(result.find(row => row.id === 'unpaid').avgOrderCents, null);
    assert.equal(result.reduce((sum, row) => sum + row.confirmedCents, 0), 14000);
});

test('zero-cash confirmed work remains a counted booster order and match with zero averages', () => {
    const result = summarizeBoosters([order({ revenueCents: 0, shares: [{ boosterId: 'a', matches: 3, cents: 0 }] })])[0];
    assert.equal(result.confirmedOrders, 1);
    assert.equal(result.matches, 3);
    assert.equal(result.avgOrderCents, 0);
    assert.equal(result.avgMatchCents, 0);
});

test('monthly revenue uses at most six calendar months with empty gaps and excludes unknown or undated money', () => {
    const rows = [order({ id: 'old', paidAt: '2025-12-01T00:00:00Z' }), order({ id: 'march', paidAt: '2026-03-01T00:00:00Z' }),
        order({ id: 'may', paidAt: '2026-05-10T00:00:00Z' }), order({ id: 'may2', paidAt: '2026-05-31T23:59:59Z' }),
        order({ id: 'gold', paidAt: '2026-05-01T00:00:00Z', revenueCents: 0, platformCents: 0, boosterCents: 0 }),
        order({ id: 'unknown', paidAt: '2026-10-01T00:00:00Z', amountKnown: false }), order({ id: 'undated', paidAt: null })];
    const result = buildMonthlyRevenue(rows);
    assert.deepEqual(result.map(month => month.key), ['2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05']);
    assert.deepEqual(result[1], { key: '2026-01', label: 'Jan 2026', revenueCents: 0, platformCents: 0, boosterCents: 0, orderCount: 0 });
    assert.equal(result[5].revenueCents, 20000);
    assert.equal(result[5].orderCount, 3);
    assert.equal(buildMonthlyRevenue([order()]).length, 1);
    assert.deepEqual(buildMonthlyRevenue([rows[5], rows[6]]), []);
    const longer = buildMonthlyRevenue([order({ paidAt: '2025-01-01' }), order({ paidAt: '2026-10-01' })]);
    assert.equal(longer[0].key, '2026-05');
    assert.equal(longer.length, 6);
});

test('CSV includes BOM, quotes and CRLF, preserves normal cells and neutralizes untrusted formulas', () => {
    const csv = toCsv(['Name', 'Amount'], [['Booster, "A"', 1200], ['=HYPERLINK("https://bad")', '-4'], ['   +SUM(1,2)', -4],
        ['\t@SUM(1,2)', null], ['\r\n  -1+1', 'line\nnext'], ['Normal', 0]]);
    assert.ok(csv.startsWith('\uFEFF"Name","Amount"\r\n'));
    assert.ok(csv.includes('"Booster, ""A""","1200"'));
    assert.ok(csv.includes('"\'=HYPERLINK(""https://bad"")","\'-4"'));
    assert.ok(csv.includes('"\'   +SUM(1,2)","-4"'));
    assert.ok(csv.includes('"\'\t@SUM(1,2)",""'));
    assert.ok(csv.includes('"\'\r\n  -1+1","line\nnext"'));
    assert.ok(csv.endsWith('"Normal","0"\r\n'));
    assert.equal(toCsv(['=Header'], []), '\uFEFF"\'=Header"\r\n');
});
