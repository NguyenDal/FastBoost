const test = require('node:test');
const assert = require('node:assert/strict');
const { walletFixture } = require('../test-helpers/walletFixture');

test('full wallet payment atomically spends purchased and promotional credit and queues one receipt', async t => {
    const f = walletFixture(t, { purchased: 1500, promotional: 700, orders: [{ id: 'order' }] });
    const result = await f.payOrder('order');
    assert.equal(result.code, 200);
    assert.equal(result.body.paidWithWallet, true);
    assert.equal(result.body.summary.walletAmountCents, 2000);
    assert.equal(result.body.summary.totalCents, 2000);
    assert.equal(f.state.orders[0].cashAmountCents, 2000, 'wallet remains payment tender, not a price discount');
    assert.equal(f.state.orders[0].walletPurchasedCents, 1500);
    assert.equal(f.state.orders[0].walletPromotionalCents, 500);
    assert.equal(f.ledger.accounts[0].purchasedBalanceCents, 0);
    assert.equal(f.ledger.accounts[0].promotionalBalanceCents, 200);
    assert.equal(f.ledger.entries.length, 1);
    assert.equal(f.state.created.length, 0);
    assert.equal(f.state.queued.length, 1);
    assert.equal(f.state.referrals.length, 1);
});

test('concurrent duplicate wallet order requests are idempotent', async t => {
    const f = walletFixture(t, { purchased: 5000, orders: [{ id: 'order' }] });
    const results = await Promise.all([f.payOrder('order'), f.payOrder('order'), f.payOrder('order')]);
    assert.ok(results.every(res => res.code === 200));
    assert.equal(f.ledger.entries.length, 1);
    assert.equal(f.ledger.accounts[0].purchasedBalanceCents, 3000);
    assert.equal(f.state.queued.length, 1);
});

test('concurrent orders cannot overspend one wallet balance', async t => {
    const f = walletFixture(t, { purchased: 3000, orders: [{ id: 'a' }, { id: 'b' }] });
    const results = await Promise.all([f.payOrder('a'), f.payOrder('b')]);
    assert.deepEqual(results.map(r => r.code).sort(), [200, 409]);
    assert.equal(results.find(r => r.code === 409).body.code, 'WALLET_INSUFFICIENT');
    assert.equal(f.ledger.entries.length, 1);
    assert.equal(f.state.orders.filter(row => row.paymentStatus === 'PAID').length, 1);
    assert.equal(f.ledger.accounts[0].purchasedBalanceCents, 1000);
});

test('stale confirmation total cannot spend any wallet credit', async t => {
    const f = walletFixture(t, { purchased: 5000, orders: [{ id: 'order' }] });
    for (const amount of [1900, 2100, '2000', undefined]) {
        const result = await f.payOrder('order', { expectedTotalCents: amount });
        assert.ok([400, 409].includes(result.code));
        assert.equal(result.body.code, 'WALLET_QUOTE_CHANGED');
    }
    assert.equal(f.ledger.accounts[0].purchasedBalanceCents, 5000);
    assert.equal(f.ledger.entries.length, 0);
});

test('own order authorization, cancellation, currency and wallet hold fail closed', async t => {
    const f = walletFixture(t, { purchased: 5000, frozen: true, orders: [
        { id: 'other', customerId: 'someone-else' }, { id: 'cancelled', status: 'CANCELLED' },
        { id: 'cad', currency: 'cad' }, { id: 'normal' },
    ] });
    assert.equal((await f.payOrder('other')).code, 403);
    assert.equal((await f.payOrder('cancelled')).code, 400);
    assert.equal((await f.payOrder('cad')).body.code, 'WALLET_CURRENCY');
    assert.equal((await f.payOrder('normal')).body.code, 'WALLET_FROZEN');
    assert.equal(f.ledger.entries.length, 0);
    assert.equal(f.ledger.accounts[0].purchasedBalanceCents, 5000);
});

test('wallet payment preserves applied Gold and consumes it in the same transaction', async t => {
    const f = walletFixture(t, { purchased: 2000, orders: [{ id: 'order', goldRedeemed: 100, goldDiscountCents: 1000 }] });
    const result = await f.payOrder('order', { expectedTotalCents: 1000 });
    assert.equal(result.code, 200);
    assert.equal(result.body.paidWithWallet, true);
    assert.equal(f.state.orders[0].walletAmountCents, 1000);
    assert.equal(f.state.orders[0].goldRedeemed, 100);
    assert.equal(f.balance(), 0);
    assert.equal(f.ledger.accounts[0].purchasedBalanceCents, 1000);
});

test('email or referral failure rolls back wallet debit, paid order and Gold spend', async t => {
    const f = walletFixture(t, { purchased: 2000, orders: [{ id: 'order', goldRedeemed: 100, goldDiscountCents: 1000 }] });
    for (const key of ['failQueue', 'failReferral']) {
        f.state[key] = true;
        const result = await f.payOrder('order', { expectedTotalCents: 1000 });
        assert.equal(result.code, 500);
        assert.equal(f.state.orders[0].paymentStatus, 'PENDING');
        assert.equal(f.ledger.accounts[0].purchasedBalanceCents, 2000);
        assert.equal(f.ledger.entries.length, 0);
        assert.equal(f.balance(), 100);
        assert.equal(f.state.queued.length, 0);
        f.state[key] = false;
    }
    assert.equal((await f.payOrder('order', { expectedTotalCents: 1000 })).code, 200);
});

test('open card session must expire before wallet is debited', async t => {
    const f = walletFixture(t, { purchased: 5000, orders: [{ id: 'order' }] });
    const created = await f.checkout('order', { goldToUse: 0 });
    const result = await f.payOrder('order');
    assert.equal(result.code, 200);
    assert.deepEqual(f.state.expired, [created.body.sessionId]);
    assert.equal(f.sessions.get(created.body.sessionId).status, 'expired');
    assert.equal(f.state.orders[0].stripeCheckoutSessionId, null);
    assert.equal(f.ledger.entries.length, 1);
    const latePaid = f.paidSession('order', { id: created.body.sessionId });
    await f.webhook('checkout.session.completed', latePaid);
    assert.equal(f.ledger.entries.length, 1);
    assert.equal(f.state.orders[0].stripePaymentIntentId, null);
});

test('card completion winning expiration race prevents wallet debit', async t => {
    const f = walletFixture(t, { purchased: 5000, orders: [{ id: 'order' }] });
    await f.checkout('order', { goldToUse: 0 });
    f.state.completeOnExpire = true;
    const result = await f.payOrder('order');
    assert.equal(result.code, 500);
    assert.equal(f.ledger.entries.length, 0);
    assert.equal(f.ledger.accounts[0].purchasedBalanceCents, 5000);
    assert.equal(f.state.orders[0].paymentStatus, 'PENDING');
});

test('completed or unverifiable card session never causes an additional wallet payment', async t => {
    const f = walletFixture(t, { purchased: 5000, orders: [{ id: 'order' }] });
    const created = await f.checkout('order', { goldToUse: 0 });
    const session = f.sessions.get(created.body.sessionId);
    session.status = 'complete';
    assert.equal((await f.payOrder('order')).body.completed, true);
    session.status = 'open';
    session.metadata.customerId = 'other';
    assert.equal((await f.payOrder('order')).body.code, 'WALLET_CARD_IN_PROGRESS');
    session.metadata.customerId = 'customer';
    f.state.failRetrieve = true;
    assert.equal((await f.payOrder('order')).code, 500);
    assert.equal(f.ledger.entries.length, 0);
});

test('committed wallet payment with a lost database reply is recoverable without another debit', async t => {
    const f = walletFixture(t, { purchased: 5000, orders: [{ id: 'order' }] });
    const transact = f.db.$transaction;
    let lose = true;
    f.db.$transaction = async (...args) => {
        const result = await transact(...args);
        if (lose) { lose = false; throw new Error('Database committed but reply was lost'); }
        return result;
    };
    assert.equal((await f.payOrder('order')).code, 503);
    assert.equal(f.state.orders[0].paymentStatus, 'PAID');
    assert.equal((await f.payOrder('order')).body.paid, true);
    assert.equal(f.ledger.entries.length, 1);
    assert.equal(f.ledger.accounts[0].purchasedBalanceCents, 3000);
});

test('card checkout body cannot select wallet tender through the unthrottled legacy route', async t => {
    const f = walletFixture(t, { purchased: 5000, orders: [{ id: 'order' }] });
    const result = await f.checkout('order', { goldToUse: 0, paymentMethod: 'wallet', expectedTotalCents: 2000, contactEmail: 'receipt@example.test' });
    assert.equal(result.code, 200);
    assert.ok(result.body.clientSecret);
    assert.equal(result.body.paidWithWallet, undefined);
    assert.equal(f.state.orders[0].paymentStatus, 'PENDING');
    assert.equal(f.ledger.entries.length, 0);
});
