const test = require('node:test');
const assert = require('node:assert/strict');
const { walletFixture } = require('../test-helpers/walletFixture');
const adjust = (f, targetCents, orderId = 'order', userId = 'customer') => f.db.$transaction(db => f.service().adjustCashback(db, { orderId, userId, targetCents }));

test('cashback entitlement credits promotional funds once across concurrent duplicate completion retries', async t => {
    const f = walletFixture(t);
    await Promise.all([adjust(f, 150), adjust(f, 150), adjust(f, 150)]);
    assert.equal(f.ledger.entries.length, 1);
    assert.equal(f.ledger.entries[0].type, 'CASHBACK');
    assert.equal(f.ledger.accounts[0].purchasedBalanceCents, 0);
    assert.equal(f.ledger.accounts[0].promotionalBalanceCents, 150);
    assert.equal(f.ledger.entitlements[0].entitledCents, 150);
    assert.equal(f.ledger.entitlements[0].revision, 1);
});

test('cashback cancel and re-completion append delta revisions without duplicate net rewards', async t => {
    const f = walletFixture(t);
    await adjust(f, 150);
    await adjust(f, 0);
    await adjust(f, 0);
    await adjust(f, 150);
    await adjust(f, 100);
    assert.deepEqual(f.ledger.entries.map(row => row.promotionalCents), [150, -150, 150, -50]);
    assert.equal(f.ledger.accounts[0].promotionalBalanceCents, 100);
    assert.equal(f.ledger.entitlements[0].revision, 4);
    assert.equal(new Set(f.ledger.entries.map(row => row.key)).size, 4);
});

test('reversal of already-spent cashback records liability and freezes the wallet', async t => {
    const f = walletFixture(t, { orders: [{ id: 'paid', amountCents: 2000 }] });
    await adjust(f, 2000, 'reward-source');
    assert.equal((await f.payOrder('paid')).code, 200);
    await adjust(f, 0, 'reward-source');
    assert.equal(f.ledger.accounts[0].promotionalBalanceCents, -2000);
    assert.ok(f.ledger.accounts[0].frozenAt);
    assert.equal((await f.service().snapshot('customer')).debtCents, 2000);
});

test('cashback bookkeeping rollback cannot leave a credit without its entitlement', async t => {
    const f = walletFixture(t);
    const update = f.db.walletCashbackEntitlement.update;
    f.db.walletCashbackEntitlement.update = async () => { throw new Error('simulated entitlement persistence failure'); };
    await assert.rejects(adjust(f, 500), /persistence/);
    assert.equal(f.ledger.entries.length, 0);
    assert.equal(f.ledger.entitlements.length, 0);
    assert.equal(f.ledger.accounts[0].promotionalBalanceCents, 0);
    f.db.walletCashbackEntitlement.update = update;
    await adjust(f, 500);
    assert.equal(f.ledger.entries.length, 1);
});

test('cashback owner cannot change and invalid target amounts never post credit', async t => {
    const f = walletFixture(t);
    for (const value of [-1, 1.1, Infinity, '500', 2147483648]) await assert.rejects(adjust(f, value), { code: 'WALLET_CASHBACK_INVALID' });
    await adjust(f, 100);
    await assert.rejects(adjust(f, 500, 'order', 'other'), { code: 'WALLET_CASHBACK_INVALID' });
    assert.equal(f.ledger.accounts.length, 1);
    assert.equal(f.ledger.entries.length, 1);
});
