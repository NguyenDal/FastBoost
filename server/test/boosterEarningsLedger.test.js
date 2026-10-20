const test = require('node:test');
const assert = require('node:assert/strict');
const { withEarningsLedgerMutation, initializeEarningsLedger } = require('../src/utils/boosterEarningsLedger');
const { orderEarnings } = require('../src/utils/earnings');
const { fixture, order, enable } = require('../test-helpers/monthlyEarningsFixture');

const october = new Date('2026-10-16T12:00:00Z');
const november = new Date('2026-11-01T06:00:00Z');
const mutate = (f, id, action, now = october) => f.db.$transaction(tx => withEarningsLedgerMutation(tx, id, action, { clock: () => now }));

test('disabled ledger bypasses schema and activation is explicit', async t => {
    enable(t); process.env.BOOSTER_MONTHLY_EARNINGS_ENABLED = 'false';
    assert.equal(await withEarningsLedgerMutation({ order: { findUnique: async () => null } }, 'order', async () => 42), 42);
    await assert.rejects(initializeEarningsLedger({}), /Enable BOOSTER_MONTHLY/);
});

test('activation preserves legacy confirmed allocations as undated opening balances exactly once', async t => {
    enable(t);
    const f = fixture([order(), order('pending', { status: 'IN_PROGRESS' }), order('unpaid', { paymentStatus: 'PENDING' })]);
    const expected = orderEarnings(f.state.orders[0]).shares;
    const activation = await initializeEarningsLedger(f.db, { now: october });
    assert.equal(activation.openingEntries, 2);
    assert.deepEqual(f.state.entries.map(entry => [entry.boosterId, entry.currency, entry.amountCents]), expected.map(share => [share.boosterId, 'USD', share.cents]));
    assert.ok(f.state.entries.every(entry => entry.kind === 'OPENING' && entry.period === null));
    assert.equal((await initializeEarningsLedger(f.db, { now: november })).alreadyActive, true);
    assert.equal(f.state.entries.length, 2);
    assert.equal(+f.state.activation.activatedAt, +october);
});

test('new paid completion recognizes only fully approved 70% allocations and retries stay idempotent', async t => {
    enable(t);
    const f = fixture([order('new', { status: 'IN_PROGRESS' })]);
    await initializeEarningsLedger(f.db, { now: october });
    const complete = () => { f.state.orders[0].status = 'COMPLETED'; return 'completed'; };
    assert.deepEqual(await Promise.all([mutate(f, 'new', complete), mutate(f, 'new', complete)]), ['completed', 'completed']);
    assert.equal(f.state.entries.length, 2);
    assert.equal(f.state.entries.reduce((sum, entry) => sum + entry.amountCents, 0), Math.round((10001 - 2000) * .7));
    assert.ok(f.state.entries.every(entry => entry.period === '2026-10' && entry.kind === 'EARNED'));
});

test('late approvals post in approval month while reopened history becomes a current-month adjustment', async t => {
    enable(t);
    const pending = order('late'); pending.contributions[1].approvedMatches = null;
    const f = fixture([pending]);
    await initializeEarningsLedger(f.db, { now: october });
    await mutate(f, 'late', async () => {}, october);
    assert.equal(f.state.entries.length, 0);
    await mutate(f, 'late', () => { f.state.orders[0].contributions[1].approvedMatches = 1; }, november);
    assert.ok(f.state.entries.every(entry => entry.period === '2026-11'));
    const credited = structuredClone(f.state.entries);
    await mutate(f, 'late', () => { f.state.orders[0].contributions[0].approvedMatches = null; }, new Date('2026-12-01T06:00:00Z'));
    assert.deepEqual(f.state.entries.slice(0, 2), credited, 'closed entries remain immutable');
    assert.ok(f.state.entries.slice(2).every(entry => entry.period === '2026-12' && entry.kind === 'ADJUSTMENT' && entry.amountCents < 0));
    assert.ok(f.state.balances.every(balance => balance.amountCents === 0));
});

test('currency changes reverse the original currency and credit the new currency without conversion', async t => {
    enable(t);
    const f = fixture([order()]); await initializeEarningsLedger(f.db, { now: october });
    await mutate(f, 'order', () => { f.state.orders[0].currency = 'cad'; }, november);
    const adjustments = f.state.entries.filter(entry => entry.kind !== 'OPENING');
    assert.equal(adjustments.length, 4);
    assert.equal(adjustments.filter(entry => entry.currency === 'USD').reduce((sum, entry) => sum + entry.amountCents, 0), -5601);
    assert.equal(adjustments.filter(entry => entry.currency === 'CAD').reduce((sum, entry) => sum + entry.amountCents, 0), 5601);
});

test('ledger failure rolls back its associated status mutation and partial allocations', async t => {
    enable(t);
    const f = fixture([order('new', { status: 'IN_PROGRESS' })]); await initializeEarningsLedger(f.db, { now: october });
    f.state.failEntry = true;
    await assert.rejects(mutate(f, 'new', () => { f.state.orders[0].status = 'COMPLETED'; }), /synthetic ledger/);
    assert.equal(f.state.orders[0].status, 'IN_PROGRESS'); assert.equal(f.state.entries.length, 0); assert.equal(f.state.balances.length, 0);
});

test('TFT confirmed history preserves queue scope and a reopen reverses the previous earned share', async t => {
    enable(t);
    const f = fixture([order('tft', { boostType: 'TFT Rank Boost', matchHistoryEnabled: true, matchHistoryConfirmedAt: null,
        assignments: [], contributions: [], matches: [
            { boosterId: 'a', game: 'TFT', details: { queueId: 1100 }, status: 'APPROVED' },
            { boosterId: 'b', game: 'TFT', details: { queueId: 1150 }, status: 'PENDING' },
        ] })]);
    await initializeEarningsLedger(f.db, { now: october });
    await mutate(f, 'tft', () => { f.state.orders[0].matchHistoryConfirmedAt = october; });
    assert.deepEqual(f.state.entries.map(entry => [entry.boosterId, entry.amountCents]), [['a', 5601]]);
    await mutate(f, 'tft', () => { f.state.orders[0].matchHistoryConfirmedAt = null; }, november);
    assert.equal(f.state.entries.at(-1).amountCents, -5601);
});

test('deleted orders reverse recognized balances using their preserved statement labels', async t => {
    enable(t);
    const f = fixture([order()]); await initializeEarningsLedger(f.db, { now: october });
    await mutate(f, 'order', () => { f.state.orders = []; }, november);
    assert.ok(f.state.entries.slice(2).every(entry => entry.amountCents < 0 && entry.orderNumber === 'TEST-order'));
});
