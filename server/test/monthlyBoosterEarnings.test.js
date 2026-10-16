const test = require('node:test');
const assert = require('node:assert/strict');
const { earningsMonth, monthPeriod, previousMonth } = require('../src/utils/monthlyEarningsPeriod');
const { loadMonthlyEarnings, loadMonthlyEarningsReport } = require('../src/utils/monthlyBoosterEarnings');
const { initializeEarningsLedger, withEarningsLedgerMutation } = require('../src/utils/boosterEarningsLedger');
const { fixture, order, enable } = require('../test-helpers/monthlyEarningsFixture');

test('Winnipeg month boundaries handle winter, summer, DST, and year rollover', () => {
    assert.equal(earningsMonth(new Date('2026-11-01T04:59:59Z')), '2026-10');
    assert.equal(earningsMonth(new Date('2026-11-01T05:00:00Z')), '2026-11');
    assert.equal(monthPeriod('2026-03').startsAt, '2026-03-01T06:00:00.000Z');
    assert.equal(monthPeriod('2026-03').endsAt, '2026-04-01T05:00:00.000Z');
    assert.equal(monthPeriod('2026-11').endsAt, '2026-12-01T06:00:00.000Z');
    assert.equal(previousMonth('2026-01'), '2025-12');
    for (const invalid of ['2026-13', '2026-2', '../../secret', '', null]) assert.throws(() => monthPeriod(invalid), error => error.status === 400);
});

test('monthly totals exclude opening balances, remain personal, and archive empty closed months', async t => {
    enable(t);
    const f = fixture([order('legacy'), order('new', { status: 'IN_PROGRESS', currency: 'cad' })]);
    await initializeEarningsLedger(f.db, { now: new Date('2026-09-01T12:00:00Z') });
    await f.db.$transaction(tx => withEarningsLedgerMutation(tx, 'new', async () => { f.state.orders[1].status = 'COMPLETED'; }, { clock: () => new Date('2026-11-02T12:00:00Z') }));
    const summary = await loadMonthlyEarnings(f.db, 'a', { now: new Date('2026-11-02T13:00:00Z') });
    assert.equal(summary.current.month, '2026-11');
    assert.deepEqual(summary.current.totals, [{ currency: 'CAD', amountCents: 3734 }]);
    assert.deepEqual(summary.openingBalances, [{ currency: 'USD', amountCents: 3734 }]);
    assert.deepEqual(summary.reports.map(report => [report.month, report.totals]), [['2026-10', []], ['2026-09', []]]);
    assert.ok(f.state.reads.every(read => read.where.boosterId === 'a'));
    assert.deepEqual((await loadMonthlyEarnings(f.db, 'missing', { now: new Date('2026-11-02T13:00:00Z') })).current.totals, []);
});

test('closed reports keep all bounded pages and never include another booster or opening balances', async t => {
    enable(t);
    const f = fixture(); f.state.activation = { id: 'global', activatedAt: new Date('2026-09-01T12:00:00Z') };
    for (let index = 0; index < 503; index++) f.state.entries.push({ id: String(index).padStart(6, '0'), boosterId: 'a', orderId: `order-${index}`, orderNumber: `TEST-${index}`, serviceTitle: 'Win Boost',
        kind: 'EARNED', period: '2026-10', currency: index % 2 ? 'USD' : 'CAD', amountCents: 1, recognizedAt: new Date('2026-10-16T12:00:00Z') });
    f.state.entries.push({ ...f.state.entries[0], id: 'other', boosterId: 'b', amountCents: 99999 });
    const options = { now: new Date('2026-11-01T05:00:00Z') };
    await assert.rejects(loadMonthlyEarningsReport(f.db, 'a', '2026-10', { now: new Date('2026-11-01T04:59:59.999Z') }), error => error.status === 400);
    assert.equal(f.state.reads.length, 0, 'October remains open until midnight in Winnipeg');
    const report = await loadMonthlyEarningsReport(f.db, 'a', '2026-10', options);
    assert.equal(report.entries.length, 503); assert.equal(f.state.reads.length, 3);
    assert.deepEqual(report.totals, [{ currency: 'CAD', amountCents: 252 }, { currency: 'USD', amountCents: 251 }]);
    await assert.rejects(loadMonthlyEarningsReport(f.db, 'a', '2026-11', options), error => error.status === 400);
    const current = await loadMonthlyEarningsReport(f.db, 'a', '2026-11', { ...options, allowOpen: true });
    assert.equal(current.period.closed, false);
    assert.equal(current.asOf, options.now.toISOString());
    assert.deepEqual(current.entries, []);
    assert.equal(report.asOf, undefined, 'closed periods retain their fixed report content');
    await assert.rejects(loadMonthlyEarningsReport(f.db, 'a', '2026-12', { ...options, allowOpen: true }), error => error.status === 400);
    await assert.rejects(loadMonthlyEarningsReport(f.db, 'a', '2026-08', options), error => error.status === 404);
});

test('USD reporting filters totals, opening balances and entries without modifying or converting other currencies', async t => {
    enable(t);
    const f = fixture(); f.state.activation = { id: 'global', activatedAt: new Date('2026-10-01T12:00:00Z') };
    for (const [period, kind, usd, cad] of [[null, 'OPENING', 500, 800], ['2026-10', 'EARNED', 100, 700], ['2026-11', 'EARNED', 200, 900]]) {
        for (const [currency, amountCents] of [['USD', usd], ['CAD', cad]]) f.state.entries.push({ id: `${period}-${currency}`, boosterId: 'a', orderId: 'order', orderNumber: 'TEST-USD',
            serviceTitle: 'Win Boost', period, kind, currency, amountCents, recognizedAt: new Date(`${period || '2026-10'}-02T12:00:00Z`) });
    }
    const unchanged = structuredClone(f.state.entries);
    const options = { now: new Date('2026-11-10T12:00:00Z'), currency: 'USD' };
    const summary = await loadMonthlyEarnings(f.db, 'a', options);
    assert.deepEqual(summary.current.totals, [{ currency: 'USD', amountCents: 200 }]);
    assert.deepEqual(summary.openingBalances, [{ currency: 'USD', amountCents: 500 }]);
    assert.deepEqual(summary.reports[0].totals, [{ currency: 'USD', amountCents: 100 }]);
    const report = await loadMonthlyEarningsReport(f.db, 'a', '2026-10', options);
    assert.deepEqual(report.totals, [{ currency: 'USD', amountCents: 100 }]);
    assert.deepEqual(report.entries.map(entry => entry.currency), ['USD']);
    assert.ok(f.state.reads.every(read => read.where.currency === 'USD'));
    const unfiltered = await loadMonthlyEarningsReport(f.db, 'a', '2026-10', { now: options.now });
    assert.deepEqual(unfiltered.totals, [{ currency: 'CAD', amountCents: 700 }, { currency: 'USD', amountCents: 100 }]);
    assert.deepEqual(f.state.entries, unchanged);
});

test('a later correction changes only its actual current month and leaves the old report unchanged', async t => {
    enable(t);
    const f = fixture([order('new', { status: 'IN_PROGRESS' })]);
    await initializeEarningsLedger(f.db, { now: new Date('2026-10-01T12:00:00Z') });
    await f.db.$transaction(tx => withEarningsLedgerMutation(tx, 'new', async () => { f.state.orders[0].status = 'COMPLETED'; }, { clock: () => new Date('2026-10-16T12:00:00Z') }));
    const options = { now: new Date('2026-11-10T12:00:00Z') };
    const before = await loadMonthlyEarningsReport(f.db, 'a', '2026-10', options);
    await f.db.$transaction(tx => withEarningsLedgerMutation(tx, 'new', async () => { f.state.orders[0].status = 'CANCELLED'; }, { clock: () => options.now }));
    assert.deepEqual(await loadMonthlyEarningsReport(f.db, 'a', '2026-10', options), before);
    assert.deepEqual((await loadMonthlyEarnings(f.db, 'a', options)).current.totals, [{ currency: 'USD', amountCents: -3734 }]);
});

test('a month-end report waits for the preceding recognition transaction before reading its closed period', async t => {
    enable(t);
    const f = fixture([order('boundary', { status: 'IN_PROGRESS' })]);
    await initializeEarningsLedger(f.db, { now: new Date('2026-10-01T12:00:00Z') });
    let releaseMutation;
    let mutationStarted;
    const started = new Promise(resolve => { mutationStarted = resolve; });
    const blocked = new Promise(resolve => { releaseMutation = resolve; });
    const mutation = f.db.$transaction(tx => withEarningsLedgerMutation(tx, 'boundary', async () => {
        f.state.orders[0].status = 'COMPLETED'; mutationStarted(); await blocked;
    }, { clock: () => new Date('2026-11-01T04:59:59.999Z') }));
    await started;
    const report = loadMonthlyEarningsReport(f.db, 'a', '2026-10', { now: new Date('2026-11-01T05:00:00Z') });
    await Promise.resolve();
    assert.equal(f.state.reads.length, 0, 'report must not race past the pending write');
    releaseMutation(); await mutation;
    const closed = await report;
    assert.equal(closed.period.closed, true);
    assert.deepEqual(closed.totals, [{ currency: 'USD', amountCents: 3734 }]);
    assert.equal(f.state.locks, 3, 'activation, mutation and report share the global ledger barrier');
});

test('inactive or missing ledger is explicit while unrelated database errors remain failures', async t => {
    enable(t);
    const f = fixture();
    await assert.rejects(loadMonthlyEarnings(f.db, 'a'), error => error.status === 503 && error.available === false);
    f.db.boosterEarningsLedgerState.findUnique = async () => { throw Object.assign(new Error('not migrated'), { code: 'P2021', meta: { table: 'public.BoosterEarningsLedgerState' } }); };
    await assert.rejects(loadMonthlyEarnings(f.db, 'a'), error => error.status === 503);
    const failure = new Error('connection lost'); f.db.boosterEarningsLedgerState.findUnique = async () => { throw failure; };
    await assert.rejects(loadMonthlyEarnings(f.db, 'a'), failure);
});
