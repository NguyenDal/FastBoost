const test = require('node:test');
const assert = require('node:assert/strict');
const { orderQuantities, orderChampionPreferences } = require('../src/utils/orderQuantity');

test('purchased game counts and Master LP reject malformed values instead of silently clamping prices', () => {
    const rule = { pricingType: 'PLACEMENT_BASED', config: { fullSetGames: 5 } };
    for (const value of [-10, 0, 1.5, 1000000, '2.5', 'NaN', true, [], {}, '1e2']) {
        assert.throws(() => orderQuantities({ placementGames: value }, rule), error => error.status === 400);
    }
    for (const field of ['desiredWins', 'numberOfGames']) {
        for (const value of [-1, 0, 1.1, Infinity, '0', true, {}, 2147483648]) {
            assert.throws(() => orderQuantities({ [field]: value }, rule), error => error.status === 400);
        }
    }
    for (const field of ['currentMasterLp', 'desiredMasterLp']) {
        for (const value of [-1, 1000, 1.5, 'NaN', [], true]) {
            assert.throws(() => orderQuantities({ [field]: value }, rule), error => error.status === 400);
        }
    }
    assert.equal(orderQuantities({ placementGames: '5' }, rule).placementGames, 5);
    assert.equal(orderQuantities({}, rule).placementGames, 1);
});

test('real order creation prices and persists the same validated placement quantity', async t => {
    const stored = [];
    const db = {
        service: { findFirst: async () => ({ id: 'placement', title: 'Placement Boost' }) },
        servicePriceRule: { findFirst: async () => ({ active: true, pricingType: 'PLACEMENT_BASED', config: { fullSetGames: 5, fullSetPrices: { Gold: 100 }, addons: { championPreference: { '1': 0.1, '2-3': 0.05, '4+': 0 } } } }), findMany: async () => [] },
        serviceSale: { findFirst: async () => null },
        order: { create: async ({ data }) => { stored.push(data); return { id: 'order', ...data }; } },
    };
    const files = new Map([
        [require.resolve('../src/prisma'), db],
        [require.resolve('../src/utils/stripeClient'), {}],
        [require.resolve('../src/utils/referralProgram'), { getReferralFirstPurchaseOffer: async () => ({ eligible: false }), applyReferralFirstPurchaseDiscount: totalPrice => ({ totalPrice, referralDiscount: 0 }) }],
        [require.resolve('../src/utils/orderPasswordCrypto'), { stripEncryptedPasswordFields: order => ({ ...order }), hasEncryptedPasswordFields: () => false }],
    ]);
    const path = require.resolve('../src/controllers/orderController');
    const previous = new Map([[path, require.cache[path]]]);
    for (const [key, exports] of files) { previous.set(key, require.cache[key]); require.cache[key] = { exports, loaded: true }; }
    delete require.cache[path];
    const { createOrder } = require(path);
    t.after(() => { for (const [key, value] of previous) { if (value) require.cache[key] = value; else delete require.cache[key]; } });
    for (const value of [-10, 1000000, '1.5', true]) {
        const res = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
        await createOrder({ user: { id: 'customer' }, body: { serviceId: 'placement', boostType: 'Placement Boost', placementGames: value, peakRank: 'Gold' } }, res);
        assert.equal(res.code, 400);
    }
    assert.equal(stored.length, 0);
    for (const value of ['3', undefined]) {
        const res = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
        await createOrder({ user: { id: 'customer' }, body: { serviceId: 'placement', boostType: 'Placement Boost', placementGames: value, peakRank: 'Gold' } }, res);
        assert.equal(res.code, 201);
        assert.equal(res.body.order.placementGames, value === '3' ? 3 : 1);
        assert.equal(res.body.order.amountCents, value === '3' ? 6000 : 2000);
    }
    const res = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
    await createOrder({ user: { id: 'customer' }, body: { serviceId: 'placement', boostType: 'Placement Boost', placementGames: 5,
        peakRank: 'Gold', selectedChampions: ['Ahri', 'ahri', ' Ahri ', 'Ahri\u200b'], championPreferenceTier: '4+' } }, res);
    assert.equal(res.code, 201);
    assert.deepEqual(res.body.order.selectedChampions, ['Ahri']);
    assert.equal(res.body.order.championPreferenceTier, '1');
    assert.equal(res.body.order.amountCents, 11000);
});

test('champion preference fees are derived from the distinct saved selection', () => {
    assert.deepEqual(orderChampionPreferences(['Ahri', 'Annie']), { selectedChampions: ['Ahri', 'Annie'], championPreferenceTier: '2-3' });
    assert.equal(orderChampionPreferences([]).championPreferenceTier, '4+');
    for (const value of [true, {}, [''], [{}], [1], ['a'.repeat(101)]]) assert.throws(() => orderChampionPreferences(value), error => error.status === 400);
});
