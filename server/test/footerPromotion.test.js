const test = require('node:test');
const assert = require('node:assert/strict');
const { saleOptions } = require('../src/utils/saleOptions');

test('hiding the footer countdown preserves sale expiration', () => {
    const sale = saleOptions({ startsAt: '2099-01-01', endsAt: '2099-02-01', footerDecoration: true, footerTimer: false });
    assert.equal(sale.footerTimer, false);
    assert.equal(sale.endsAt.toISOString(), '2099-02-01T00:00:00.000Z');
});

test('public footer only selects current public opted-in campaigns and prefers the requested service', async t => {
    const path = require.resolve('../src/prisma');
    const controller = require.resolve('../src/controllers/promotionController');
    const old = require.cache[path];
    const queries = [];
    let result = null;
    require.cache[path] = { exports: { serviceSale: { findFirst: async query => { queries.push(query); return result; } } } };
    delete require.cache[controller];
    t.after(() => { delete require.cache[controller]; if (old) require.cache[path] = old; else delete require.cache[path]; });
    const { getFooterPromotion } = require(controller);
    const res = { set() {}, json(value) { this.body = value; }, status() { return this; } };
    await getFooterPromotion({ query: {} }, res);
    assert.equal(queries.length, 1);
    assert.equal(queries[0].where.scope, 'GLOBAL');
    assert.equal(res.body.promotion, null);
    await getFooterPromotion({ query: { serviceId: 'rank' } }, res);
    assert.equal(queries[1].where.serviceId, 'rank');
    assert.equal(queries[1].where.service.priceRules.some.active, true);
    assert.equal(queries[2].where.scope, 'GLOBAL');
    for (const { where, select } of queries) {
        assert.equal(where.active, true);
        assert.equal(where.footerDecoration, true);
        assert.equal(where.recipientAccountId, null);
        assert.ok(where.AND[0].OR[1].startsAt.lte instanceof Date);
        assert.ok(where.AND[1].OR[1].endsAt.gt instanceof Date);
        assert.equal(select.recipientAccountId, undefined);
        assert.equal(select.personalReason, undefined);
    }
    result = { id: 'service-sale' };
    queries.length = 0;
    await getFooterPromotion({ query: { serviceId: 'rank' } }, res);
    assert.equal(queries.length, 1);
    assert.equal(res.body.promotion.id, 'service-sale');
});
