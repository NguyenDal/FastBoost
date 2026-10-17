const test = require('node:test');
const assert = require('node:assert/strict');
const { historicalOrderPromotion } = require('../src/utils/historicalOrderPromotion');
const { savedOrderPriceSummary } = require('../src/utils/checkoutSummary');

const order = { id: 'synthetic-order', serviceId: 'rank-service', createdAt: new Date('2026-10-17T01:21:56.742Z'),
    basePrice: 2399.65, addonPrice: 3, referralDiscount: 0, totalPrice: 2042.7, amountCents: 204270,
    couponSaleId: null, goldDiscountCents: 0, cashAmountCents: 204270 };
const campaign = { title: 'Summer sale', discountPercent: '15', appliesTo: 'BASE_PRICE', active: true,
    scope: 'GLOBAL', serviceId: null, createdAt: new Date('2026-10-17T00:43:48.812Z'),
    updatedAt: new Date('2026-10-17T00:43:48.812Z'), startsAt: new Date('2026-10-17T00:43:00.000Z'),
    endsAt: new Date('2026-10-18T00:43:00.000Z') };

function fixture(campaigns = [campaign]) {
    const queries = [];
    return { queries, db: { serviceSale: { findMany: async query => { queries.push(query); return structuredClone(campaigns); } } } };
}
const breakdown = value => savedOrderPriceSummary(value).adminBreakdown;

test('the historical creation window and exact saved discount establish the selected campaign label', async () => {
    const f = fixture();
    const original = structuredClone(order);
    const prices = breakdown(order);
    assert.equal(prices.promotionCents, 35995);
    assert.deepEqual(await historicalOrderPromotion(f.db, order, prices), {
        title: 'Summer sale', discountPercent: 15, source: 'historical_match',
    });
    assert.deepEqual(order, original);
    assert.deepEqual(prices, breakdown(order), 'display metadata never changes price arithmetic');
    assert.deepEqual(f.queries[0].where, { couponCode: null, createdAt: { lte: order.createdAt },
        OR: [{ scope: 'SERVICE', serviceId: 'rank-service' }, { scope: 'GLOBAL', serviceId: null }] });
    assert.deepEqual(Object.keys(f.queries[0].select).sort(), ['title', 'discountPercent', 'appliesTo', 'active',
        'scope', 'serviceId', 'createdAt', 'updatedAt', 'startsAt', 'endsAt'].sort(), 'no personal coupon recipients or codes are loaded');
});

test('expired-today campaigns still use their creation-time window; edited, disabled and time-mismatched records remain generic', async () => {
    // All dates are in the past: current campaign activity is not inferred using Date.now().
    const oldOrder = { ...order, createdAt: new Date('2020-01-15') };
    const oldCampaign = { ...campaign, createdAt: new Date('2020-01-01'), updatedAt: new Date('2020-01-01'),
        startsAt: new Date('2020-01-01'), endsAt: new Date('2020-02-01') };
    assert.equal((await historicalOrderPromotion(fixture([oldCampaign]).db, oldOrder, breakdown(oldOrder))).title, 'Summer sale');
    for (const change of [
        { updatedAt: new Date('2026-10-18') }, { updatedAt: null }, { active: false },
        { startsAt: new Date('2026-10-18') }, { endsAt: new Date('2026-10-16') },
        { startsAt: 'invalid' }, { endsAt: 'invalid' }, { createdAt: new Date('2026-10-18') },
    ]) assert.equal(await historicalOrderPromotion(fixture([{ ...campaign, ...change }]).db, order, breakdown(order)), null);
});

test('ambiguous matches and changed competitors never relabel an order from a surviving campaign', async () => {
    for (const candidates of [
        [campaign, { ...campaign, title: 'Other campaign' }],
        [campaign, { ...campaign, title: 'Edited campaign', active: false, updatedAt: new Date('2026-10-18') }],
        [campaign, { ...campaign, title: 'Edited service sale', scope: 'SERVICE', serviceId: order.serviceId, updatedAt: new Date('2026-10-18') }],
    ]) assert.equal(await historicalOrderPromotion(fixture(candidates).db, order, breakdown(order)), null);
});

test('service campaigns take precedence and a mismatching service campaign cannot fall back to a global sale', async () => {
    const service = { ...campaign, title: 'Rank sale', scope: 'SERVICE', serviceId: order.serviceId };
    assert.equal((await historicalOrderPromotion(fixture([campaign, service]).db, order, breakdown(order))).title, 'Rank sale');
    assert.equal(await historicalOrderPromotion(fixture([campaign, { ...service, discountPercent: 20 }]).db, order, breakdown(order)), null);
});

test('discount scope, clamping and rounding must reproduce the recorded promotion exactly', async () => {
    const selected = { ...order, basePrice: 100, addonPrice: 20, amountCents: 10200, totalPrice: 102 };
    for (const appliesTo of ['TOTAL', 'ORDER_TOTAL', 'WHOLE_ORDER', 'WHOLE_ORDER_TOTAL']) {
        const result = await historicalOrderPromotion(fixture([{ ...campaign, appliesTo }]).db, selected, breakdown(selected));
        assert.equal(result.discountPercent, 15);
    }
    assert.equal(await historicalOrderPromotion(fixture().db, selected, breakdown(selected)), null, 'base-only sale cannot explain whole-order discount');
    for (const change of [{ discountPercent: 20 }, { discountPercent: 'bad' }, { discountPercent: Infinity }, { discountPercent: 0 }, { title: '' }, { appliesTo: 'UNKNOWN' }]) {
        assert.equal(await historicalOrderPromotion(fixture([{ ...campaign, ...change }]).db, order, breakdown(order)), null);
    }
    const capped = { ...selected, amountCents: 3000, totalPrice: 30 };
    assert.equal((await historicalOrderPromotion(fixture([{ ...campaign, discountPercent: 99 }]).db, capped, breakdown(capped))).discountPercent, 90);
    assert.equal(await historicalOrderPromotion(fixture().db, order, { ...breakdown(order), promotionCents: 35994 }), null, 'one-cent mismatch remains generic');
});

test('referral and Gold do not change campaign attribution; coupons, incomplete snapshots and no discount skip the lookup', async () => {
    const discounted = { ...order, basePrice: 100, addonPrice: 20, referralDiscount: 10.5,
        amountCents: 9450, totalPrice: 94.5, goldDiscountCents: 1000, cashAmountCents: 8450 };
    assert.equal((await historicalOrderPromotion(fixture().db, discounted, breakdown(discounted))).discountPercent, 15);
    const f = fixture();
    for (const change of [
        { couponSaleId: 'coupon' }, { createdAt: null }, { createdAt: 'invalid' }, { serviceId: null },
        { basePrice: undefined }, { addonPrice: undefined }, { basePrice: 0, addonPrice: 0 },
        { amountCents: 240265 }, { amountCents: 999999 },
    ]) {
        const value = { ...order, ...change };
        assert.equal(await historicalOrderPromotion(f.db, value, breakdown(value)), null);
    }
    assert.equal(f.queries.length, 0);
});

test('an absent campaign or optional lookup failure keeps the existing generic promotion and amounts', async () => {
    const prices = breakdown(order);
    assert.equal(await historicalOrderPromotion(fixture([]).db, order, prices), null);
    assert.equal(await historicalOrderPromotion({ serviceSale: { findMany: async () => { throw new Error('private database information'); } } }, order, prices), null);
    assert.deepEqual(prices, breakdown(order));
});
