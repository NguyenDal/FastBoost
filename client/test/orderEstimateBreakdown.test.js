import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { orderEstimateBreakdown } from '../src/utils/orderEstimateBreakdown.js';

const require = createRequire(import.meta.url);
const { calculateOrderPrice } = require('../../server/src/utils/pricingCalculator.js');
const sumRows = breakdown => breakdown.rows.reduce((sum, row) => sum + row.amountCents, 0);

test('base and immediate summer promotion appear before the discounted subtotal', () => {
    const result = orderEstimateBreakdown({ basePrice: 8, addonPrice: 0, saleDiscount: 1.2, totalPrice: 6.8,
        addons: [], promotion: { title: 'Summer sale', discountPercent: 15, amountCents: 120 } });
    assert.deepEqual(result.rows, [
        { key: 'base', label: 'Base price', amountCents: 800, kind: 'base' },
        { key: 'promotion', label: 'Summer sale (15%)', amountCents: -120, kind: 'discount' },
    ]);
    assert.equal(result.subtotalCents, 680);
    assert.equal(sumRows(result), 680);
});

test('selected add-ons use authoritative quoted prices and referral applies once after the sale', () => {
    const quote = { basePrice: 8, addonPrice: 3.2, saleDiscount: 1.2, totalPrice: 10,
        promotion: { title: 'Summer sale', discountPercent: 15, amountCents: 120 },
        addons: [{ key: 'priorityOrder', amountCents: 240 }, { key: 'soloOnly', amountCents: 80 }] };
    const result = orderEstimateBreakdown(quote, { referralDiscount: 1 });
    assert.deepEqual(result.rows.map(row => [row.label, row.amountCents]), [
        ['Base price', 800], ['Summer sale (15%)', -120], ['Express', 240], ['Solo only', 80], ['Referral discount', -100],
    ]);
    assert.equal(result.subtotalCents, 900);
    assert.equal(sumRows(result), result.subtotalCents);
    assert.equal(result.rows.some(row => /coupon|gold/i.test(row.label)), false);
});

test('selected free options stay visible and champion preference is never counted twice', () => {
    const quote = { basePrice: 10, addonPrice: 0, saleDiscount: 0, totalPrice: 10,
        addons: [{ key: 'priorityOrder', amountCents: 0 }, { key: 'championPreference', amountCents: 0 }] };
    const result = orderEstimateBreakdown(quote, {
        selections: { liveStream: true, appearOffline: true }, championPreferenceEnabled: true,
    });
    assert.deepEqual(result.rows.filter(row => row.kind === 'addon').map(row => [row.label, row.amountCents]), [
        ['Express', 0], ['Roles/champions', 0], ['Stream games', 0], ['Appear offline', 0],
    ]);
    assert.equal(sumRows(result), 1000);
    const enabled = orderEstimateBreakdown({ ...quote, addons: [] }, { championPreferenceEnabled: true });
    assert.equal(enabled.rows.at(-1).label, 'Roles/champions');
    assert.equal(enabled.rows.at(-1).amountCents, 0);
    assert.equal(orderEstimateBreakdown({ ...quote, addons: [] }).rows.length, 1);
});

test('all chargeable add-ons have compact labels without changing quoted prices', () => {
    const keys = ['duoMode', 'priorityOrder', 'premiumCoaching', 'soloOnly', 'highMMRDuo', 'untrackableDuo', 'bonusWin', 'championPreference'];
    const result = orderEstimateBreakdown({ basePrice: 10, addonPrice: 8, saleDiscount: 0, totalPrice: 18,
        addons: keys.map(key => ({ key, amountCents: 100 })) });
    assert.deepEqual(result.rows.slice(1).map(row => row.label), [
        'Duo', 'Express', 'Coaching', 'Solo only', 'High MMR', 'Untrackable', 'Bonus win', 'Roles/champions',
    ]);
    assert.equal(sumRows(result), 1800);
});

test('independent cent rounding is explicit and does not change the server estimate', () => {
    const result = orderEstimateBreakdown({ basePrice: 0.33, addonPrice: 0.13, totalPrice: 0.47,
        addons: [{ key: 'duoMode', amountCents: 13 }], promotion: null, roundingAdjustmentCents: 1 });
    assert.deepEqual(result.rows.at(-1), { key: 'rounding', label: 'Rounding', amountCents: 1, kind: 'rounding' });
    assert.equal(result.subtotalCents, 47);
    assert.equal(sumRows(result), 47);
});

test('older quotes retain aggregate add-ons without guessing paid options are free', () => {
    const result = orderEstimateBreakdown({ basePrice: 10, addonPrice: 1, saleDiscount: 0, totalPrice: 11 },
        { championPreferenceEnabled: true });
    assert.deepEqual(result.rows.map(row => row.label), ['Base price', 'Add-ons']);
    assert.equal(sumRows(result), 1100);
    assert.equal(orderEstimateBreakdown(null), null);
    assert.equal(orderEstimateBreakdown({ totalPrice: 10 }), null);
});

for (const game of ['LOL', 'TFT']) {
    for (const pricingType of ['RANK_BASED', 'PLACEMENT_BASED', 'PER_WIN', 'DUO_ADDON']) {
        test(`${game} ${pricingType} breakdown reconciles the canonical quote with Duo and bonus win`, () => {
            const config = {
                rankOptions: ['Silver I', 'Gold IV'], divisionStepPrices: { 'Silver I': 8 },
                fullSetGames: 5, fullSetPrices: { Silver: 41.37 }, perWinPrices: { Silver: 7.99 }, multiplier: 1.2,
                modifiers: { lpGain: { Standard: 1.13 } },
                addons: { duoModeMultiplier: 1.4, expressPercent: .3, premiumCoachingPercent: .4,
                    championPreference: { '1': .1 }, bonusWin: { duoMultiplier: 1.4 } },
            };
            const rule = { active: true, game, pricingType, config };
            const quote = calculateOrderPrice({ rule,
                options: { playMode: 'Duo', currentRank: 'Silver I', desiredRank: 'Gold IV', peakRank: 'Silver I',
                    placementGames: 2, desiredWins: 3, numberOfGames: 2, lpGain: 'Standard', priorityOrder: true,
                    premiumCoaching: true, bonusWin: true, championPreferenceTier: '1' },
                sale: { active: true, title: 'Summer sale', discountPercent: 15, appliesTo: 'WHOLE_ORDER' },
                referenceRules: [{ game, pricingType: 'PER_WIN', config: { perWinPrices: { Silver: 7.99 } } }],
            });
            const referralDiscount = Math.round(quote.totalPrice * 10) / 100;
            const result = orderEstimateBreakdown(quote, { referralDiscount, championPreferenceEnabled: true });
            assert.ok(quote.addons.some(row => row.key === 'bonusWin'));
            assert.equal(quote.addons.some(row => row.key === 'duoMode'), pricingType !== 'DUO_ADDON');
            assert.equal(sumRows(result), Math.round(quote.totalPrice * 100) - Math.round(referralDiscount * 100));
            assert.equal(result.subtotalCents, sumRows(result));
            assert.equal(result.rows.find(row => row.key === 'promotion').label, 'Summer sale (15%)');
            assert.equal(result.rows.some(row => row.key === 'rounding'), false, 'active promotion absorbs cent presentation rounding');
        });
    }
}
