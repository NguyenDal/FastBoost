const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeGoldToUse } = require('../src/utils/goldRedemption');

test('redemption is zero or at least 100 after all caps and payment adjustments', () => {
    for (const [requested, balance, total] of [[1,500,5000],[99,500,5000],[100,99,5000],[100,500,990],[100,500,1010],[103,500,1040]]) {
        assert.deepEqual(normalizeGoldToUse(requested,balance,total), {goldRedeemed:0,goldDiscountCents:0,cashAmountCents:total});
    }
    assert.deepEqual(normalizeGoldToUse(100,100,1000), {goldRedeemed:100,goldDiscountCents:1000,cashAmountCents:0});
    assert.equal(normalizeGoldToUse(100,500,1050).goldRedeemed,100);
    assert.equal(normalizeGoldToUse(150,500,2000).goldRedeemed,150);
    assert.equal(normalizeGoldToUse(0,500,2000).goldRedeemed,0);
    for (let total = 950; total <= 1100; total++) {
        const result = normalizeGoldToUse(110,500,total);
        assert.ok(result.goldRedeemed === 0 || result.goldRedeemed >= 100);
        assert.equal(result.cashAmountCents + result.goldDiscountCents,total);
    }
});
