const test = require('node:test');
const assert = require('node:assert/strict');
const { paymentFixture } = require('../test-helpers/paymentFixture');

const order = { id: 'order', stripeCheckoutSessionId: 'cs_test_paid', goldRedeemed: 100, goldDiscountCents: 1000 };
const paidSession = { id: 'cs_test_paid', object: 'checkout.session', status: 'complete', payment_status: 'paid',
    payment_intent: { id: 'pi_test_paid' }, amount_subtotal: 1000, amount_total: 1130, currency: 'cad',
    metadata: { orderId: 'order' }, customer_details: { email: 'receipt@example.test' }, livemode: false };

test('signed paid webhooks settle once across duplicate concurrent and async events', async t => {
    const f = paymentFixture(t, { orders: [order] });
    const results = await Promise.all([
        f.webhook('checkout.session.completed', paidSession),
        f.webhook('checkout.session.completed', paidSession),
        f.webhook('checkout.session.async_payment_succeeded', paidSession),
    ]);
    assert.ok(results.every(res => res.code === 200 && res.body.received));
    assert.equal(f.state.orders[0].paymentStatus, 'PAID');
    assert.equal(f.state.orders[0].stripePaymentIntentId, 'pi_test_paid');
    assert.equal(f.state.orders[0].amountCents, 2000, 'pre-tax service subtotal includes redeemed Gold');
    assert.equal(f.state.orders[0].cashAmountCents, 1130, 'cash settlement retains the actual charged total');
    assert.equal(f.state.orders[0].currency, 'cad');
    assert.equal(f.balance(), 0);
    assert.equal(f.state.redemptions.length, 1);
    assert.deepEqual(f.state.queued, [{ id: 'order', email: 'receipt@example.test' }]);
    assert.deepEqual(f.state.referrals, ['order']);
});

test('signature validation rejects missing, wrong, stale and tampered signatures before mutation', async t => {
    const f = paymentFixture(t, { orders: [order] });
    for (const overrides of [
        { headers: {} },
        { headers: { 'stripe-signature': 't=1,v1=incorrect' } },
        { body: Buffer.from('{"tampered":true}') },
        { body: { type: 'checkout.session.completed' } },
    ]) assert.equal((await f.webhook('checkout.session.completed', paidSession, overrides)).code, 400);
    const payload = JSON.stringify({ type: 'checkout.session.completed', data: { object: paidSession } });
    for (const options of [{ secret: 'whsec_wrong' }, { timestamp: Math.floor(Date.now() / 1000) - 600 }]) {
        const signature = f.stripe.webhooks.generateTestHeaderString({ payload, secret: 'whsec_offline_fixture', ...options });
        assert.equal((await f.webhook('checkout.session.completed', paidSession, {
            body: Buffer.from(payload), headers: { 'stripe-signature': signature },
        })).code, 400);
    }
    delete process.env.STRIPE_WEBHOOK_SECRET;
    assert.equal((await f.webhook('checkout.session.completed', paidSession)).code, 500);
    assert.equal(f.state.orders[0].paymentStatus, 'PENDING');
    assert.equal(f.state.redemptions.length + f.state.queued.length, 0);
});

test('unpaid, unrelated, old-session and cancelled-order events cannot settle an order', async t => {
    const f = paymentFixture(t, { orders: [order, { ...order, id: 'cancelled', status: 'CANCELLED', stripeCheckoutSessionId: 'cs_cancelled' }] });
    for (const session of [
        { ...paidSession, payment_status: 'unpaid' },
        { ...paidSession, metadata: {} },
        { ...paidSession, metadata: { orderId: 'other-account-order' } },
        { ...paidSession, id: 'cs_replaced' },
        { ...paidSession, id: 'cs_cancelled', metadata: { orderId: 'cancelled' } },
    ]) assert.equal((await f.webhook('checkout.session.completed', session)).code, 200);
    assert.equal((await f.webhook('payment_intent.succeeded', paidSession)).code, 200);
    assert.ok(f.state.orders.every(row => row.paymentStatus === 'PENDING'));
    assert.equal(f.state.redemptions.length + f.state.queued.length, 0);
});

test('expiration only cancels the matching pending session and cannot overwrite paid orders', async t => {
    const f = paymentFixture(t, { orders: [order] });
    await f.webhook('checkout.session.expired', { ...paidSession, id: 'cs_old' });
    assert.equal(f.state.orders[0].paymentStatus, 'PENDING');
    await f.webhook('checkout.session.expired', paidSession);
    assert.equal(f.state.orders[0].paymentStatus, 'CANCELLED');
    f.state.orders[0].paymentStatus = 'PAID';
    await f.webhook('checkout.session.expired', paidSession);
    assert.equal(f.state.orders[0].paymentStatus, 'PAID');
    assert.equal(f.state.queued.length, 0);
});

test('settlement rollback is retryable when confirmation queuing fails', async t => {
    const f = paymentFixture(t, { orders: [order] });
    f.state.failQueue = true;
    assert.equal((await f.webhook('checkout.session.completed', paidSession)).code, 500);
    assert.equal(f.state.orders[0].paymentStatus, 'PENDING');
    assert.equal(f.balance(), 100);
    assert.equal(f.state.queued.length + f.state.referrals.length, 0);
    f.state.failQueue = false;
    assert.equal((await f.webhook('checkout.session.completed', paidSession)).code, 200);
    assert.equal(f.state.orders[0].paymentStatus, 'PAID');
    assert.equal(f.balance(), 0);
    assert.equal(f.state.queued.length, 1);
});
