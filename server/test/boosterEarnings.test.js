const test = require('node:test');
const assert = require('node:assert/strict');
const { boosterEarnings, EARNINGS_BATCH_SIZE } = require('../src/utils/boosterEarnings');
const { buildEarningsReport } = require('../src/utils/earningsReport');

function matchesWhere(record, where = {}) {
    return Object.entries(where).every(([field, condition]) => {
        if (field === 'OR') return condition.some(branch => matchesWhere(record, branch));
        const value = record[field];
        if (condition === null || typeof condition !== 'object') return value === condition;
        return Object.entries(condition).every(([operator, expected]) => {
            if (operator === 'some') return (value || []).some(row => matchesWhere(row, expected));
            if (operator === 'in') return expected.includes(value);
            if (operator === 'not') return value !== expected;
            if (operator === 'gt') return value > expected;
            assert.fail(`Unsupported fixture filter: ${operator}`);
        });
    });
}

function project(record, select) {
    return Object.fromEntries(Object.entries(select).filter(([, selection]) => selection).map(([field, selection]) => [
        field, selection === true ? structuredClone(record[field]) : (record[field] || [])
            .filter(row => matchesWhere(row, selection.where)).map(row => project(row, selection.select)),
    ]));
}

function fixture(orders) {
    const reads = [];
    const pages = [];
    let transferred = 0;
    const source = orders.map(order => ({ paymentStatus: 'PAID', status: 'COMPLETED', ...order }));
    const db = { order: { findMany: async query => {
        reads.push(query);
        assert.ok(query.take <= EARNINGS_BATCH_SIZE, 'summary reads must remain bounded');
        assert.deepEqual(query.orderBy, { id: 'asc' });
        const page = source.filter(order => matchesWhere(order, query.where))
            .sort((a, b) => a.id.localeCompare(b.id)).slice(0, query.take)
            .map(order => project(order, query.select));
        transferred += page.length;
        pages.push(page);
        return page;
    } } };
    return { db, reads, pages, transferred: () => transferred };
}

const contribution = (boosterId, matches, approved = matches) => ({ boosterId, submittedMatches: matches, approvedMatches: approved });
const match = (boosterId, status = 'APPROVED', queueId = 420, game = 'LOL') => ({ boosterId, status, game, details: { queueId } });

test('bounded summaries match report allocations across batches, currencies, pending claims and rounding', async () => {
    const orders = Array.from({ length: EARNINGS_BATCH_SIZE * 2 + 3 }, (_, i) => ({
        id: String(i).padStart(5, '0'), currency: i % 2 ? 'usd' : 'cad', amountCents: 10001,
        goldDiscountCents: i % 3 ? 2000 : 0, boostType: 'Rank Boost', queueType: 'Solo/Duo',
        matchHistoryEnabled: i % 2 === 0, matchHistoryConfirmedAt: i % 4 ? new Date() : null,
        matches: [match('a'), match('a'), match('b'), match('foreign-queue', 'PENDING', 440),
            match('rejected', 'REJECTED'), match(null), match(null, 'PENDING')],
        contributions: [contribution('a', 2), contribution('b', 1)], assignments: [{ boosterId: 'b' }],
    }));
    orders.push({ id: 'missing', currency: 'usd', amountCents: null, contributions: [contribution('a', 1)] });
    orders.push({ id: 'zero', currency: 'usd', amountCents: 0, contributions: [contribution('zero', 1)] });
    orders.push({ id: 'pending', currency: 'usd', amountCents: 1000, contributions: [contribution('a', 1), contribution('b', 1, null)] });
    orders.push({ id: 'unsubmitted', currency: 'usd', amountCents: 1000, contributions: [contribution('a', 1)], assignments: [{ boosterId: 'b' }] });
    orders.push({ id: 'pending-match', currency: 'usd', amountCents: 1000, matchHistoryEnabled: true,
        matchHistoryConfirmedAt: new Date(), boostType: 'Rank Boost', queueType: 'Solo/Duo', matches: [match('a'), match('b', 'PENDING')] });
    const before = structuredClone(orders);
    const all = fixture(orders);
    const expected = buildEarningsReport(orders).boosters;
    assert.deepEqual(await boosterEarnings(all.db), expected);
    assert.equal(all.reads.length, 3);
    assert.equal(all.transferred(), orders.length, 'keyset pages neither repeat nor skip orders');
    assert.deepEqual(all.pages[0][0].matches.map(({ boosterId, status }) => ({ boosterId, status })), [
        { boosterId: 'a', status: 'APPROVED' }, { boosterId: 'a', status: 'APPROVED' },
        { boosterId: 'b', status: 'APPROVED' }, { boosterId: 'foreign-queue', status: 'PENDING' },
    ], 'database filters omit rejected/unclaimed matches and retain pending co-booster evidence');
    const individual = fixture(orders);
    assert.deepEqual(await boosterEarnings(individual.db, 'a'), { a: expected.a });
    assert.deepEqual(orders, before, 'summaries cannot modify evidence');
});

test('personal earnings select former contributors and match claimants, retaining co-booster shares', async () => {
    const orders = [
        { id: 'former', currency: 'usd', amountCents: 101, contributions: [contribution('a', 1), contribution('b', 2)], assignments: [{ boosterId: 'b' }] },
        { id: 'claimed', currency: 'usd', amountCents: 100, matchHistoryEnabled: true, matchHistoryConfirmedAt: new Date(),
            boostType: 'Rank Boost', queueType: 'Solo/Duo', matches: [match('a'), match('b')], assignments: [] },
        ...Array.from({ length: 1000 }, (_, i) => ({ id: `unrelated-${i}`, currency: 'usd', amountCents: 99999, contributions: [contribution('other', 1)] })),
    ];
    const f = fixture(orders);
    assert.deepEqual(await boosterEarnings(f.db, 'a'), { a: { USD: 59 } });
    assert.equal(f.transferred(), 2, 'unrelated site-wide history must never be loaded');
    assert.deepEqual(f.reads[0].where.OR, [
        { assignments: { some: { boosterId: 'a' } } }, { contributions: { some: { boosterId: 'a' } } }, { matches: { some: { boosterId: 'a' } } },
    ]);
    assert.equal(f.reads[0].select.contributions.where, undefined);
    assert.equal(f.reads[0].select.matches.where.boosterId.not, null);
});

test('selected match evidence preserves TFT scope and pending co-booster holds', async () => {
    const confirmed = { id: 'tft-confirmed', currency: 'cad', amountCents: 101, boostType: 'TFT Rank Boost',
        queueType: 'Solo/Duo', matchHistoryEnabled: true, matchHistoryConfirmedAt: new Date(),
        matches: [match('a', 'APPROVED', 1100, 'TFT'), match('b', 'APPROVED', 1100, 'TFT'),
            match('rejected', 'REJECTED', 1100, 'TFT'), match(null, 'PENDING', 1100, 'TFT'),
            match('wrong-queue', 'PENDING', 1150, 'TFT'), match('wrong-game', 'PENDING', 1100, 'LOL')] };
    const pending = { ...confirmed, id: 'tft-pending', amountCents: 99999,
        matches: [...confirmed.matches, match('b', 'PENDING', 1100, 'TFT')] };
    const f = fixture([confirmed, pending,
        { ...confirmed, id: 'unpaid', paymentStatus: 'PENDING' },
        { ...confirmed, id: 'unfinished', status: 'IN_PROGRESS' }]);
    assert.deepEqual(await boosterEarnings(f.db, 'a'), { a: { CAD: 36 } });
    assert.equal(f.transferred(), 2, 'only completed and paid orders count');
    assert.deepEqual(buildEarningsReport([confirmed, pending]).boosters, { a: { CAD: 36 }, b: { CAD: 35 } });
    assert.ok(f.pages.flat().every(order => order.matches.some(row => row.boosterId === 'b')),
        'personal summaries retain co-booster evidence after database projection');
});

test('empty and exact-batch summaries terminate without offset scans', async () => {
    assert.deepEqual(await boosterEarnings(fixture([]).db, 'missing'), {});
    const f = fixture(Array.from({ length: EARNINGS_BATCH_SIZE }, (_, i) => ({ id: String(i).padStart(5, '0'), amountCents: null })));
    assert.deepEqual(await boosterEarnings(f.db), {});
    assert.equal(f.reads.length, 2);
    assert.equal(f.reads[1].where.id.gt, '00099');
    assert.equal(f.reads[1].skip, undefined);
});
