const test = require('node:test');
const assert = require('node:assert/strict');

test('on-site checkout uses server pricing, reuses sessions, and enforces ownership', async (t) => {
    let existing = null;
    let creates = 0;
    const queued = [];
    const order = {id:'order-test',orderNumber:'LOL-RNK-CXBE6',customerId:'customer-test',serviceId:'service-test',paymentStatus:'PENDING',status:'PENDING',basePrice:30,addonPrice:0,referralDiscount:3,totalPrice:27,amountCents:2700,currency:'usd',customer:{email:'test@example.com'},service:{title:'Rank Boost'}};
    const prisma = {
        servicePriceRule: { findFirst: async () => ({ id: 'active-rule' }) },
        $queryRaw: async () => [],
        order: {findUnique:async()=>order,findFirst:async()=>null,findMany:async()=>[],update:async({data})=>Object.assign(order,data),updateMany:async({data})=>{Object.assign(order,data);return {count:1};}},
        rewardHistory:{aggregate:async()=>({_sum:{goldAmount:100}}),create:async()=>({})},
        $transaction:async callback=>callback(prisma),
    };
    const stripe = {checkout:{sessions:{
        retrieve:async()=>existing,
        expire:async(id)=>{ assert.equal(id,existing.id); existing.status='expired'; },
        create:async(args,options)=>{
            creates++;
            assert.equal(args.ui_mode,'elements');
            assert.deepEqual(args.adaptive_pricing,{enabled:true});
            assert.equal(args.line_items[0].price_data.currency,'usd');
            assert.equal(args.metadata.orderNumber,order.orderNumber);
            assert.equal(args.payment_intent_data.metadata.orderNumber,order.orderNumber);
            assert.ok(args.line_items[0].price_data.product_data.description.includes(order.orderNumber));
            assert.equal(args.customer_email,undefined);
            assert.equal(args.metadata.editableEmail,'1');
            assert.equal(args.line_items[0].price_data.unit_amount,1700);
            assert.equal(args.metadata.goldRedeemed,'100');
            assert.equal(args.success_url,undefined);
            assert.ok(args.return_url.includes('{CHECKOUT_SESSION_ID}'));
            assert.ok(options.idempotencyKey);
            existing={id:'cs_test_'+creates,client_secret:'test-secret',status:'open',ui_mode:'elements',amount_total:1700,currency:args.line_items[0].price_data.currency,adaptive_pricing:{...args.adaptive_pricing},metadata:args.metadata};
            return existing;
        },
    }}};
    const replacements = new Map([
        [require.resolve('../src/prisma'),prisma],
        [require.resolve('../src/utils/stripeClient'),stripe],
        [require.resolve('../src/utils/referralProgram'),{grantReferralCompletionRewards:async()=>{}}],
        [require.resolve('../src/utils/orderConfirmationEmail'),{validEmail:require('../src/utils/orderConfirmationEmail').validEmail,queueOrderConfirmation:async(tx,id,email)=>{assert.equal(order.paymentStatus,'PAID');queued.push({id,email});}}],
    ]);
    const saved = new Map();
    for(const [path,exports] of replacements) {saved.set(path,require.cache[path]);require.cache[path]={id:path,filename:path,loaded:true,exports};}
    const path=require.resolve('../src/controllers/paymentController');
    delete require.cache[path];
    t.after(()=>{delete require.cache[path];for(const [key,value] of saved){if(value)require.cache[key]=value;else delete require.cache[key];}});
    const {createCheckoutSession}=require(path);
    const req={user:{id:order.customerId},body:{orderId:order.id,goldToUse:100,amount:1},hostname:'localhost',get:()=> 'http://localhost:5173'};
    const res={code:200,status(code){this.code=code;return this;},json(body){this.body=body;return this;}};
    for (const invalidGold of [1, 20, 99, -1, 100.5]) {
        req.body.goldToUse = invalidGold;
        await createCheckoutSession(req,res);
        assert.equal(res.code,400);
        assert.equal(creates,0);
        assert.equal(order.paymentStatus,'PENDING');
    }
    req.body.goldToUse = 100;
    res.code = 200;
    await createCheckoutSession(req,res);
    assert.equal(res.code,200);
    assert.equal(res.body.summary.totalCents,1700);
    assert.equal(res.body.summary.referralDiscountCents,300);
    assert.deepEqual(res.body.summary.priceSummary, {currency:'usd',subtotalCents:3000,promotionCents:0,coupon:null,referralCents:300,goldRedeemed:100,goldDiscountCents:1000,totalCents:1700});
    assert.equal(res.body.checkoutUrl,undefined);
    await createCheckoutSession(req,res);
    assert.equal(creates,1);
    assert.equal(res.body.sessionId,'cs_test_1');
    // Older sessions have their email fixed at creation and must be replaced.
    delete existing.metadata.editableEmail;
    await createCheckoutSession(req,res);
    assert.equal(creates,2);
    assert.equal(res.body.sessionId,'cs_test_2');
    existing.status='complete';
    await createCheckoutSession(req,res);
    assert.equal(res.body.completed,true);
    req.user.id='another-customer';
    await createCheckoutSession(req,res);
    assert.equal(res.code,403);
    req.user.id=order.customerId;
    order.status='CANCELLED';
    await createCheckoutSession(req,res);
    assert.equal(res.code,400);
    assert.equal(creates,2);
    order.status='PENDING';
    order.amountCents=1000;
    existing.status='open';
    req.body.goldToUse=100;
    req.body.deferGoldOnly=true;
    res.code=200;
    await createCheckoutSession(req,res);
    assert.equal(res.body.goldOnlyReady,true);
    assert.equal(res.body.summary.availableGold,100);
    assert.equal(res.body.summary.totalCents,0);
    assert.equal(res.body.summary.priceSummary.totalCents,0);
    assert.equal(order.paymentStatus,'PENDING');
    assert.equal(existing.status,'expired');
    assert.equal(queued.length,0);
    req.body.deferGoldOnly=false;
    await createCheckoutSession(req,res);
    assert.equal(res.code,400);
    assert.equal(order.paymentStatus,'PENDING');
    res.code=200;
    req.body.contactEmail='receipt@example.com';
    await createCheckoutSession(req,res);
    assert.equal(res.body.paidWithGoldOnly,true);
    assert.equal(res.body.summary.orderId,order.id, 'Gold payment must return the receipt needed for the immediate checkout render');
    assert.equal(res.body.summary.game,'lol');
    assert.equal(res.body.summary.currency,'usd');
    assert.equal(res.body.summary.goldRedeemed,100);
    assert.equal(res.body.summary.goldDiscountCents,1000);
    assert.equal(res.body.summary.totalCents,0);
    assert.equal(res.body.summary.availableGold,0);
    assert.equal(res.body.summary.priceSummary.totalCents,0);
    assert.equal(res.body.summary.priceSummary.goldDiscountCents,1000);
    assert.equal(order.paymentStatus,'PAID');
    assert.deepEqual(queued,[{id:order.id,email:'receipt@example.com'}]);
    await createCheckoutSession(req,res);
    assert.equal(res.code,200);
    assert.equal(res.body.paid,true);
    assert.equal(res.body.summary.priceSummary.totalCents,0);
    assert.equal(res.body.summary.priceSummary.goldDiscountCents,1000);
    assert.equal(queued.length,1);
    assert.equal(res.body.orderId,order.id);
    assert.equal(creates,2);
});

const { paymentFixture } = require('../test-helpers/paymentFixture');

test('USD checkout replaces older sessions without Adaptive Pricing once, then reuses the replacement', async t => {
    for (const oldPricing of [{ enabled: false }, undefined]) await t.test(String(oldPricing?.enabled), async context => {
        const f = paymentFixture(context, { orders: [{ id: 'order' }] });
        const first = await f.checkout('order');
        const olderSession = f.sessions.get(first.body.sessionId);
        olderSession.adaptive_pricing = oldPricing;
        const create = f.stripe.checkout.sessions.create;
        f.stripe.checkout.sessions.create = async (parameters, options) => {
            assert.deepEqual(parameters.adaptive_pricing, { enabled: true });
            assert.equal(parameters.line_items[0].price_data.currency, 'usd');
            assert.ok(options.idempotencyKey.startsWith('checkout-adaptive-v2-'));
            return create(parameters, options);
        };
        const replacement = await f.checkout('order');
        assert.equal(replacement.code, 200);
        assert.notEqual(replacement.body.sessionId, first.body.sessionId);
        assert.deepEqual(f.state.expired, [first.body.sessionId]);
        assert.equal((await f.checkout('order')).body.sessionId, replacement.body.sessionId);
        assert.equal(f.state.created.length, 2);
    });
});

test('checkout preserves legacy integration currencies and only reuses a matching session currency', async t => {
    const f = paymentFixture(t, { orders: [{ id: 'legacy', currency: 'cad' }] });
    const first = await f.checkout('legacy');
    const session = f.sessions.get(first.body.sessionId);
    assert.equal(session.currency, 'cad');
    assert.deepEqual(session.adaptive_pricing, { enabled: false });
    assert.equal((await f.checkout('legacy')).body.sessionId, first.body.sessionId);
    session.currency = 'usd';
    const replacement = await f.checkout('legacy');
    assert.notEqual(replacement.body.sessionId, first.body.sessionId);
    assert.deepEqual(f.state.expired, [first.body.sessionId]);
    assert.equal(f.sessions.get(replacement.body.sessionId).currency, 'cad');
    assert.equal(f.state.orders[0].currency, 'cad');
});

test('a completed session without Adaptive Pricing is verified without creating a replacement charge', async t => {
    const f = paymentFixture(t, { orders: [{ id: 'order' }] });
    const first = await f.checkout('order');
    Object.assign(f.sessions.get(first.body.sessionId), { status: 'complete', adaptive_pricing: { enabled: false } });
    const result = await f.checkout('order');
    assert.equal(result.body.completed, true);
    assert.equal(result.body.sessionId, first.body.sessionId);
    assert.equal(result.body.clientSecret, undefined);
    assert.equal(f.state.created.length, 1);
    assert.equal(f.state.expired.length, 0);
});
