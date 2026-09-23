const test=require('node:test');const assert=require('node:assert/strict');
test('dashboard includes public and own personal coupons while keeping usage account-scoped',async t=>{
 const key=require.resolve('../src/prisma'),ctrl=require.resolve('../src/controllers/personalCouponController'),old=require.cache[key];
 require.cache[key]={exports:{serviceSale:{findMany:async({where,select})=>{assert.deepEqual(where.AND[0],{OR:[{recipientAccountId:null},{recipientAccountId:'me'}]});assert.equal(where.couponCode.not,null);assert.deepEqual(where.AND[1].OR[0],{endsAt:null});assert.ok(where.AND[1].OR[1].endsAt.gt instanceof Date);assert.equal(where.active,true);assert.equal(select.recipientAccountId,undefined);assert.equal(select.couponUses.where.accountId,'me');return [{id:'gift',scope:'SERVICE',couponServiceIds:['a','b'],couponUses:[{id:'used'}]}];}},service:{findMany:async()=>[{id:'a',title:'Rank'},{id:'b',title:'Win'}]}}};delete require.cache[ctrl];t.after(()=>{if(old)require.cache[key]=old;else delete require.cache[key];delete require.cache[ctrl];});
 const res={set(){},json(body){this.body=body;},status(code){this.code=code;return this;}};
 await require(ctrl).myCoupons({user:{id:'me'}},res);assert.equal(res.body.ok,true);assert.deepEqual(res.body.coupons[0].serviceTitles,['Rank','Win']);assert.equal(res.body.coupons[0].used,true);assert.equal(res.body.coupons[0].couponUses,undefined);
});

test('account search includes all roles and covers legacy email and display name while remaining bounded',async t=>{
 const key=require.resolve('../src/prisma'),ctrl=require.resolve('../src/controllers/personalCouponController'),old=require.cache[key];let calls=0;
 require.cache[key]={exports:{user:{findMany:async({where,select,take})=>{calls++;assert.equal(where.role,undefined);assert.equal(where.OR[0].username.contains,'legacy');assert.equal(where.OR[1].email.contains,'legacy');assert.equal(where.OR[2].profile.displayName.contains,'legacy');assert.equal(take,8);assert.equal(select.profile.select.profileImageUrl,true);return [{id:'customer',username:null,email:'legacy@example.com',profile:null}];}}}};delete require.cache[ctrl];t.after(()=>{if(old)require.cache[key]=old;else delete require.cache[key];delete require.cache[ctrl];});
 const res={set(){},json(body){this.body=body;},status(){return this;}};
 const {searchCustomers}=require(ctrl);await searchCustomers({query:{q:' legacy '}},res);assert.equal(res.body.customers[0].username,null);
 await searchCustomers({query:{q:'a'}},res);assert.equal(calls,1);assert.deepEqual(res.body.customers,[]);
});
