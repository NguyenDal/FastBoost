const test = require('node:test');
const assert = require('node:assert/strict');
const { walletFixture } = require('../test-helpers/walletFixture');
const { withEarningsLedgerMutation } = require('../src/utils/boosterEarningsLedger');
const historicalTierOrder = { id: 'old-completed', status: 'COMPLETED', paymentStatus: 'PAID', totalPrice: 200, cashbackPercent: null };
const mutate = (f, id, fn) => f.db.$transaction(db => withEarningsLedgerMutation(db, id, fn));

test('wallet payment snapshots current cashback tier and completion awards it once without backfilling prior sales', async t => {
    const f = walletFixture(t, { purchased: 5000, orders: [historicalTierOrder, { id: 'current' }] });
    assert.equal((await f.payOrder('current')).code, 200);
    const order = f.state.orders.find(row => row.id === 'current');
    assert.equal(order.cashbackPercent, 3);
    assert.equal(f.ledger.entries.filter(row => row.type === 'CASHBACK').length, 0, 'payment alone is not completion');
    f.state.orders.find(row => row.id === historicalTierOrder.id).totalPrice = 1500;
    await Promise.all([mutate(f, order.id, async () => { order.status = 'COMPLETED'; }), mutate(f, order.id, async () => {})]);
    assert.equal(f.ledger.entries.filter(row => row.type === 'CASHBACK').length, 1);
    assert.equal(f.ledger.entries.find(row => row.type === 'CASHBACK').amountCents, 60, 'saved 3% tier wins over later 15% tier');
    await mutate(f, historicalTierOrder.id, async () => {});
    assert.equal(f.ledger.entries.filter(row => row.type === 'CASHBACK').length, 1, 'legacy null snapshot earns no retroactive credit');
});

test('completed-then-paid wallet order posts cashback in the same successful payment transaction', async t => {
    const f = walletFixture(t, { purchased: 5000, orders: [historicalTierOrder, { id: 'current', status: 'COMPLETED' }] });
    assert.equal((await f.payOrder('current')).code, 200);
    assert.equal(f.ledger.entries.filter(row => row.type === 'CASHBACK').length, 1);
    assert.equal(f.ledger.accounts[0].promotionalBalanceCents, 60);
    assert.equal(f.ledger.accounts[0].purchasedBalanceCents, 3000);
});

test('completed-then-paid card order snapshots tier and duplicate webhook cannot duplicate cashback', async t => {
    const f = walletFixture(t, { orders: [historicalTierOrder, { id: 'current', status: 'COMPLETED' }] });
    await f.checkout('current', { goldToUse: 0 });
    const session = f.paidSession('current');
    assert.equal((await f.webhook('checkout.session.completed', session)).code, 200);
    assert.equal((await f.webhook('checkout.session.completed', session)).code, 200);
    assert.equal(f.state.orders.find(row => row.id === 'current').cashbackPercent, 3);
    assert.equal(f.ledger.entries.filter(row => row.type === 'CASHBACK').length, 1);
    assert.equal(f.ledger.accounts[0].promotionalBalanceCents, 60);
});

test('cashback lifecycle reversal survives cancellation, re-completion and deletion without a second net reward', async t => {
    const f = walletFixture(t, { purchased: 5000, orders: [historicalTierOrder, { id: 'current', status: 'COMPLETED' }] });
    await f.payOrder('current');
    const order = f.state.orders.find(row => row.id === 'current');
    await mutate(f, order.id, async () => { order.status = 'CANCELLED'; });
    assert.equal(f.ledger.accounts[0].promotionalBalanceCents, 0);
    await mutate(f, order.id, async () => { order.status = 'COMPLETED'; });
    assert.equal(f.ledger.accounts[0].promotionalBalanceCents, 60);
    await mutate(f, order.id, async () => { f.state.orders.splice(f.state.orders.findIndex(row => row.id === order.id), 1); });
    assert.equal(f.ledger.accounts[0].promotionalBalanceCents, 0);
    assert.equal(f.ledger.entitlements[0].entitledCents, 0);
    assert.deepEqual(f.ledger.entries.filter(row => row.type.startsWith('CASHBACK')).map(row => row.amountCents), [60, -60, 60, -60]);
});

test('Gold-only payment snapshots zero cashback and cannot mint wallet credit', async t => {
    const f = walletFixture(t, { orders: [historicalTierOrder, { id: 'current', amountCents: 1000, totalPrice: 10, basePrice: 10, status: 'COMPLETED' }] });
    const result = await f.checkout('current', { goldToUse: 100, contactEmail: 'receipt@example.test' });
    assert.equal(result.code, 200);
    assert.equal(result.body.paidWithGoldOnly, true);
    assert.equal(f.state.orders.find(row => row.id === 'current').cashbackPercent, 0);
    assert.equal(f.ledger.entries.length, 0);
});
