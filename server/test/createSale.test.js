const test=require('node:test');
const assert=require('node:assert/strict');
const {createSale}=require('../src/utils/createSale');
for(const state of ['expired','disabled','active','scheduled']) test(`reservation ${state}`,async()=>{
 const now=new Date('2026-09-22');
 const old={id:'old',couponCode:'REUSE20',active:state!=='disabled',endsAt:new Date(state==='expired'?'2026-09-21':'2026-10-01'),startsAt:state==='scheduled'?new Date('2026-09-25'):null};
 const rows=[old];
 const db={$transaction:async fn=>fn({serviceSale:{
 updateMany:async({where,data})=>{for(const r of rows) if(r.couponCode===where.couponCode&&r.active&&r.endsAt<=where.endsAt.lte) Object.assign(r,data);},
 create:async({data})=>{if(rows.some(r=>r.active&&r.couponCode===data.couponCode))throw Object.assign(new Error('duplicate'),{code:'P2002'});const r={id:'new',...data};rows.push(r);return r;}
 }})};
 const create=()=>createSale(db,{couponCode:'REUSE20',active:true},now);
 if(['active','scheduled'].includes(state)) {await assert.rejects(create,{code:'P2002'});assert.equal(old.active,true);}
 else {assert.equal((await create()).id,'new');assert.equal(old.active,false);assert.equal(rows.length,2);}
 assert.equal(old.couponCode,'REUSE20');
});
