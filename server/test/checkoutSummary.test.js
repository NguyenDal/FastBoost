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
    const { adminBreakdown, ...existingSummary } = summary;
    assert.deepEqual(existingSummary, { currency: 'cad', subtotalCents: 3000, promotionCents: 300, coupon: null, referralCents: 270, goldRedeemed: 10, goldDiscountCents: 100, totalCents: 2330 });
    assert.deepEqual(adminBreakdown, { basePriceCents: 2500, addonPriceCents: 500, promotionCents: 300, coupon: null,
        referralCents: 270, goldRedeemed: 10, goldDiscountCents: 100, subtotalCents: 2330, taxCents: null,
        totalCents: 2330, hasUnitemizedAdjustment: false });
    assert.equal(adminBreakdown.basePriceCents + adminBreakdown.addonPriceCents - adminBreakdown.promotionCents
        - adminBreakdown.referralCents - adminBreakdown.goldDiscountCents, adminBreakdown.subtotalCents);
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

test('admin subtotal uses the winning coupon, recalculated referral and Gold exactly once', () => {
    const order = { basePrice: 100, addonPrice: 20, amountCents: 9000, totalPrice: 90, referralDiscount: 10,
        couponOriginalAmountCents: 9900, couponOriginalReferralDiscount: 11, couponSaleId: 'coupon',
        couponCode: 'WELCOME20', couponTitle: 'Welcome', couponDiscountCents: 2000,
        goldRedeemed: 10, goldDiscountCents: 100, cashAmountCents: 8900 };
    const breakdown = savedOrderPriceSummary(order).adminBreakdown;
    assert.equal(breakdown.promotionCents, 0);
    assert.equal(breakdown.referralCents, 1000);
    assert.deepEqual(breakdown.coupon, { code: 'WELCOME20', title: 'Welcome', amountCents: 2000 });
    assert.equal(breakdown.basePriceCents + breakdown.addonPriceCents - breakdown.coupon.amountCents
        - breakdown.referralCents - breakdown.goldDiscountCents, 8900);
    assert.equal(breakdown.subtotalCents, 8900);
    assert.equal(breakdown.totalCents, 8900);
    assert.equal(breakdown.hasUnitemizedAdjustment, false);
    assert.equal(Object.hasOwn(checkoutSummary(order).priceSummary, 'adminBreakdown'), false, 'checkout and receipt contract remains unchanged');
});

test('tax-inclusive cash total cannot inflate admin service subtotal or invent a stored tax amount', () => {
    const breakdown = savedOrderPriceSummary({ basePrice: 10, addonPrice: 0, amountCents: 1000,
        goldDiscountCents: 100, cashAmountCents: 1017 }).adminBreakdown;
    assert.equal(breakdown.subtotalCents, 900);
    assert.equal(breakdown.totalCents, 1017);
    assert.equal(breakdown.taxCents, null);
    assert.equal(breakdown.promotionCents, 0);
    assert.equal(breakdown.hasUnitemizedAdjustment, true);
});

test('legacy admin summaries never reconstruct missing base or promotion prices from paid totals', () => {
    for (const order of [{ totalPrice: 12.34 }, { basePrice: 0, addonPrice: 0, amountCents: 1234 }]) {
        const breakdown = savedOrderPriceSummary(order).adminBreakdown;
        assert.equal(breakdown.basePriceCents, null);
        assert.equal(breakdown.addonPriceCents, null);
        assert.equal(breakdown.promotionCents, null);
        assert.equal(breakdown.subtotalCents, 1234);
        assert.equal(breakdown.totalCents, 1234);
        assert.equal(breakdown.hasUnitemizedAdjustment, false);
    }
    const missing = savedOrderPriceSummary({ cashAmountCents: 999 }).adminBreakdown;
    assert.equal(missing.basePriceCents, null);
    assert.equal(missing.subtotalCents, null);
    assert.equal(missing.totalCents, 999);
});

test('admin summary distinguishes a known zero and Gold-only payment from missing amounts', () => {
    const free = savedOrderPriceSummary({ basePrice: 0, addonPrice: 0, amountCents: 0, cashAmountCents: 0 }).adminBreakdown;
    assert.equal(free.basePriceCents, 0);
    assert.equal(free.subtotalCents, 0);
    assert.equal(free.totalCents, 0);
    assert.equal(free.hasUnitemizedAdjustment, false);
    const gold = savedOrderPriceSummary({ basePrice: 10, addonPrice: 0, amountCents: 1000,
        goldDiscountCents: 1000, goldRedeemed: 100, cashAmountCents: 0 }).adminBreakdown;
    assert.equal(gold.subtotalCents, 0);
    assert.equal(gold.totalCents, 0);
    assert.equal(gold.hasUnitemizedAdjustment, false);
    assert.equal(savedOrderPriceSummary({}).adminBreakdown.totalCents, null);
});

test('incomplete or inconsistent saved pricing never inflates the recorded base to force reconciliation', () => {
    const breakdown = savedOrderPriceSummary({ basePrice: 10, addonPrice: 0, amountCents: 1200 }).adminBreakdown;
    assert.equal(breakdown.basePriceCents, 1000);
    assert.equal(breakdown.promotionCents, null);
    assert.equal(breakdown.subtotalCents, 1200);
    assert.equal(breakdown.hasUnitemizedAdjustment, true);
    const partial = savedOrderPriceSummary({ basePrice: 10, amountCents: 900 }).adminBreakdown;
    assert.equal(partial.basePriceCents, 1000);
    assert.equal(partial.addonPriceCents, null);
    assert.equal(partial.promotionCents, null);
});
