const test = require('node:test');
const assert = require('node:assert/strict');
const { checkoutSummary, savedOrderPriceSummary } = require('../src/utils/checkoutSummary');

test('placement summary uses selected service, peak rank and matches, ignoring stale target rank', () => {
    const summary = checkoutSummary({boostType: 'TFT Placement Boost', service: {title: 'TFT Rank Boost'}, peakRank: 'Diamond II', placementGames: 5, currentRank: 'Silver I', desiredRank: 'Gold IV'}, 0, 0, 1000);
    assert.equal(summary.title, 'TFT Placement Boost');
    assert.equal(summary.currentRank, 'Diamond II');
    assert.equal(summary.targetRank, '');
    assert.deepEqual(summary.details, [['Peak Rank', 'Diamond II'], ['Placement Matches', 5]]);
    assert.equal(summary.game, 'tft');
});

test('wins and duo summaries show their quantities rather than a target rank', () => {
    for (const [boostType, label, field] of [['Win Boost', 'Ranked Wins', 'desiredWins'], ['Pro Duo', 'Games', 'numberOfGames']]) {
        const summary = checkoutSummary({boostType, currentRank: 'Silver I', desiredRank: 'Gold IV', [field]: 3}, 0, 0, 1000);
        assert.equal(summary.targetRank, '');
        assert.deepEqual(summary.quantity, {label, value: 3});
    }
});

test('rank boost summary keeps both ends of the rank tracker', () => {
    const summary = checkoutSummary({boostType: 'Rank Boost', currentRank: 'Silver I', desiredRank: 'Gold IV'}, 0, 0, 1000);
    assert.deepEqual(summary.details, [['Current Rank', 'Silver I'], ['Target Rank', 'Gold IV']]);
});

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

test('saved price summary combines subtotal and preserves applied promotion, referral and gold', () => {
    const summary = savedOrderPriceSummary({ basePrice: 25, addonPrice: 5, referralDiscount: 2.7, amountCents: 2430, goldRedeemed: 10, goldDiscountCents: 100, cashAmountCents: 2330, currency: 'cad' });
    assert.deepEqual(summary, { currency: 'cad', subtotalCents: 3000, promotionCents: 300, coupon: null, referralCents: 270, goldRedeemed: 10, goldDiscountCents: 100, totalCents: 2330 });
});

test('saved coupon summary never counts the replaced promotion twice and keeps a zero cash total', () => {
    const summary = savedOrderPriceSummary({ basePrice: 100, addonPrice: 20, amountCents: 10800, couponOriginalAmountCents: 11400, couponSaleId: 'coupon', couponCode: 'WELCOME10', couponTitle: 'Welcome', couponDiscountCents: 1200, goldRedeemed: 1080, goldDiscountCents: 10800, cashAmountCents: 0 });
    assert.equal(summary.subtotalCents, 12000);
    assert.equal(summary.promotionCents, 0);
    assert.deepEqual(summary.coupon, { title: 'Welcome', code: 'WELCOME10', amountCents: 1200 });
    assert.equal(summary.totalCents, 0);
    assert.equal(summary.subtotalCents - summary.coupon.amountCents - summary.goldDiscountCents, 0);
});

test('saved summary falls back for legacy totals and uses recorded cash total when available', () => {
    assert.equal(savedOrderPriceSummary({ totalPrice: 12.34 }).subtotalCents, 1234);
    assert.equal(savedOrderPriceSummary({ totalPrice: 12.34 }).totalCents, 1234);
    assert.equal(savedOrderPriceSummary({ amountCents: 1000, goldDiscountCents: 100 }).totalCents, 900);
    assert.equal(savedOrderPriceSummary({ amountCents: 1000, cashAmountCents: 1130 }).totalCents, 1130);
});
