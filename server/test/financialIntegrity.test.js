const test = require('node:test');
const assert = require('node:assert/strict');
const { paymentFixture } = require('../test-helpers/paymentFixture');

async function createdPaidSession(t) {
    const f = paymentFixture(t, { orders: [{ id: 'order' }], initialGold: 100 });
    const prepared = await f.checkout('order', { goldToUse: 100 });
    assert.equal(prepared.code, 200);
    const order = f.state.orders[0];
    const session = { ...structuredClone(f.sessions.get(order.stripeCheckoutSessionId)),
        object: 'checkout.session', mode: 'payment', status: 'complete', payment_status: 'paid',
        payment_intent: 'pi_synthetic_integrity', customer_details: { email: 'owner@example.test' } };
    return { f, session };
}

test('signed paid events must match the durable checkout quote before money or points mutate', async t => {
    const corruptions = [
        ['integration currency', session => { session.currency = 'cad'; }],
        ['service subtotal', session => { session.amount_subtotal = 1; session.amount_total = 1; }],
        ['cash total below subtotal', session => { session.amount_total = 0; }],
        ['Gold quantity', session => { session.metadata.goldRedeemed = '9999'; }],
        ['Gold discount', session => { session.metadata.goldDiscountCents = '1'; }],
        ['cash allocation', session => { session.metadata.cashAmountCents = '1'; }],
        ['customer ownership', session => { session.metadata.customerId = 'other-customer'; }],
        ['event object type', session => { session.object = 'invoice'; }],
        ['non-payment mode', session => { session.mode = 'subscription'; }],
        ['incomplete checkout', session => { session.status = 'open'; }],
        ['missing payment intent', session => { session.payment_intent = null; }],
        ['wrong live/test mode', session => { session.livemode = true; }],
        ['non-boolean live/test mode', session => { session.livemode = 'false'; }],
    ];
    for (const [label, corrupt] of corruptions) await t.test(label, async child => {
        const { f, session } = await createdPaidSession(child);
        corrupt(session);
        const before = structuredClone(f.state.orders[0]);
        await f.webhook('checkout.session.completed', session);
        assert.equal(f.state.orders[0].paymentStatus, 'PENDING', `${label} mismatch must stay unpaid`);
        assert.deepEqual(f.state.orders[0], before, 'a signed but inconsistent payload must not rewrite the durable quote');
        assert.equal(f.balance(), 100); assert.equal(f.state.redemptions.length, 0);
        assert.equal(f.state.queued.length, 0); assert.equal(f.state.referrals.length, 0);
    });
});

test('a matching USD quote may carry separate CAD presentment and settles exactly once', async t => {
    const { f, session } = await createdPaidSession(t);
    session.presentment_details = { presentment_currency: 'cad', presentment_amount: 1537 };
    const results = await Promise.all([
        f.webhook('checkout.session.completed', session),
        f.webhook('checkout.session.async_payment_succeeded', session),
    ]);
    assert.ok(results.every(result => result.code === 200));
    assert.equal(f.state.orders[0].currency, 'usd'); assert.equal(f.state.orders[0].amountCents, 2000);
    assert.equal(f.state.orders[0].cashAmountCents, 1000); assert.equal(f.balance(), 0);
    assert.equal(f.state.redemptions.length, 1); assert.equal(f.state.queued.length, 1);
});

test('settlement fails closed if a durable Gold allocation no longer matches its monetary value', async t => {
    const { f, session } = await createdPaidSession(t);
    Object.assign(f.state.orders[0], { goldDiscountCents: 500, cashAmountCents: 1500 });
    Object.assign(session, { amount_subtotal: 1500, amount_total: 1500 });
    Object.assign(session.metadata, { goldDiscountCents: '500', cashAmountCents: '1500' });
    await f.webhook('checkout.session.completed', session);
    assert.equal(f.state.orders[0].paymentStatus, 'PENDING');
    assert.equal(f.balance(), 100); assert.equal(f.state.redemptions.length, 0);
    assert.equal(f.state.queued.length, 0); assert.equal(f.state.referrals.length, 0);
});
