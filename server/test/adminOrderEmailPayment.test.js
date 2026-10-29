const test = require('node:test');
const assert = require('node:assert/strict');
const { paymentFixture } = require('../test-helpers/paymentFixture');
const { walletFixture } = require('../test-helpers/walletFixture');

test('Stripe admin email queues only after verified first payment, with immediate post-commit wake', async t => {
    const f = paymentFixture(t, { orders: [{ id: 'order' }] });
    const draft = await f.checkout('order', { goldToUse: 0 });
    assert.equal(draft.code, 200); assert.deepEqual(f.state.adminQueued, []); assert.equal(f.state.adminWakes, 0);
    const unpaid = { ...f.sessions.get(draft.body.sessionId), status: 'complete', payment_status: 'unpaid' };
    assert.equal((await f.webhook('checkout.session.completed', unpaid)).code, 200);
    assert.deepEqual(f.state.adminQueued, []); assert.equal(f.state.adminWakes, 0);
    const paid = f.paidSession('order');
    const replies = await Promise.all([f.webhook('checkout.session.completed', paid), f.webhook('checkout.session.async_payment_succeeded', paid)]);
    assert.deepEqual(replies.map(res => res.code), [200, 200]);
    assert.deepEqual(f.state.adminQueued, ['order']); assert.equal(f.state.adminWakes, 1);
    f.restart(); await f.webhook('checkout.session.completed', paid);
    assert.deepEqual(f.state.adminQueued, ['order']); assert.equal(f.state.adminWakes, 1);
});

test('wallet and Gold settlement both notify once, after commit rather than during preview', async t => {
    await t.test('wallet', async t => {
        const f = walletFixture(t, { purchased: 5000, orders: [{ id: 'order' }] });
        const preview = await f.checkout('order', { goldToUse: 0, walletToUseCents: 2000 });
        assert.equal(preview.body.walletOnlyReady, true); assert.equal(f.state.adminWakes, 0);
        const replies = await Promise.all([f.payOrder('order'), f.payOrder('order')]);
        assert.ok(replies.every(res => res.code === 200));
        assert.deepEqual(f.state.adminQueued, ['order']); assert.equal(f.state.adminWakes, 1);
    });
    await t.test('Gold', async t => {
        const f = paymentFixture(t, { orders: [{ id: 'order', amountCents: 1000, totalPrice: 10, basePrice: 10 }] });
        const preview = await f.checkout('order', { deferGoldOnly: true });
        assert.equal(preview.body.goldOnlyReady, true); assert.equal(f.state.adminWakes, 0);
        const result = await f.checkout('order', { contactEmail: 'receipt@example.test' });
        assert.equal(result.body.paidWithGoldOnly, true);
        await f.checkout('order', { contactEmail: 'receipt@example.test' });
        assert.deepEqual(f.state.adminQueued, ['order']); assert.equal(f.state.adminWakes, 1);
    });
});

test('split wallet/card payment notifies once for the full order only after Stripe confirms', async t => {
    const f = walletFixture(t, { purchased: 500, promotional: 1000, orders: [{ id: 'order' }] });
    const preview = await f.checkout('order', { goldToUse: 0, walletToUseCents: 750 });
    assert.equal(preview.code, 200); assert.equal(f.state.adminWakes, 0);
    const paid = { ...f.sessions.get(preview.body.sessionId), status: 'complete', payment_status: 'paid', payment_intent: 'pi_synthetic' };
    assert.equal((await f.webhook('checkout.session.completed', paid)).code, 200);
    await f.webhook('checkout.session.async_payment_succeeded', paid);
    assert.equal(f.state.orders[0].cashAmountCents, 2000);
    assert.deepEqual(f.state.adminQueued, ['order']); assert.equal(f.state.adminWakes, 1);
});

test('failed payment transaction cannot notify admins, and retry queues exactly one message', async t => {
    for (const failure of ['failAdminQueue', 'failReferral']) await t.test(failure, async t => {
        const f = walletFixture(t, { purchased: 2000, orders: [{ id: 'order' }] });
        f.state[failure] = true;
        const failed = await f.payOrder('order');
        assert.equal(failed.code, 500); assert.equal(f.state.orders[0].paymentStatus, 'PENDING');
        assert.deepEqual(f.state.adminQueued, []); assert.equal(f.state.adminWakes, 0);
        assert.equal(f.ledger.accounts[0].purchasedBalanceCents, 2000);
        f.state[failure] = false;
        assert.equal((await f.payOrder('order')).code, 200);
        assert.deepEqual(f.state.adminQueued, ['order']); assert.equal(f.state.adminWakes, 1);
    });
});
