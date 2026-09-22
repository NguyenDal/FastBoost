const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateOrderPrice } = require('../src/utils/pricingCalculator');
const { saleOptions } = require('../src/utils/saleOptions');

function loadController(t, name, prisma, cache = {}) {
    const mocks = new Map([[require.resolve('../src/prisma'),prisma],[require.resolve('../src/utils/pricingCatalogCache'),cache],[require.resolve('../src/utils/stripeClient'),{}]]);
    if (name === 'orderController') mocks.set(require.resolve('../src/utils/orderPasswordCrypto'), {});
    const old = new Map();
    for(const [path,exports] of mocks){old.set(path,require.cache[path]);require.cache[path]={exports,loaded:true};}
    const path = require.resolve('../src/controllers/'+name);
    delete require.cache[path];
    t.after(()=>{delete require.cache[path];for(const [key,value] of old){if(value)require.cache[key]=value;else delete require.cache[key];}});
    return require(path);
}
const response = () => ({code:200,headers:{},set(key,value){this.headers[key]=value;return this;},status(code){this.code=code;return this;},json(body){this.body=body;return this;}});

test('service toggle changes all historical rules and invalidates cached availability', async t=>{
    const writes=[];let invalidations=0;
    const {setServiceAvailability}=loadController(t,'priceController',{
        servicePriceRule:{findUnique:async()=>({serviceId:'service'}),updateMany:async args=>writes.push(args)},
    },{invalidatePricingCatalog(){invalidations++;}});
    for(const active of [false,true]) {
        const res=response();await setServiceAvailability({params:{id:'rule'},body:{active}},res);
        assert.equal(res.code,200);assert.equal(res.body.active,active);
    }
    assert.deepEqual(writes,[{where:{serviceId:'service'},data:{active:false}},{where:{serviceId:'service'},data:{active:true}}]);
    assert.equal(invalidations,2);
    const res=response();await setServiceAvailability({params:{id:'rule'},body:{active:'false'}},res);
    assert.equal(res.code,400);assert.equal(writes.length,2);
});

test('public service list and direct link expose deactivation without cached responses',async t=>{
    const rows=[{id:'off',title:'Win Boost',priceRules:[]},{id:'on',title:'Rank Boost',priceRules:[{id:'rule'}]}];
    const service={findMany:async ({select})=>{assert.equal(select.priceRules.where.active,true);return rows;},findUnique:async()=>rows[0]};
    const {getAllServices,getServiceById}=loadController(t,'serviceController',{service});
    const list=response();await getAllServices({},list);
    assert.equal(list.headers['Cache-Control'],'no-store');
    assert.deepEqual(list.body.services.map(s=>s.active),[false,true]);
    assert.equal(list.body.services[0].priceRules,undefined);
    const detail=response();await getServiceById({params:{id:'off'}},detail);
    assert.equal(detail.body.service.active,false);assert.equal(detail.headers['Cache-Control'],'no-store');
});

test('direct order creation rejects a deactivated service before storing an order',async t=>{
    const {createOrder}=loadController(t,'orderController',{
        service:{findFirst:async()=>({id:'service'})},
        servicePriceRule:{findFirst:async ({where})=>{assert.equal(where.active,true);return null;}},
        order:{create:async()=>assert.fail('Must not create disabled service order')},
    });
    const res=response();await createOrder({user:{id:'customer'},body:{serviceId:'service',boostType:'Rank Boost'}},res);
    assert.equal(res.code,400);assert.match(res.body.message,/currently unavailable/);
});

test('deactivated standalone Win Boost still provides the bonus-win reference price',()=>{
    const rule={active:true,game:'LoL',pricingType:'FIXED',basePrice:10,config:{}};
    const result=calculateOrderPrice({rule,options:{bonusWin:true,currentRank:'Silver I'},referenceRules:[{active:false,game:'LoL',pricingType:'PER_WIN',config:{perWinPrices:{Silver:5}}}]});
    assert.equal(result.addonPrice,5);assert.equal(result.totalPrice,15);
    assert.throws(()=>calculateOrderPrice({rule:{...rule,active:false},options:{}}),/No active pricing/);
});

test('service coupons match global coupon date and base-price rules',()=>{
    const options=saleOptions({scope:'SERVICE',saleMode:'WITH_COUPON',couponCode:'rank15',footerDecoration:true});
    assert.equal(options.couponCode,'RANK15');assert.equal(options.startsAt,null);assert.equal(options.endsAt,null);assert.equal(options.appliesTo,'BASE_PRICE');
    assert.throws(()=>saleOptions({scope:'SERVICE',saleMode:'WITHOUT_COUPON'}),/sale start and end/);
});

test('admin service coupon is scoped to the selected service and never automatically attached as its sale',async t=>{
    const coupons=[];
    const {createSale,listPriceRules}=loadController(t,'priceController',{
        service:{findUnique:async()=>({id:'rank',title:'Rank Boost'})},
        servicePriceRule:{findMany:async()=>[{id:'rule',serviceId:'rank',active:true,service:{title:'Rank Boost'}}]},
        serviceSale:{create:async({data})=>{const c={id:'coupon',...data};coupons.push(c);return c;},findMany:async()=>coupons},
    },{invalidatePricingCatalog(){}});
    const created=response();await createSale({body:{scope:'SERVICE',serviceId:'rank',saleMode:'WITH_COUPON',couponCode:'rank15',discountPercent:15,appliesTo:'TOTAL'}},created);
    assert.equal(created.code,201);assert.equal(created.body.sale.serviceId,'rank');assert.equal(created.body.sale.appliesTo,'BASE_PRICE');
    const listed=response();await listPriceRules({},listed);
    assert.equal(listed.body.items[0].sale,null);assert.equal(listed.body.coupons[0].serviceTitle,'Rank Boost');
});

test('personal coupon resolves an existing customer and rejects unknown recipients', async t => {
    const writes=[];
    const {createSale}=loadController(t,'priceController',{
        user:{findFirst:async ({where})=>{
            assert.equal(where.role,'CUSTOMER');
            assert.equal(where.email.mode,'insensitive');
            return where.email.equals === 'customer@example.com' ? {id:'customer'} : null;
        }},
        serviceSale:{create:async({data})=>{writes.push(data);return data;}},
    },{invalidatePricingCatalog(){}});
    const body={scope:'GLOBAL',saleMode:'WITH_COUPON',couponCode:'GIFT15',discountPercent:15,personalCoupon:true,recipientEmail:'customer@example.com',personalReason:'NEGOTIATED',footerDecoration:true};
    const ok=response();await createSale({body},ok);
    assert.equal(ok.code,201);assert.equal(writes[0].recipientAccountId,'customer');assert.equal(writes[0].personalReason,'NEGOTIATED');assert.equal(writes[0].footerDecoration,false);
    const missing=response();await createSale({body:{...body,recipientEmail:'missing@example.com'}},missing);
    assert.equal(missing.code,404);assert.equal(writes.length,1);
});
