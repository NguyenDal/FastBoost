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
        sessionId: 'cs_test_existing', verify: async () => { throw new Error('Verification unavailable'); }, wait: async () => {},
    }), /Verification unavailable/);
});

test('a transient Wi-Fi failure retries only the existing session and recovers its successful payment', async () => {
    const reads = [];
    let waits = 0;
    const result = await pollPaymentVerification({ sessionId: 'cs_test_existing', orderId: 'existing-order',
        verify: async query => {
            reads.push(query);
            if (reads.length === 1) throw new TypeError('Failed to fetch');
            return { paid: true, orderId: 'existing-order' };
        }, wait: async () => { waits++; },
    });
    assert.equal(result.paid, true);
    assert.equal(reads.length, 2); assert.equal(waits, 1);
    assert.ok(reads.every(query => query.sessionId === 'cs_test_existing' && query.orderId === 'existing-order'));
});

test('authentication failures stop verification immediately and offline retries stay bounded', async () => {
    let reads = 0, waits = 0;
    await assert.rejects(pollPaymentVerification({ orderId: 'existing-order',
        verify: async () => { reads++; throw Object.assign(new Error('Sign in again'), { status: 401 }); },
        wait: async () => { waits++; },
    }), /Sign in again/);
    assert.equal(reads, 1); assert.equal(waits, 0);
    reads = 0;
    await assert.rejects(pollPaymentVerification({ orderId: 'existing-order',
        verify: async () => { reads++; throw new TypeError('Offline'); }, wait: async () => { waits++; },
    }), /Offline/);
    assert.equal(reads, 8); assert.equal(waits, 7);
});

test('unmount during a failed verification or retry delay never starts another read', async () => {
    let cancelled = false, reads = 0;
    assert.equal(await pollPaymentVerification({
        verify: async () => { reads++; throw new TypeError('Offline'); },
        wait: async () => { cancelled = true; }, isCancelled: () => cancelled,
    }), null);
    assert.equal(reads, 1);
});

test('only an explicit paid boolean confirms success and known order identity survives older response shapes', async () => {
    const uncertain = await pollPaymentVerification({ orderId: 'existing-order', verify: async () => ({ paid: 'true' }), wait: async () => {} });
    assert.equal(uncertain.paid, false);
    assert.equal(uncertain.orderId, 'existing-order');
    const paid = await pollPaymentVerification({ orderId: 'existing-order', verify: async () => ({ paid: true }) });
    assert.equal(paid.orderId, 'existing-order');
});

test('pending responses retain the known order when verification omits its identifier', async () => {
    assert.deepEqual(await pollPaymentVerification({ orderId: 'existing-order',
        verify: async () => ({ paid: false }), wait: async () => {},
    }), { paid: false, orderId: 'existing-order' });
});
