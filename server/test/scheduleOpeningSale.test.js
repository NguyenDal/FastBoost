const test = require('node:test');
const assert = require('node:assert/strict');
const {
    OPENING_SALE,
    assertDevelopmentDatabase,
    matchesOpeningSale,
    planOpeningSale,
    saleData,
    assertFrontendCampaignMatches,
} = require('../scripts/scheduleOpeningSale');

const now = new Date('2026-10-26T00:00:00.000Z');
const exactSale = { id: 'existing', ...saleData() };

test('opening sale matches the client campaign and creates exact base-only data', async () => {
    await assertFrontendCampaignMatches();
    assert.equal(OPENING_SALE.discountPercent, 15);
    assert.equal(OPENING_SALE.appliesTo, 'BASE_PRICE');
    assert.equal(saleData().couponCode, null);
    assert.equal(saleData().scope, 'GLOBAL');
    assert.equal(saleData().startsAt.toISOString(), '2026-11-01T00:00:00.000Z');
    assert.equal(saleData().endsAt.toISOString(), '2026-12-01T00:00:00.000Z');
});

test('an exact existing sale is left unchanged', () => {
    assert.equal(matchesOpeningSale(exactSale), true);
    assert.deepEqual(planOpeningSale([exactSale], now),
        { status: 'EXISTS', existingId: 'existing', conflicts: [] });
});

test('conflicting service or global automatic sales block creation', () => {
    const overlappingService = { ...exactSale, id: 'service', scope: 'SERVICE', serviceId: 'rank' };
    const otherGlobal = { ...exactSale, id: 'other', title: 'Later sale',
        startsAt: new Date('2026-12-10T00:00:00.000Z'),
        endsAt: new Date('2026-12-20T00:00:00.000Z') };

    assert.equal(planOpeningSale([overlappingService], now).status, 'CONFLICT');
    assert.equal(planOpeningSale([otherGlobal], now).status, 'CONFLICT');
    assert.equal(planOpeningSale([exactSale, overlappingService], now).status, 'CONFLICT');
});

test('inactive, expired, and coupon sales do not block an automatic sale', () => {
    const inactive = { ...exactSale, id: 'inactive', active: false };
    const expired = { ...exactSale, id: 'expired', endsAt: new Date('2026-10-25T00:00:00.000Z') };
    const coupon = { ...exactSale, id: 'coupon', couponCode: 'OPEN15' };
    assert.deepEqual(planOpeningSale([inactive, expired, coupon], now),
        { status: 'READY', existingId: null, conflicts: [] });
});

test('database guard accepts only the expected development host outside production', () => {
    assert.doesNotThrow(() => assertDevelopmentDatabase('postgres://user:password@db.prisma.io/postgres', 'development'));
    assert.throws(() => assertDevelopmentDatabase('postgres://user:password@production.example/postgres', 'development'));
    assert.throws(() => assertDevelopmentDatabase('postgres://user:password@db.prisma.io/postgres', 'production'));
});
