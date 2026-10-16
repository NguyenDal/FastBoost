import test from 'node:test';
import assert from 'node:assert/strict';
import { pollPaymentVerification } from '../src/utils/paymentVerification.js';

test('pending confirmation can be checked again using the same session and order', async () => {
    const reads = [];
    let settled = false;
    let delays = 0;
    const options = {
        sessionId: 'cs_test_existing', orderId: 'existing-order',
        verify: async query => {
            reads.push(query);
            return { paid: settled, orderId: 'existing-order' };
        },
        wait: async () => { delays++; },
    };
    assert.deepEqual(await pollPaymentVerification(options), { paid: false, orderId: 'existing-order' });
    assert.equal(reads.length, 8);
    assert.equal(delays, 7, 'do not wait after the last verification');
    settled = true;
    assert.deepEqual(await pollPaymentVerification(options), { paid: true, orderId: 'existing-order' });
    assert.equal(reads.length, 9);
    assert.ok(reads.every(query => query.sessionId === options.sessionId && query.orderId === options.orderId),
        'retry must verify the existing payment, including after exhausting a polling window');
});

test('Gold and already-paid order verification need no Stripe session identifier', async () => {
    const reads = [];
    assert.deepEqual(await pollPaymentVerification({ orderId: 'gold-order', verify: async query => {
        reads.push(query);
        return { paid: true, orderId: query.orderId };
    } }), { paid: true, orderId: 'gold-order' });
    assert.deepEqual(reads, [{ sessionId: undefined, orderId: 'gold-order' }]);
});

test('cancelling during a polling delay prevents another verification request', async () => {
    let cancelled = false;
    let reads = 0;
    const result = await pollPaymentVerification({
        sessionId: 'cs_test_existing', isCancelled: () => cancelled,
        verify: async () => { reads++; return { paid: false }; },
        wait: async () => { cancelled = true; },
    });
    assert.equal(result, null);
    assert.equal(reads, 1);
});

test('a late response after unmount is ignored and verification errors are not paid results', async () => {
    let cancelled = false;
    assert.equal(await pollPaymentVerification({
        isCancelled: () => cancelled,
        verify: async () => { cancelled = true; return { paid: true, orderId: 'old-order' }; },
    }), null);
    await assert.rejects(pollPaymentVerification({
        sessionId: 'cs_test_existing', verify: async () => { throw new Error('Verification unavailable'); },
    }), /Verification unavailable/);
});

test('pending responses retain the known order when verification omits its identifier', async () => {
    assert.deepEqual(await pollPaymentVerification({ orderId: 'existing-order',
        verify: async () => ({ paid: false }), wait: async () => {},
    }), { paid: false, orderId: 'existing-order' });
});
