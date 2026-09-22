const test = require('node:test');
const assert = require('node:assert/strict');
const { checkoutSummary } = require('../src/utils/checkoutSummary');

test('checkout breakdown balances sale, referral and gold discounts to the charged total', () => {
    const summary = checkoutSummary({basePrice: 25, addonPrice: 5, referralDiscount: 2.7, amountCents: 2430, currency:'cad'}, 10, 100, 2330);
    assert.equal(summary.saleDiscountCents, 300);
    assert.equal(summary.referralDiscountCents, 270);
    assert.equal(summary.basePriceCents + summary.addonPriceCents - summary.saleDiscountCents - summary.referralDiscountCents - summary.goldDiscountCents, summary.totalCents);
});

test('legacy order without breakdown still displays the correct base price', () => {
    const summary = checkoutSummary({totalPrice: 12.34}, 0, 0, 1234);
    assert.equal(summary.basePriceCents, 1234);
    assert.equal(summary.saleDiscountCents, 0);
});

test('amount in cents takes precedence over floating point total', () => {
    const summary = checkoutSummary({basePrice: 10.01, amountCents: 1001, totalPrice:10}, 5, 50, 951);
    assert.equal(summary.basePriceCents - summary.goldDiscountCents, 951);
});
