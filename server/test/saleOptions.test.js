const test = require('node:test');
const assert = require('node:assert/strict');
const { saleOptions } = require('../src/utils/saleOptions');

test('global coupon dates are optional, codes normalized, footer saved and discount is base only', () => {
    const value = saleOptions({ scope: 'GLOBAL', saleMode: 'WITH_COUPON', couponCode: ' welcome15 ', appliesTo: 'TOTAL', footerDecoration: true });
    assert.equal(value.couponCode, 'WELCOME15');
    assert.equal(value.startsAt, null);
    assert.equal(value.endsAt, null);
    assert.equal(value.appliesTo, 'BASE_PRICE');
    assert.equal(value.footerDecoration, true);
    assert.throws(() => saleOptions({ scope: 'GLOBAL', saleMode: 'WITH_COUPON', couponCode: 'bad code' }));
});

test('automatic global sales require valid ordered dates and never retain coupon codes', () => {
    assert.throws(() => saleOptions({ scope: 'GLOBAL' }));
    assert.throws(() => saleOptions({ scope: 'GLOBAL', startsAt: 'bad', endsAt: 'bad' }));
    assert.throws(() => saleOptions({ scope: 'GLOBAL', startsAt: '2099-02-01', endsAt: '2099-01-01' }));
    const value = saleOptions({ scope: 'GLOBAL', startsAt: '2099-01-01', endsAt: '2099-02-01', couponCode: 'IGNORE' });
    assert.equal(value.couponCode, null);
});

test('pricing catalog excludes coupon campaigns from automatic discounts', async t => {
    const prismaPath = require.resolve('../src/prisma');
    const cachePath = require.resolve('../src/utils/pricingCatalogCache');
    const oldPrisma = require.cache[prismaPath];
    const oldCache = require.cache[cachePath];
    const queries = [];
    require.cache[prismaPath] = { exports: {
        servicePriceRule: { findFirst: async () => ({ serviceId: 'rank', pricingType: 'PER_WIN' }) },
        serviceSale: { findFirst: async ({ where }) => { queries.push(where); return null; } },
    } };
    delete require.cache[cachePath];
    t.after(() => { if (oldPrisma) require.cache[prismaPath] = oldPrisma; else delete require.cache[prismaPath]; if (oldCache) require.cache[cachePath] = oldCache; else delete require.cache[cachePath]; });
    await require(cachePath).getPricingCatalog('Rank Boost');
    assert.equal(queries.length, 2);
    for (const query of queries) assert.equal(query.couponCode, null);
});

test('admin saves coupons independently from automatic campaigns', async t => {
    const records = [];
    let globalChecks = 0;
    const mocks = new Map([
        [require.resolve('../src/prisma'), { serviceSale: {
            findFirst: async () => { globalChecks++; return { id: 'existing-sale' }; },
            create: async ({ data }) => { records.push(data); return { id: 'coupon', ...data }; },
        } }],
        [require.resolve('../src/utils/pricingCatalogCache'), { invalidatePricingCatalog() {} }],
    ]);
    const db = mocks.get(require.resolve("../src/prisma"));
    db.$transaction = async callback => callback(db);
    db.serviceSale.updateMany = async () => ({ count: 0 });
    const saved = new Map();
    for (const [path, exports] of mocks) { saved.set(path, require.cache[path]); require.cache[path] = { exports }; }
    const controller = require.resolve('../src/controllers/priceController');
    delete require.cache[controller];
    t.after(() => { delete require.cache[controller]; for (const [path, old] of saved) { if (old) require.cache[path] = old; else delete require.cache[path]; } });
    const { createSale } = require(controller);
    const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
    await createSale({ body: { scope: 'GLOBAL', saleMode: 'WITH_COUPON', couponCode: 'newaccount', discountPercent: 15, footerDecoration: true, appliesTo: 'TOTAL' } }, res);
    assert.equal(res.code, 201);
    assert.equal(records[0].couponCode, 'NEWACCOUNT');
    assert.equal(records[0].footerDecoration, true);
    assert.equal(records[0].appliesTo, 'BASE_PRICE');
    assert.equal(records[0].startsAt, null);
    assert.equal(globalChecks, 0);
    await createSale({ body: { scope: 'GLOBAL', discountPercent: 15, startsAt: '2099-01-01', endsAt: '2099-02-01' } }, res);
    assert.equal(res.code, 409);
    assert.equal(globalChecks, 1);
});


test('automatic global and service sales can start immediately with a blank start', () => {
    for (const scope of ['GLOBAL', 'SERVICE']) {
        for (const startsAt of [undefined, null, '']) {
            const value = saleOptions({ scope, startsAt, endsAt: '2099-02-01' });
            assert.equal(value.startsAt, null);
            assert.equal(value.endsAt.toISOString(), '2099-02-01T00:00:00.000Z');
        }
        assert.throws(() => saleOptions({ scope, endsAt: '2000-01-01' }));
        assert.throws(() => saleOptions({ scope, startsAt: '2099-01-01' }));
    }
});
