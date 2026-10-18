const test = require('node:test');
const assert = require('node:assert/strict');
const { paymentFixture } = require('../test-helpers/paymentFixture');

test('referral discount has only one payable checkout across saved drafts', async t => {
    const f = paymentFixture(t, { orders: ['one', 'two'].map(id => ({ id, amountCents: 9000, totalPrice: 90, referralDiscount: 10, basePrice: 100 })) });
    const one = await f.checkout('one', { goldToUse: 0 });
    assert.equal(one.code, 200);
    const two = await f.checkout('two', { goldToUse: 0 });
    assert.equal(two.code, 200);
    assert.equal(f.sessions.get(one.body.sessionId).status, 'expired');
    assert.equal(f.sessions.get(two.body.sessionId).status, 'open');
    assert.equal(f.sessions.get(two.body.sessionId).amount_total, 9000);
});

test('a paid purchase removes referral pricing from a saved draft before checkout', async t => {
    const f = paymentFixture(t, { orders: [
        { id: 'paid', paymentStatus: 'PAID' },
        { id: 'draft', amountCents: 9000, totalPrice: 90, referralDiscount: 10, basePrice: 100 },
    ] });
    const result = await f.checkout('draft', { goldToUse: 0 });
    assert.equal(result.code, 200);
    assert.equal(f.sessions.get(result.body.sessionId).amount_total, 10000);
    assert.equal(f.state.orders[1].referralDiscount, 0);
    assert.equal(result.body.couponNotice.title, 'Referral offer updated');
});

test('a completed competing referral checkout blocks entitlement transfer', async t => {
    const f = paymentFixture(t, { orders: ['one', 'two'].map(id => ({ id, amountCents: 9000, totalPrice: 90, referralDiscount: 10, basePrice: 100 })) });
    const one = await f.checkout('one', { goldToUse: 0 });
    f.sessions.get(one.body.sessionId).status = 'complete';
    const two = await f.checkout('two', { goldToUse: 0 });
    assert.equal(two.code, 400);
    assert.equal(f.state.created.length, 1);
    assert.equal(f.state.orders[1].stripeCheckoutSessionId, null);
});

test('referral removal updates coupon restoration snapshot without losing its coupon', async t => {
    const f = paymentFixture(t, { orders: [{ id: 'paid', paymentStatus: 'PAID' },
        { id: 'coupon', amountCents: 7200, totalPrice: 72, referralDiscount: 8,
            couponOriginalAmountCents: 9000, couponOriginalReferralDiscount: 10 }] });
    const { enforceCheckoutReferral } = require('../src/utils/checkoutReferral');
    await enforceCheckoutReferral(f.db, f.state.orders[1], f.stripe);
    const order = f.state.orders[1];
    assert.equal(order.amountCents, 8000);
    assert.equal(order.couponOriginalAmountCents, 10000);
    assert.equal(order.couponOriginalReferralDiscount, 0);
});
