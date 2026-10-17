const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { calculateOrderPrice } = require('../src/utils/pricingCalculator');

const cents = value => Math.round(value * 100);
const prices = quote => Object.fromEntries(['basePrice', 'addonPrice', 'subtotal', 'saleDiscount', 'totalPrice'].map(key => [key, quote[key]]));
const fixedRule = (basePrice = 8, addons = {}) => ({ active: true, game: 'LOL', pricingType: 'FIXED', basePrice, config: { addons } });
const sale = { active: true, title: 'Summer sale', discountPercent: 15, appliesTo: 'BASE_PRICE' };
function assertBalanced(quote) {
    assert.equal(quote.addons.reduce((sum, row) => sum + row.amountCents, 0), cents(quote.addonPrice));
    assert.equal(cents(quote.basePrice) + cents(quote.addonPrice) - (quote.promotion?.amountCents || 0) + quote.roundingAdjustmentCents, cents(quote.totalPrice));
    for (const row of quote.addons) assert.ok(Number.isInteger(row.amountCents) && row.amountCents >= 0);
}

test('quote immediately exposes the named 15% promotion on an $8 base', () => {
    const quote = calculateOrderPrice({ rule: fixedRule(), options: { playMode: 'Solo' }, sale });
    assert.deepEqual(prices(quote), { basePrice: 8, addonPrice: 0, subtotal: 8, saleDiscount: 1.2, totalPrice: 6.8 });
    assert.deepEqual(quote.promotion, { title: 'Summer sale', discountPercent: 15, amountCents: 120 });
    assert.deepEqual(quote.addons, []);
    assertBalanced(quote);
});

for (const game of ['LOL', 'TFT']) {
    for (const [pricingType, expected] of [
        ['RANK_BASED', [7.2, 1.44, 8.64, 1.08, 7.56]],
        ['PLACEMENT_BASED', [18, 3.6, 21.6, 2.7, 18.9]],
        ['PER_WIN', [9, 1.8, 10.8, 1.35, 9.45]],
        ['DUO_ADDON', [16.8, 3.36, 20.16, 2.52, 17.64]],
    ]) {
        test(`${game} ${pricingType} preserves canonical prices and exposes selected Express`, () => {
            const input = {
                rule: { active: true, game, pricingType, config: {
                    rankOptions: ['Silver IV', 'Silver III'], divisionStepPrices: { 'Silver IV': 8 },
                    modifiers: { currentLpProgress: { partial: 0.75 }, lpGain: { normal: 1.2 } },
                    fullSetGames: 5, fullSetPrices: { 'Silver IV': 30 },
                    perWinPrices: { 'Silver IV': 2.5 }, multiplier: 1.4,
                    addons: { expressPercent: 0.2, championPreference: { '4+': 0 } },
                } },
                options: { currentRank: 'Silver IV', desiredRank: 'Silver III', currentLP: 'partial', lpGain: 'normal',
                    peakRank: 'Silver IV', placementGames: 3, desiredWins: 3, numberOfGames: 4,
                    playMode: pricingType === 'DUO_ADDON' ? 'Duo' : 'Solo', priorityOrder: true, championPreferenceTier: '4+' },
                sale,
            };
            const before = structuredClone(input);
            const quote = calculateOrderPrice(input);
            assert.deepEqual(Object.values(prices(quote)), expected);
            assert.deepEqual(quote.addons, [{ key: 'priorityOrder', amountCents: cents(expected[1]) }]);
            assert.equal(quote.promotion.amountCents, cents(expected[3]));
            assertBalanced(quote);
            assert.deepEqual(input, before);
        });
    }
}

test('each add-on follows its existing mode gate, Duo-adjusted base and same-game bonus-win rule', () => {
    const rule = fixedRule(100, {
        duoModeMultiplier: 1.4, duoExtraPercent: 0.4, expressPercent: 0.2,
        premiumCoachingPercent: 0.25, soloOnlyPercent: 0.1, highMmrDuoPercent: 0.15,
        untrackableDuoPercent: 0.1, championPreference: { 1: 0.05 }, bonusWin: { duoMultiplier: 1.6 },
    });
    const referenceRules = [
        { game: 'TFT', pricingType: 'PER_WIN', config: { perWinPrices: { 'Silver IV': 20 } } },
        { game: 'LOL', pricingType: 'PER_WIN', config: { perWinPrices: { 'Silver IV': 7 } } },
    ];
    const options = { currentRank: 'Silver IV', priorityOrder: true, premiumCoaching: true, soloOnly: true,
        highMMRDuo: true, untrackableDuo: true, bonusWin: true, championPreferenceTier: '1' };
    const solo = calculateOrderPrice({ rule, options: { ...options, playMode: 'Solo' }, referenceRules });
    assert.deepEqual(solo.addons, [
        { key: 'priorityOrder', amountCents: 2000 }, { key: 'soloOnly', amountCents: 1000 },
        { key: 'bonusWin', amountCents: 700 }, { key: 'championPreference', amountCents: 500 },
    ]);
    const duo = calculateOrderPrice({ rule, options: { ...options, playMode: 'Duo' }, referenceRules });
    assert.deepEqual(duo.addons, [
        { key: 'duoMode', amountCents: 4000 }, { key: 'priorityOrder', amountCents: 2800 },
        { key: 'premiumCoaching', amountCents: 3500 }, { key: 'highMMRDuo', amountCents: 2100 },
        { key: 'untrackableDuo', amountCents: 1400 }, { key: 'bonusWin', amountCents: 1120 },
        { key: 'championPreference', amountCents: 700 },
    ]);
    assert.equal(solo.addonPrice, 42);
    assert.equal(duo.addonPrice, 156.2);
    assertBalanced(solo);
    assertBalanced(duo);
});

test('selected free options are retained while default champion tier is omitted', () => {
    const rule = fixedRule(8, { expressPercent: 0, championPreference: { 1: 0, '4+': 0 } });
    const options = { playMode: 'Solo', priorityOrder: true, championPreferenceTier: '1', premiumCoaching: true };
    const quote = calculateOrderPrice({ rule, options });
    assert.deepEqual(quote.addons, [{ key: 'priorityOrder', amountCents: 0 }, { key: 'championPreference', amountCents: 0 }]);
    const defaultTier = calculateOrderPrice({ rule, options: { ...options, championPreferenceTier: '4+' } });
    assert.deepEqual(defaultTier.addons, [{ key: 'priorityOrder', amountCents: 0 }]);
    assertBalanced(quote);
    assertBalanced(defaultTier);
});

test('fractional add-on cents are distributed stably and sum to the unchanged aggregate', () => {
    const input = { rule: fixedRule(0.03, { expressPercent: 0.5, soloOnlyPercent: 0.5, championPreference: { 1: 0.5 } }),
        options: { playMode: 'Solo', priorityOrder: true, soloOnly: true, championPreferenceTier: '1' } };
    const quote = calculateOrderPrice(input);
    assert.deepEqual(prices(quote), { basePrice: 0.03, addonPrice: 0.05, subtotal: 0.08, saleDiscount: 0, totalPrice: 0.08 });
    assert.deepEqual(quote.addons, [
        { key: 'priorityOrder', amountCents: 2 }, { key: 'soloOnly', amountCents: 2 }, { key: 'championPreference', amountCents: 1 },
    ]);
    assert.deepEqual(calculateOrderPrice(input), quote);
    assertBalanced(quote);
});

test('fractional bases retain the original payable amount and expose only the residual cent', () => {
    const input = { rule: { active: true, game: 'LOL', pricingType: 'PLACEMENT_BASED',
        config: { fullSetGames: 5, fullSetPrices: { Silver: 10.11 }, addons: { expressPercent: 0.2 } } },
        options: { playMode: 'Solo', peakRank: 'Silver IV', placementGames: 1, priorityOrder: true } };
    const quote = calculateOrderPrice(input);
    assert.deepEqual(prices(quote), { basePrice: 2.02, addonPrice: 0.4, subtotal: 2.43, saleDiscount: 0, totalPrice: 2.43 });
    assert.equal(quote.promotion, null);
    assert.equal(quote.roundingAdjustmentCents, 1);
    assertBalanced(quote);
    const discounted = calculateOrderPrice({ ...input, sale });
    assert.equal(discounted.totalPrice, 2.12);
    assert.equal(discounted.promotion.amountCents, 30);
    assert.equal(discounted.roundingAdjustmentCents, 0);
    assertBalanced(discounted);
});

test('all whole-order sale aliases keep the existing discount scope and quoted amount', () => {
    for (const appliesTo of ['TOTAL', 'ORDER_TOTAL', 'WHOLE_ORDER', 'WHOLE_ORDER_TOTAL']) {
        const quote = calculateOrderPrice({ rule: fixedRule(8, { expressPercent: 0.5 }),
            options: { playMode: 'Solo', priorityOrder: true }, sale: { ...sale, appliesTo } });
        assert.deepEqual(prices(quote), { basePrice: 8, addonPrice: 4, subtotal: 12, saleDiscount: 1.8, totalPrice: 10.2 });
        assert.equal(quote.promotion.amountCents, 180);
        assertBalanced(quote);
    }
    const quote = calculateOrderPrice({ rule: fixedRule(8, { expressPercent: 0.5 }),
        options: { playMode: 'Solo', priorityOrder: true }, sale });
    assert.equal(quote.promotion.amountCents, 120);
    assert.equal(quote.totalPrice, 10.8);
    assertBalanced(quote);
});

test('inactive, future, expired and zero-percent sales do not invent a promotion', () => {
    for (const candidate of [null, { ...sale, active: false }, { ...sale, startsAt: '2999-01-01' },
        { ...sale, endsAt: '2000-01-01' }, { ...sale, discountPercent: 0 }]) {
        const quote = calculateOrderPrice({ rule: fixedRule(), options: {}, sale: candidate });
        assert.equal(quote.promotion, null);
        assert.equal(quote.totalPrice, 8);
        assertBalanced(quote);
    }
    const capped = calculateOrderPrice({ rule: fixedRule(), options: {}, sale: { ...sale, title: '', discountPercent: 99 } });
    assert.deepEqual(capped.promotion, { title: 'Promotion', discountPercent: 90, amountCents: 720 });
    assert.equal(capped.totalPrice, 0.8);
    assertBalanced(capped);
});

test('quote endpoint returns the additive breakdown alongside existing fields without querying payment data', async () => {
    const catalog = { priceRule: { ...fixedRule(8, { expressPercent: 0.2 }), updatedAt: '2026-10-16T12:00:00.000Z' },
        activeSale: sale, referenceRules: [] };
    const handlers = {};
    const calls = [];
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/controllers/pricingController.js'), 'utf8'), {
        exports: handlers, console,
        require(moduleName) {
            if (moduleName === '../utils/pricingCalculator') return { calculateOrderPrice };
            if (moduleName === '../utils/pricingCatalogCache') return { getPricingCatalog: async boostType => { calls.push(boostType); return catalog; } };
            throw new Error(`Unexpected dependency: ${moduleName}`);
        },
    });
    const response = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
    await handlers.getPriceQuote({ body: { boostType: 'Rank Boost', priorityOrder: true, playMode: 'Solo' } }, response);
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.ok, true);
    assert.deepEqual(calls, ['Rank Boost']);
    assert.equal(response.body.pricingUpdatedAt, catalog.priceRule.updatedAt);
    assert.deepEqual(prices(response.body.quote), { basePrice: 8, addonPrice: 1.6, subtotal: 9.6, saleDiscount: 1.2, totalPrice: 8.4 });
    assert.deepEqual(response.body.quote.addons, [{ key: 'priorityOrder', amountCents: 160 }]);
    assert.deepEqual(response.body.quote.promotion, { title: 'Summer sale', discountPercent: 15, amountCents: 120 });
    assertBalanced(response.body.quote);
});
