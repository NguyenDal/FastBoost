const test=require('node:test');const assert=require('node:assert/strict');
const {normalizeGoldToUse}=require('../src/utils/goldRedemption');
test('gold redemption requires at least 100 balance, not a minimum spend of 100',()=>{
 for(const balance of [0,50,99])assert.deepEqual(normalizeGoldToUse(50,balance,1000),{goldRedeemed:0,goldDiscountCents:0,cashAmountCents:1000});
 assert.deepEqual(normalizeGoldToUse(20,100,1000),{goldRedeemed:20,goldDiscountCents:200,cashAmountCents:800});
 assert.deepEqual(normalizeGoldToUse(100,100,1000),{goldRedeemed:100,goldDiscountCents:1000,cashAmountCents:0});
 assert.equal(normalizeGoldToUse(0,99,1000).goldRedeemed,0);
 assert.equal(normalizeGoldToUse(99,100,1000).cashAmountCents,50);
});
