const test=require('node:test');const assert=require('node:assert/strict');
const {syncLoyaltyTierBonuses}=require('../src/utils/loyaltyTierBonuses');
function fixture(spend){
 const rewards=[];const db={
 $queryRaw:async()=>[],
 order:{aggregate:async({where})=>{assert.equal(where.paymentStatus,'PAID');assert.equal(where.status,'COMPLETED');return {_sum:{totalPrice:spend.value}};}},
 rewardHistory:{findMany:async()=>rewards.slice(),deleteMany:async({where})=>{for(let i=rewards.length-1;i>=0;i--)if(where.id.in.includes(rewards[i].id))rewards.splice(i,1);},createMany:async({data,skipDuplicates})=>{assert.equal(skipDuplicates,true);for(const row of data)if(!rewards.some(r=>r.sourceUserId===row.sourceUserId))rewards.push({id:row.sourceUserId,...row});}}
 };return {rewards,prisma:{$transaction:async fn=>fn(db)}};
}
test('reconciles missed tiers, is idempotent and removes ineligible bonuses',async()=>{
 const spend={value:2148.25},f=fixture(spend);
 const result=await syncLoyaltyTierBonuses(f.prisma,'customer');
 assert.equal(result.createdBonuses.length,4);assert.equal(f.rewards.reduce((sum,r)=>sum+r.goldAmount,0),3200);
 assert.equal(f.rewards.find(r=>r.sourceUserId==='LOYALTY_TIER_DIAMOND').goldAmount,1500);
 await syncLoyaltyTierBonuses(f.prisma,'customer');assert.equal(f.rewards.length,4);
 spend.value=500;await syncLoyaltyTierBonuses(f.prisma,'customer');assert.equal(f.rewards.length,2);
 spend.value=199;await syncLoyaltyTierBonuses(f.prisma,'customer');assert.equal(f.rewards.length,0);
});
