const test = require('node:test');
const assert = require('node:assert/strict');
const { cashbackPercentForSpend, snapshotCashbackPercent, cashbackTarget,
    prepareCashbackMutation, reconcileCashbackMutation } = require('../src/utils/customerCashback');

test('tier cashback uses the existing 0/3/5/10/15 percent spend boundaries', () => {
    assert.deepEqual([0, 199.99, 200, 499.99, 500, 999.99, 1000, 1499.99, 1500].map(cashbackPercentForSpend), [0, 0, 3, 3, 5, 5, 10, 10, 15]);
});

test('successful payment snapshots completed spend, excluding its own order, and retries preserve that rate', async () => {
    let reads = 0;
    const tx = { order: { aggregate: async args => {
        reads++;
        assert.deepEqual(args, { where: { customerId: 'customer', status: 'COMPLETED', paymentStatus: 'PAID', id: { not: 'order' } }, _sum: { totalPrice: true } });
        return { _sum: { totalPrice: '500.00' } };
    } } };
    assert.equal(await snapshotCashbackPercent(tx, { id: 'order', customerId: 'customer', cashbackPercent: null }), 5);
    assert.equal(await snapshotCashbackPercent(tx, { id: 'order', cashbackPercent: 3 }), 3);
    assert.equal(reads, 1);
    await assert.rejects(snapshotCashbackPercent(tx, { cashbackPercent: 100 }), /Invalid saved/);
});

test('cashback is based on the paid completed USD Total, never top ups, unpaid or legacy orders', () => {
    const order = { cashbackPercent: 3, status: 'COMPLETED', paymentStatus: 'PAID', currency: 'usd', cashAmountCents: 850 };
    assert.equal(cashbackTarget(order), 26);
    for (const patch of [{ cashbackPercent: null }, { status: 'CANCELLED' }, { paymentStatus: 'REFUNDED' },
        { status: 'IN_PROGRESS' }, { currency: 'cad' }, { cashAmountCents: 0 }]) assert.equal(cashbackTarget({ ...order, ...patch }), 0);
    assert.equal(cashbackTarget(null), 0);
    for (const cashAmountCents of [-1, NaN, 0.5, 2147483648]) assert.throws(() => cashbackTarget({ ...order, cashAmountCents }), /valid saved order total/);
});

test('legacy orders never touch the wallet but still lock User first against a concurrent payment', async () => {
    const legacy = { id: 'order', customerId: 'customer', cashbackPercent: null };
    const locks = [];
    let current = legacy;
    const tx = { order: { findUnique: async () => current }, $queryRaw: async (sql, value) => { locks.push([sql.join('?'), value]); return [{ id: value }]; } };
    const before = await prepareCashbackMutation(tx, 'order');
    await reconcileCashbackMutation(tx, 'order', before);
    assert.equal(locks.length, 1);
    current = { ...legacy, cashbackPercent: 3 };
    await prepareCashbackMutation(tx, 'order');
    assert.match(locks[1][0], /User.*FOR UPDATE/);
    assert.equal(locks[1][1], 'customer');
});

test('completion, cancellation, recompletion and deletion reconcile one immutable cashback entitlement', async () => {
    let current = { id: 'order', customerId: 'customer', cashbackPercent: 5, cashAmountCents: 1000,
        status: 'IN_PROGRESS', paymentStatus: 'PAID', currency: 'usd' };
    const account = { userId: 'customer', purchasedBalanceCents: 0, promotionalBalanceCents: 0 };
    const entries = [];
    let entitlement;
    const tx = {
        $queryRaw: async () => [{ id: 'customer' }],
        order: { findUnique: async () => current ? { ...current } : null },
        walletAccount: { upsert: async () => ({ ...account }), update: async ({ data }) => Object.assign(account, data) },
        walletCashbackEntitlement: { upsert: async ({ create }) => entitlement ||= { ...create, revision: 0, entitledCents: 0 },
            update: async ({ data }) => Object.assign(entitlement, data) },
        walletEntry: { create: async ({ data }) => { assert.ok(!entries.some(entry => entry.key === data.key)); entries.push(data); } },
    };
    const transition = async status => {
        const before = await prepareCashbackMutation(tx, 'order');
        if (status === 'DELETE') current = null; else current.status = status;
        await reconcileCashbackMutation(tx, 'order', before);
    };
    await transition('COMPLETED');
    await transition('COMPLETED');
    assert.equal(account.promotionalBalanceCents, 50);
    assert.equal(entries.length, 1);
    await transition('CANCELLED');
    assert.equal(account.promotionalBalanceCents, 0);
    await transition('COMPLETED');
    assert.equal(account.promotionalBalanceCents, 50);
    await transition('DELETE');
    assert.equal(account.promotionalBalanceCents, 0);
    assert.deepEqual(entries.map(entry => entry.amountCents), [50, -50, 50, -50]);
    assert.equal(entitlement.revision, 4);
    assert.equal(entitlement.entitledCents, 0);
});
