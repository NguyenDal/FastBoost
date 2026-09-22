const test = require('node:test');
const assert = require('node:assert/strict');

test('on-site checkout uses server pricing, reuses sessions, and enforces ownership', async (t) => {
    let existing = null;
    let creates = 0;
    const order = {id:'order-test',orderNumber:'LOL-RNK-CXBE6',customerId:'customer-test',serviceId:'service-test',paymentStatus:'PENDING',status:'PENDING',basePrice:30,addonPrice:0,referralDiscount:3,totalPrice:27,amountCents:2700,currency:'cad',customer:{email:'test@example.com'},service:{title:'Rank Boost'}};
    const prisma = {
        order: {findUnique:async()=>order,findMany:async()=>[],update:async({data})=>Object.assign(order,data)},
        rewardHistory:{aggregate:async()=>({_sum:{goldAmount:100}}),create:async()=>({})},
        $transaction:async operations=>Promise.all(operations),
    };
    const stripe = {checkout:{sessions:{
        retrieve:async()=>existing,
        expire:async(id)=>{ assert.equal(id,existing.id); existing.status='expired'; },
        create:async(args,options)=>{
            creates++;
            assert.equal(args.ui_mode,'elements');
            assert.equal(args.metadata.orderNumber,order.orderNumber);
            assert.equal(args.payment_intent_data.metadata.orderNumber,order.orderNumber);
            assert.ok(args.line_items[0].price_data.product_data.description.includes(order.orderNumber));
            assert.equal(args.customer_email,undefined);
            assert.equal(args.metadata.editableEmail,'1');
            assert.equal(args.line_items[0].price_data.unit_amount,2600);
            assert.equal(args.metadata.goldRedeemed,'10');
            assert.equal(args.success_url,undefined);
            assert.ok(args.return_url.includes('{CHECKOUT_SESSION_ID}'));
            assert.ok(options.idempotencyKey);
            existing={id:'cs_test_'+creates,client_secret:'test-secret',status:'open',ui_mode:'elements',amount_total:2600,metadata:args.metadata};
            return existing;
        },
    }}};
    const replacements = new Map([
        [require.resolve('../src/prisma'),prisma],
        [require.resolve('../src/utils/stripeClient'),stripe],
        [require.resolve('../src/utils/referralProgram'),{grantReferralCompletionRewards:async()=>{}}],
    ]);
    const saved = new Map();
    for(const [path,exports] of replacements) {saved.set(path,require.cache[path]);require.cache[path]={id:path,filename:path,loaded:true,exports};}
    const path=require.resolve('../src/controllers/paymentController');
    delete require.cache[path];
    t.after(()=>{delete require.cache[path];for(const [key,value] of saved){if(value)require.cache[key]=value;else delete require.cache[key];}});
    const {createCheckoutSession}=require(path);
    const req={user:{id:order.customerId},body:{orderId:order.id,goldToUse:10,amount:1},hostname:'localhost',get:()=> 'http://localhost:5173'};
    const res={code:200,status(code){this.code=code;return this;},json(body){this.body=body;return this;}};
    await createCheckoutSession(req,res);
    assert.equal(res.code,200);
    assert.equal(res.body.summary.totalCents,2600);
    assert.equal(res.body.summary.referralDiscountCents,300);
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
    order.amountCents=500;
    existing.status='open';
    req.body.goldToUse=50;
    req.body.deferGoldOnly=true;
    res.code=200;
    await createCheckoutSession(req,res);
    assert.equal(res.body.goldOnlyReady,true);
    assert.equal(res.body.summary.availableGold,100);
    assert.equal(res.body.summary.totalCents,0);
    assert.equal(order.paymentStatus,'PENDING');
    assert.equal(existing.status,'expired');
    req.body.deferGoldOnly=false;
    await createCheckoutSession(req,res);
    assert.equal(res.body.paidWithGoldOnly,true);
    assert.equal(order.paymentStatus,'PAID');
    await createCheckoutSession(req,res);
    assert.equal(res.code,200);
    assert.equal(res.body.paid,true);
    assert.equal(res.body.orderId,order.id);
    assert.equal(creates,2);
});

