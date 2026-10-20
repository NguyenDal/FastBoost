import test from 'node:test';
import assert from 'node:assert/strict';
import { pollWalletTopUp, walletCheckoutUrl, walletPaymentState, walletReturnPath } from '../src/utils/wallet.js';

test('wallet checkout eligibility uses integer USD amounts and rejects frozen or missing balances', () => {
    const wallet = { currency: 'usd', balanceCents: 1100, frozen: false };
    assert.equal(walletPaymentState(wallet, 1100, 'USD'), 'ready');
    assert.equal(walletPaymentState(wallet, 1101, 'usd'), 'insufficient');
    assert.equal(walletPaymentState({ ...wallet, frozen: true }, 100, 'usd'), 'frozen');
    assert.equal(walletPaymentState(wallet, 100, 'cad'), 'currency');
    assert.equal(walletPaymentState(null, 100, 'usd'), 'unavailable');
    for (const invalid of [0, -1, 0.1, NaN, undefined, Number.MAX_SAFE_INTEGER + 1]) {
        assert.equal(walletPaymentState(wallet, invalid, 'usd'), 'unavailable');
    }
    assert.equal(walletPaymentState({ ...wallet, balanceCents: '1100' }, 100, 'usd'), 'unavailable');
});

test('checkout continuation cannot navigate outside a known local checkout route', () => {
    assert.equal(walletReturnPath('/checkout/cmvg5r3aq0005rwrjufgo324a'), '/checkout/cmvg5r3aq0005rwrjufgo324a');
    for (const unsafe of ['https://evil.example', '//evil.example', '/checkout/../../admin', '/checkout/order?next=https://evil.example', '/checkout/order#x', '/account/settings', '/checkout/' + 'a'.repeat(129), null]) {
        assert.equal(walletReturnPath(unsafe), '');
    }
});

test('top up redirects accept only the HTTPS hosted Stripe Checkout origin', () => {
    assert.equal(walletCheckoutUrl('https://checkout.stripe.com/c/pay/cs_test_example'), 'https://checkout.stripe.com/c/pay/cs_test_example');
    for (const unsafe of ['http://checkout.stripe.com/c/pay/x', 'javascript:alert(1)', 'https://checkout.stripe.com.evil.example', 'https://evil.example', 'https://user:password@checkout.stripe.com', 'https://checkout.stripe.com:444/c/pay/x']) {
        assert.equal(walletCheckoutUrl(unsafe), '');
    }
});

test('top up polling retries the same session after interruption and requires explicit paid confirmation', async () => {
    const reads = [];
    let waits = 0;
    const result = await pollWalletTopUp({ sessionId: 'cs_test_original', verify: async query => {
        reads.push(query);
        if (reads.length === 1) throw new TypeError('Offline');
        if (reads.length === 2) return { status: 'pending', paid: 'true' };
        return { status: 'paid', paid: true, balanceCents: 550 };
    }, wait: async () => { waits++; } });
    assert.equal(result.balanceCents, 550);
    assert.equal(waits, 2);
    assert.deepEqual(reads, Array.from({ length: 3 }, () => ({ sessionId: 'cs_test_original' })));
});

test('pending top ups remain unconfirmed after a bounded polling window', async () => {
    let reads = 0, waits = 0;
    const result = await pollWalletTopUp({ sessionId: 'cs_test_original', verify: async () => { reads++; return { status: 'pending', paid: true }; }, wait: async () => { waits++; } });
    assert.equal(reads, 6);
    assert.equal(waits, 5);
    assert.equal(result.paid, false);
});

test('expired/reversed sessions and ownership failures do not retry or report success', async () => {
    for (const status of ['expired', 'reversed']) {
        let reads = 0;
        const result = await pollWalletTopUp({ verify: async () => { reads++; return { status, paid: false }; } });
        assert.equal(result.paid, false);
        assert.equal(reads, 1);
    }
    let reads = 0;
    await assert.rejects(pollWalletTopUp({ verify: async () => { reads++; throw Object.assign(new Error('Forbidden'), { status: 403 }); } }), /Forbidden/);
    assert.equal(reads, 1);
});

test('leaving the page during a top up response stops verification without another request', async () => {
    let cancelled = false, reads = 0;
    assert.equal(await pollWalletTopUp({ verify: async () => { reads++; cancelled = true; return { status: 'paid', paid: true }; }, isCancelled: () => cancelled }), null);
    assert.equal(reads, 1);
});
