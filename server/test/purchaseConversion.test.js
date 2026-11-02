const test = require('node:test');
const assert = require('node:assert/strict');
const { purchaseConversion } = require('../src/utils/purchaseConversion');
const { paymentFixture } = require('../test-helpers/paymentFixture');

const paidAt = new Date('2026-11-01T15:00:00.000Z');
const paidOrder = (changes = {}) => ({ id: 'paid-service-order', paymentStatus: 'PAID', status: 'IN_PROGRESS',
    cashAmountCents: 1299, currency: 'usd', paidAt, ...changes });

test('purchase payload uses settled service value and only allowlisted fields', () => {
    const order = paidOrder({ amountCents: 2299, goldDiscountCents: 1000, walletAmountCents: 900,
        customerId: 'private-customer', customer: { email: 'private@example.test' },
        stripeCheckoutSessionId: 'cs_private', stripePaymentIntentId: 'pi_private',
        totalCents: 399, cardAmountCents: 399 });
    assert.deepEqual(purchaseConversion(order), {
        transaction_id: order.id, value: 12.99, currency: 'USD', paidAt: paidAt.toISOString(),
    }, 'wallet + card service value is counted once, without customer/payment-provider data');
});

test('wallet-only, Gold-only and historical currency values retain their settled amounts', () => {
    assert.equal(purchaseConversion(paidOrder({ walletAmountCents: 1299 })).value, 12.99);
    assert.equal(purchaseConversion(paidOrder({ cashAmountCents: 0, goldDiscountCents: 2000 })).value, 0);
    assert.deepEqual(purchaseConversion(paidOrder({ currency: 'cad', status: 'COMPLETED', paidAt: paidAt.toISOString() })),
        { transaction_id: 'paid-service-order', value: 12.99, currency: 'CAD', paidAt: paidAt.toISOString() });
});

test('transaction IDs respect the 64-character Google Ads limit', () => {
    const maximumId = 'a'.repeat(64);
    assert.equal(purchaseConversion(paidOrder({ id: maximumId })).transaction_id, maximumId);
    assert.equal(purchaseConversion(paidOrder({ id: 'a'.repeat(65) })), null);
});

test('unsettled, cancelled, malformed and incomplete historical records yield no conversion', () => {
    const invalid = [null, {}, ...['PENDING', 'FAILED', 'REFUNDED', 'CANCELLED'].map(paymentStatus => paidOrder({ paymentStatus })),
        paidOrder({ status: 'CANCELLED' }), paidOrder({ status: 'UNKNOWN' }),
        ...[null, undefined, -1, 12.5, '1299', NaN, Infinity, Number.MAX_SAFE_INTEGER + 1].map(cashAmountCents => paidOrder({ cashAmountCents })),
        ...['', 'ZZZ', 'usd ', '$', null].map(currency => paidOrder({ currency })),
        ...[null, undefined, '', 'invalid', new Date(NaN), 0].map(paidAt => paidOrder({ paidAt })),
        ...['', 'private@example.test', 'with spaces', 'a'.repeat(65), null].map(id => paidOrder({ id }))];
    for (const order of invalid) assert.equal(purchaseConversion(order), null);
});

test('authenticated verification returns stable server values after payment, not query values', async t => {
    const f = paymentFixture(t, { orders: [paidOrder({ customerId: 'customer' })] });
    const verify = async query => {
        const res = f.response();
        await f.controller.verifyCheckoutSession({ user: { id: 'customer' }, query }, res);
        return res;
    };
    const first = await verify({ orderId: 'paid-service-order', value: '99999', currency: 'EUR', transaction_id: 'forged' });
    assert.equal(first.code, 200);
    assert.deepEqual(first.body.purchaseConversion, {
        transaction_id: 'paid-service-order', value: 12.99, currency: 'USD', paidAt: paidAt.toISOString(),
    });
    const repeated = await verify({ orderId: 'paid-service-order' });
    assert.deepEqual(repeated.body.purchaseConversion, first.body.purchaseConversion,
        'the transaction ID and payment timestamp must not change on reload');
});

test('verification never exposes conversions for another customer or unpaid/cancelled orders', async t => {
    const f = paymentFixture(t, { orders: [paidOrder({ id: 'owned' }),
        paidOrder({ id: 'pending', paymentStatus: 'PENDING', paidAt: null }),
        paidOrder({ id: 'cancelled', status: 'CANCELLED' }),
        paidOrder({ id: 'legacy', cashAmountCents: null })] });
    for (const [user, orderId, expectedCode] of [[undefined, 'owned', 401], [{ id: 'other-customer' }, 'owned', 404],
        [{ id: 'customer' }, 'pending', 200], [{ id: 'customer' }, 'cancelled', 200], [{ id: 'customer' }, 'legacy', 200]]) {
        const res = f.response();
        await f.controller.verifyCheckoutSession({ user, query: { orderId } }, res);
        assert.equal(res.code, expectedCode);
        assert.equal(Object.hasOwn(res.body, 'purchaseConversion'), false);
    }
});
