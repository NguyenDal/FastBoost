import test from 'node:test';
import assert from 'node:assert/strict';
import { checkoutPriceDisplay } from '../src/utils/checkoutDisplay.js';

const summary = { currency: 'usd', subtotalCents: 3000, promotionCents: 200, coupon: { amountCents: 300 }, referralCents: 100, goldDiscountCents: 700, totalCents: 1700 };
function display(currency = 'cad', divisor = 100, total = 2397, rate = 1.41) {
    return { sessionId: 'cs_current', state: { type: 'success', checkout: { id: 'cs_current', currency, minorUnitsAmountDivisor: divisor, total: { total: { minorUnitsAmount: total, amount: 'Stripe formatted total' } }, currencyOptions: [{ currency, currencyConversion: { sourceCurrency: 'usd', fxRate: rate } }] } } };
}

test('local display uses Stripe quote and leaves all USD accounting inputs unchanged', () => {
    const before = structuredClone(summary);
    const price = checkoutPriceDisplay(summary, 'cs_current', display());
    assert.equal(price.currency, 'CAD');
    assert.equal(price.localized, true);
    assert.equal(price.formatPrice(summary.totalCents, 'total'), 'CA$23.97');
    assert.equal(price.formatPrice(summary.subtotalCents, 'subtotal'), 'CA$42.30');
    assert.equal(price.formatPrice(summary.goldDiscountCents), 'CA$9.87');
    assert.deepEqual(summary, before);
});

test('zero-decimal currencies round discounts while preserving the exact Stripe total', () => {
    const price = checkoutPriceDisplay(summary, 'cs_current', display('jpy', 1, 2664, 156.7));
    const digits = text => Number(text.replace(/[^\d]/g, ''));
    const discountTotal = [summary.promotionCents, summary.coupon.amountCents, summary.referralCents, summary.goldDiscountCents].reduce((sum, cents) => sum + digits(price.formatPrice(cents)), 0);
    assert.equal(digits(price.formatPrice(summary.totalCents, 'total')), 2664);
    assert.equal(digits(price.formatPrice(summary.subtotalCents, 'subtotal')) - discountTotal, 2664);
    assert.doesNotMatch(price.formatPrice(summary.totalCents, 'total'), /\.\d/);
});

test('discounts with the same source amount as the cash total are formatted independently', () => {
    const input = { currency: 'usd', subtotalCents: 2000, goldDiscountCents: 1000, totalCents: 1000 };
    const price = checkoutPriceDisplay(input, 'cs_current', display('cad', 100, 1334, 1.3333));
    assert.match(price.formatPrice(1000, 'total'), /13\.34/);
    assert.match(price.formatPrice(1000), /13\.33/);
    assert.match(price.formatPrice(2000, 'subtotal'), /26\.67/);
});

test('missing FX metadata falls back to Stripe quoted total rather than a market estimate', () => {
    const state = display('cad', 100, 2550);
    delete state.state.checkout.currencyOptions;
    const price = checkoutPriceDisplay(summary, 'cs_current', state);
    assert.equal(price.formatPrice(200), 'CA$3.00');
    assert.equal(price.formatPrice(1700, 'total'), 'CA$25.50');
});

test('switching back to USD uses the same quote with no conversion', () => {
    const price = checkoutPriceDisplay(summary, 'cs_current', display('usd', 100, 1700, 50));
    assert.equal(price.localized, false);
    assert.equal(price.formatPrice(200), 'US$2.00');
    assert.equal(price.formatPrice(1700, 'total'), 'US$17.00');
});

test('split wallet subtotal reconciles the original discounts and wallet deduction to the card remainder', () => {
    const input = { ...summary, walletAppliedCents: 1200, cardAmountCents: 500 };
    const price = checkoutPriceDisplay(input, 'cs_current', display('usd', 100, 500));
    assert.equal(price.formatPrice(input.subtotalCents, 'subtotal'), 'US$30.00');
    assert.equal(price.formatPrice(input.walletAppliedCents), 'US$12.00');
    assert.equal(price.formatPrice(input.cardAmountCents, 'total'), 'US$5.00');
    const state = display('cad', 100, 750); delete state.state.checkout.currencyOptions;
    const localized = checkoutPriceDisplay(input, 'cs_current', state);
    assert.equal(localized.formatPrice(input.walletAppliedCents), 'CA$18.00');
    assert.equal(localized.formatPrice(input.subtotalCents, 'subtotal'), 'CA$45.00');
});

test('stale, loading, erroneous and invalid quotes cannot replace the current order summary', () => {
    assert.equal(checkoutPriceDisplay(summary, 'cs_replaced', display()), null);
    const stale = display(); stale.state.checkout.id = 'cs_old';
    assert.equal(checkoutPriceDisplay(summary, 'cs_current', stale), null);
    for (const state of [{ type: 'loading' }, { type: 'error', error: { message: 'unavailable' } }]) {
        assert.equal(checkoutPriceDisplay(summary, 'cs_current', { sessionId: 'cs_current', state }), null);
    }
    for (const invalid of [0, -1, NaN, undefined]) {
        const state = display(); state.state.checkout.minorUnitsAmountDivisor = invalid;
        assert.equal(checkoutPriceDisplay(summary, 'cs_current', state), null);
    }
    assert.equal(checkoutPriceDisplay({ ...summary, totalCents: 0 }, 'cs_current', display()), null);
});
