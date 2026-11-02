const test = require('node:test');
const assert = require('node:assert/strict');
const { paymentFixture } = require('../test-helpers/paymentFixture');

const paidAt = new Date('2026-11-01T15:00:00.000Z');
const order = (changes = {}) => ({ id: 'owned-order', paymentStatus: 'PAID', status: 'IN_PROGRESS',
    cashAmountCents: 1299, currency: 'usd', paidAt, ...changes });

test('authenticated payment verification preserves receipt status without advertising payloads', async t => {
    const f = paymentFixture(t, { orders: [order({ customerId: 'customer' })] });
    for (const query of [{ orderId: 'owned-order', value: '99999', currency: 'EUR', transaction_id: 'forged' }, { orderId: 'owned-order' }]) {
        const res = f.response();
        await f.controller.verifyCheckoutSession({ user: { id: 'customer' }, query }, res);
        assert.equal(res.code, 200);
        assert.deepEqual(res.body, { ok: true, orderId: 'owned-order', paymentStatus: 'PAID', paid: true, orderStatus: 'IN_PROGRESS', paidAt });
    }
});

test('payment verification keeps authentication, ownership and unpaid status checks', async t => {
    const f = paymentFixture(t, { orders: [order(), order({ id: 'pending', paymentStatus: 'PENDING', paidAt: null })] });
    for (const [user, orderId, expectedCode] of [[undefined, 'owned-order', 401], [{ id: 'other-customer' }, 'owned-order', 404],
        [{ id: 'customer' }, 'pending', 200]]) {
        const res = f.response();
        await f.controller.verifyCheckoutSession({ user, query: { orderId } }, res);
        assert.equal(res.code, expectedCode);
        assert.equal(Object.hasOwn(res.body, 'purchaseConversion'), false);
        if (orderId === 'pending') assert.equal(res.body.paid, false);
    }
});
