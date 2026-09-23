const test = require('node:test');
const assert = require('node:assert/strict');
const { applyCheckoutCoupon, couponPricing, restoredCouponFields } = require('../src/utils/checkoutCoupon');
const { checkoutSummary } = require('../src/utils/checkoutSummary');

function fixture() {
    const orders = new Map();
    const order = { id:'order-a',customerId:'account-a',serviceId:'service-a',basePrice:100,addonPrice:20,amountCents:9900,totalPrice:99,referralDiscount:11,paymentStatus:'PENDING',status:'PENDING' };
    orders.set(order.id, order);
    const sale = { id:'coupon-a',couponCode:'WELCOME20',title:'Welcome offer',discountPercent:20,scope:'GLOBAL',active:true };
    const claims = [];
    const sessions = new Map();
    const expired = [];
    const stripe = { checkout:{ sessions:{ retrieve:async id => sessions.get(id),expire:async id => { const s=sessions.get(id); if(s.status !== 'open') throw new Error('Session cannot expire'); s.status='expired';expired.push(id); } } } };
    const db = {
        serviceSale:{findFirst:async({where})=>where.couponCode===sale.couponCode && sale.active?sale:null,findUnique:async({where})=>where.id===sale.id?sale:null},
        order:{update:async({where,data})=>Object.assign(orders.get(where.id),data)},
        couponUse:{
            findUnique:async({where})=>{const c=claims.find(c=>c.accountId===where.accountId_saleId.accountId && c.saleId===where.accountId_saleId.saleId);return c?{...c,order:orders.get(c.orderId)}:null;},
            create:async({data})=>{ assert.ok(!claims.some(c=>c.orderId===data.orderId || c.accountId===data.accountId && c.saleId===data.saleId));const c={id:'claim-'+data.orderId,...data,usedAt:null};claims.push(c);return c; },
            delete:async({where})=>claims.splice(claims.findIndex(c=>c.id===where.id),1),
            deleteMany:async({where})=>{const i=claims.findIndex(c=>c.orderId===where.orderId && !c.usedAt);if(i>=0)claims.splice(i,1);},
        },
    };
    return {order,orders,sale,claims,sessions,expired,stripe,db};
}

test('personal coupon is limited to its assigned account and can be claimed by that account', async()=>{
    const f=fixture();
    f.sale.recipientAccountId='account-b';
    await assert.rejects(applyCheckoutCoupon(f.db,f.order,'WELCOME20',f.stripe),/reserved for another account/);
    assert.equal(f.claims.length,0);
    assert.equal(f.order.amountCents,9900);
    f.sale.recipientAccountId='account-a';
    await applyCheckoutCoupon(f.db,f.order,'WELCOME20',f.stripe);
    assert.equal(f.claims.length,1);
    assert.equal(f.claims[0].usedAt,null);
});

test('larger base-only coupon replaces sale, keeps referral percentage and does not compound', async()=>{
    const f=fixture();
    const result=await applyCheckoutCoupon(f.db,f.order,' welcome20 ',f.stripe);
    assert.match(result.message,/replaces your sale/);
    assert.equal(f.order.amountCents,9000); // base100 + add-ons20 - coupon20 - referral10
    assert.equal(f.order.couponDiscountCents,2000);
    assert.equal(f.order.referralDiscount,10);
    assert.equal(f.claims[0].usedAt,null);
    await applyCheckoutCoupon(f.db,f.order,undefined,f.stripe);
    assert.equal(f.order.amountCents,9000);
    const summary=checkoutSummary(f.order,10,100,8900);
    assert.equal(summary.saleDiscountCents,0);
    assert.equal(summary.promoDiscount.title,'Welcome offer');
    assert.equal(summary.basePriceCents+summary.addonPriceCents-summary.referralDiscountCents-summary.goldDiscountCents-summary.promoDiscount.amountCents,summary.totalCents);
    await applyCheckoutCoupon(f.db,f.order,'',f.stripe);
    assert.equal(f.order.amountCents,9900);
    assert.equal(f.order.referralDiscount,11);
    assert.equal(f.claims.length,0);
    assert.equal(f.order.couponSaleId,null);
});

test('equal or smaller coupon keeps sale and is not claimed',async()=>{
    for(const percent of [5,10]) {
        const f=fixture(); f.sale.discountPercent=percent;
        const result=await applyCheckoutCoupon(f.db,f.order,'WELCOME20',f.stripe);
        assert.match(result.message,/kept the sale price/);
        assert.equal(f.order.amountCents,9900);
        assert.equal(f.claims.length,0);
    }
});

test('invalid, disabled, scheduled, expired and wrong-service coupons cannot change a price',async()=>{
    for(const change of [{active:false},{startsAt:new Date('2099-01-01')},{endsAt:new Date('2000-01-01')},{scope:'SERVICE',serviceId:'other'}]) {
        const f=fixture();Object.assign(f.sale,change);
        await assert.rejects(applyCheckoutCoupon(f.db,f.order,'WELCOME20',f.stripe),{code:'COUPON_UNAVAILABLE'});
        assert.equal(f.order.amountCents,9900);assert.equal(f.claims.length,0);
    }
    const f=fixture();
    for(const code of ['UNKNOWN','!!!',{code:'WELCOME20'}]) await assert.rejects(applyCheckoutCoupon(f.db,f.order,code,f.stripe),{code:'COUPON_UNAVAILABLE'});
});

test('moving an unpaid coupon expires the old session and restores its draft',async()=>{
    const f=fixture();await applyCheckoutCoupon(f.db,f.order,'WELCOME20',f.stripe);
    f.order.stripeCheckoutSessionId='cs-old'; f.sessions.set('cs-old',{id:'cs-old',status:'open'});
    const other={...f.order,...restoredCouponFields(f.order),id:'order-b',stripeCheckoutSessionId:null};f.orders.set(other.id,other);
    const result=await applyCheckoutCoupon(f.db,other,'WELCOME20',f.stripe);
    assert.deepEqual(f.expired,['cs-old']);assert.equal(f.order.couponSaleId,null);assert.equal(f.order.amountCents,9900);
    assert.equal(f.claims.length,1);assert.equal(f.claims[0].orderId,other.id);assert.equal(f.claims[0].usedAt,null);
    assert.match(result.message,/moved from your other unpaid checkout/);
});

test('paid coupon and payment currently confirming cannot transfer',async()=>{
    for(const state of ['paid','confirming']) {
        const f=fixture();await applyCheckoutCoupon(f.db,f.order,'WELCOME20',f.stripe);
        if(state==='paid') f.claims[0].usedAt=new Date();
        else {f.order.stripeCheckoutSessionId='cs-complete';f.sessions.set('cs-complete',{status:'complete'});}
        const other={...f.order,...restoredCouponFields(f.order),id:'order-b',stripeCheckoutSessionId:null};f.orders.set(other.id,other);
        await assert.rejects(applyCheckoutCoupon(f.db,other,'WELCOME20',f.stripe),{code:'COUPON_UNAVAILABLE'});
        assert.equal(other.amountCents,9900);assert.equal(f.claims[0].orderId,f.order.id);
        assert.equal(f.expired.length,0);
    }
});

test('expired coupon on refresh restores original price with explanatory notice',async()=>{
    const f=fixture();await applyCheckoutCoupon(f.db,f.order,'WELCOME20',f.stripe);f.sale.active=false;
    const result=await applyCheckoutCoupon(f.db,f.order,undefined,f.stripe);
    assert.equal(f.order.amountCents,9900);assert.equal(f.claims.length,0);assert.match(result.message,/restored your original price/);
});

test('coupon pricing rounds to cents and leaves add-ons undiscounted',()=>{
    const result=couponPricing({basePrice:19.99,addonPrice:5,amountCents:2499},15);
    assert.equal(result.discount,300);assert.equal(result.total,2199);
});

test('a smaller replacement keeps the existing coupon and explains that choice',async()=>{
    const f=fixture();await applyCheckoutCoupon(f.db,f.order,'WELCOME20',f.stripe);
    const previous={...f.sale};
    f.db.serviceSale.findUnique=async({where})=>where.id===previous.id?previous:null;
    Object.assign(f.sale,{id:'coupon-b',couponCode:'SMALL5',discountPercent:5});
    const notice=await applyCheckoutCoupon(f.db,f.order,'SMALL5',f.stripe);
    assert.match(notice.title,/current coupon/);assert.equal(f.order.couponCode,'WELCOME20');assert.equal(f.order.amountCents,9000);
});

test('refreshing an old draft after another order consumed its coupon restores its sale',async()=>{
    const f=fixture();await applyCheckoutCoupon(f.db,f.order,'WELCOME20',f.stripe);
    f.claims[0].orderId='other-order';f.claims[0].usedAt=new Date();
    const notice=await applyCheckoutCoupon(f.db,f.order,undefined,f.stripe);
    assert.match(notice.message,/already used/);assert.equal(f.order.couponSaleId,null);assert.equal(f.order.amountCents,9900);
    assert.equal(f.claims.length,1);assert.equal(f.claims[0].orderId,'other-order');
});

for (const percent of [5,15]) test(`reused code replaces expired campaign at ${percent}%`,async()=>{
 const f=fixture();await applyCheckoutCoupon(f.db,f.order,'WELCOME20',f.stripe);
 const old={...f.sale,active:false};f.db.serviceSale.findUnique=async()=>old;
 Object.assign(f.sale,{id:'new',discountPercent:percent});
 await applyCheckoutCoupon(f.db,f.order,'WELCOME20',f.stripe);
 assert.equal(f.order.couponSaleId,percent===5?null:'new');
 assert.equal(f.order.amountCents,percent===5?9900:9450);
 assert.ok(f.claims.every(c=>c.saleId==='new'));
});
test('refresh never silently adopts reused code',async()=>{
 const f=fixture();await applyCheckoutCoupon(f.db,f.order,'WELCOME20',f.stripe);
 const old={...f.sale,active:false};f.db.serviceSale.findUnique=async()=>old;
 Object.assign(f.sale,{id:'new',discountPercent:30});
 await applyCheckoutCoupon(f.db,f.order,undefined,f.stripe);
 assert.equal(f.order.couponSaleId,null);assert.equal(f.order.amountCents,9900);assert.equal(f.claims.length,0);
});
