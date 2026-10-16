const test = require('node:test');
const assert = require('node:assert/strict');
const { paymentFixture } = require('../test-helpers/paymentFixture');

test('moving Gold between drafts expires the prior session before it can be spent twice', async t => {
    const f = paymentFixture(t, { orders: [{ id: 'first' }, { id: 'second' }] });
    const first = await f.checkout('first');
    assert.equal(first.code, 200);
    const refreshed = await f.checkout('first');
    assert.equal(refreshed.body.sessionId, first.body.sessionId);
    assert.equal(f.state.expired.length, 0, 'same-order refresh keeps its payable session');
    const second = await f.checkout('second');
    assert.equal(second.code, 200);
    assert.deepEqual(f.state.expired, [first.body.sessionId]);
    assert.equal(f.sessions.get(first.body.sessionId).status, 'expired');
    assert.equal(f.state.orders[0].goldRedeemed, 0);
    assert.equal(f.state.orders[0].goldDiscountCents, 0);
    assert.equal(f.state.orders[0].cashAmountCents, 2000);
    assert.equal(second.body.summary.totalCents, 1000);
    const paid = { ...f.sessions.get(second.body.sessionId), status: 'complete', payment_status: 'paid', payment_intent: 'pi_offline' };
    await f.webhook('checkout.session.completed', paid);
    assert.equal(f.balance(), 0);
    const reopened = await f.checkout('first');
    assert.equal(reopened.body.summary.goldRedeemed, 0);
    assert.equal(reopened.body.summary.totalCents, 2000);
    assert.equal(f.state.redemptions.length, 1);
});

test('Gold-only settlement retires another payable draft without altering its coupon claim', async t => {
    const f = paymentFixture(t, { orders: [{ id: 'card' }, { id: 'gold', amountCents: 1000, totalPrice: 10, basePrice: 10 }] });
    const card = await f.checkout('card');
    const preview = await f.checkout('gold', { deferGoldOnly: true });
    assert.equal(preview.body.goldOnlyReady, true);
    assert.equal(f.state.expired.length, 0, 'a Gold-only preview does not replace a payable session');
    assert.equal(f.state.orders[0].goldRedeemed, 100);
    assert.equal((await f.checkout('gold', { contactEmail: 'invalid' })).code, 400);
    assert.equal(f.state.expired.length, 0, 'invalid Gold-only contact details cannot retire another checkout');
    // Coupon fields on the prior draft are outside Gold transfer's responsibility.
    Object.assign(f.state.orders[0], { couponCode: 'KEEPME', couponSaleId: 'coupon', couponDiscountCents: 500 });
    const gold = await f.checkout('gold', { contactEmail: 'receipt@example.test' });
    assert.equal(gold.code, 200);
    assert.equal(gold.body.paidWithGoldOnly, true);
    assert.deepEqual(f.state.expired, [card.body.sessionId]);
    assert.equal(f.state.orders[0].couponCode, 'KEEPME');
    assert.equal(f.state.orders[0].couponSaleId, 'coupon');
    assert.equal(f.balance(), 0);
    assert.equal(f.state.queued.length, 1);
});

test('confirmed or unknown prior sessions block Gold transfer and leave snapshots intact', async t => {
    const f = paymentFixture(t, { orders: [{ id: 'first' }, { id: 'second' }] });
    const first = await f.checkout('first');
    for (const [status, payment_status, expected] of [['complete', 'unpaid', 409], ['open', 'paid', 409], ['unknown', 'unpaid', 503]]) {
        Object.assign(f.sessions.get(first.body.sessionId), { status, payment_status });
        const second = await f.checkout('second');
        assert.equal(second.code, expected);
        assert.equal(f.state.orders[0].goldRedeemed, 100);
        assert.equal(f.state.orders[1].goldRedeemed, 0);
        assert.equal(f.state.created.length, 1);
        assert.equal(f.state.expired.length, 0);
    }
});

test('Stripe errors and confirmation winning the expiration race fail closed', async t => {
    const f = paymentFixture(t, { orders: [{ id: 'first' }, { id: 'second' }] });
    const first = await f.checkout('first');
    for (const flag of ['failRetrieve', 'failExpire', 'completeOnExpire']) {
        f.state[flag] = true;
        assert.equal((await f.checkout('second')).code, 503);
        assert.equal(f.state.orders[0].goldRedeemed, 100);
        assert.equal(f.state.orders[1].goldRedeemed, 0);
        assert.equal(f.state.created.length, 1);
        assert.equal(f.state.redemptions.length, 0);
        f.state[flag] = false;
        f.sessions.get(first.body.sessionId).status = 'open';
    }
});

test('expired sessions release Gold, while other customers and paid orders are excluded', async t => {
    const f = paymentFixture(t, { orders: [{ id: 'first' }, { id: 'second' },
        { id: 'foreign', customerId: 'other', goldRedeemed: 100, stripeCheckoutSessionId: 'must-not-read' },
        { id: 'paid', paymentStatus: 'PAID', goldRedeemed: 100, stripeCheckoutSessionId: 'also-must-not-read' }] });
    const first = await f.checkout('first');
    f.sessions.get(first.body.sessionId).status = 'expired';
    assert.equal((await f.checkout('second')).code, 200);
    assert.equal(f.state.expired.length, 0);
    assert.equal(f.state.orders[0].goldRedeemed, 0);
    assert.equal(f.state.orders[2].goldRedeemed, 100);
    assert.equal(f.state.orders[3].goldRedeemed, 100);
});

test('checkout without Gold does not expire another draft using Gold', async t => {
    const f = paymentFixture(t, { orders: [{ id: 'first' }, { id: 'second' }] });
    await f.checkout('first');
    const second = await f.checkout('second', { goldToUse: 0 });
    assert.equal(second.code, 200);
    assert.equal(second.body.summary.totalCents, 2000);
    assert.equal(f.state.expired.length, 0);
    assert.equal(f.state.orders[0].goldRedeemed, 100);
});

test('refreshing a legacy overlapping Gold checkout retires its alternate before reusing the session', async t => {
    const f = paymentFixture(t, { orders: [{ id: 'first' }, { id: 'legacy', goldRedeemed: 0 }] });
    const first = await f.checkout('first');
    Object.assign(f.state.orders[1], { goldRedeemed: 100, goldDiscountCents: 1000, cashAmountCents: 1000, stripeCheckoutSessionId: 'cs_legacy' });
    f.sessions.set('cs_legacy', { ...f.sessions.get(first.body.sessionId), id: 'cs_legacy', metadata: { orderId: 'legacy' } });
    const refresh = await f.checkout('first');
    assert.equal(refresh.body.sessionId, first.body.sessionId);
    assert.deepEqual(f.state.expired, ['cs_legacy']);
    assert.equal(f.state.orders[1].goldRedeemed, 0);
    assert.equal(f.state.created.length, 1);
});
