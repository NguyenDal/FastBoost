const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateOrderPrice, isSaleActive } = require('../src/utils/pricingCalculator');

const startsAt = '2026-11-01T00:00:00.000Z';
const endsAt = '2026-12-01T00:00:00.000Z';
const sale = { active: true, title: 'Opening month', discountPercent: 15,
    appliesTo: 'BASE_PRICE', startsAt, endsAt };
const rule = { active: true, game: 'LOL', pricingType: 'FIXED', basePrice: 100,
    config: { addons: { expressPercent: 0.2 } } };
const options = { playMode: 'Solo', priorityOrder: true };

test('opening sale starts exactly at launch and ends before its end instant', () => {
    const cases = [
        ['2026-10-31T23:59:59.999Z', false, 0, 120],
        [startsAt, true, 15, 105],
        ['2026-11-30T23:59:59.999Z', true, 15, 105],
        [endsAt, false, 0, 120],
    ];

    for (const [instant, active, discount, total] of cases) {
        const now = new Date(instant);
        assert.equal(isSaleActive(sale, now), active, instant);
        const quote = calculateOrderPrice({ rule, options, sale, now });
        assert.equal(quote.basePrice, 100, instant);
        assert.equal(quote.addonPrice, 20, instant);
        assert.equal(quote.saleDiscount, discount, instant);
        assert.equal(quote.totalPrice, total, instant);
        assert.equal(quote.promotion?.amountCents || 0, discount * 100, instant);
    }
});

test('catalog sale query uses the same start-inclusive, end-exclusive boundaries', t => {
    const prismaPath = require.resolve('../src/prisma');
    const cachePath = require.resolve('../src/utils/pricingCatalogCache');
    const previousPrisma = require.cache[prismaPath];
    const previousCache = require.cache[cachePath];
    require.cache[prismaPath] = { exports: {} };
    delete require.cache[cachePath];
    t.after(() => {
        if (previousPrisma) require.cache[prismaPath] = previousPrisma;
        else delete require.cache[prismaPath];
        if (previousCache) require.cache[cachePath] = previousCache;
        else delete require.cache[cachePath];
    });

    const { getSaleTimeWindow } = require(cachePath);
    for (const instant of [startsAt, '2026-11-30T23:59:59.999Z', endsAt]) {
        const now = new Date(instant);
        const window = getSaleTimeWindow(now);
        assert.equal(window.AND[0].OR[1].startsAt.lte, now);
        assert.equal(window.AND[1].OR[1].endsAt.gt, now);
    }
});
