const test = require('node:test');
const assert = require('node:assert/strict');

test('checkout charges the winning coupon price; card and gold previews never consume it', async t => {
    const order = {id:'coupon-order',orderNumber:'LOL-PLC-ABCDE',customerId:'coupon-customer',serviceId:'placements',boostType:'Placement Boost',placementGames:3,peakRank:'Silver I',basePrice:100,addonPrice:10,referralDiscount:0,amountCents:10000,totalPrice:100,paymentStatus:'PENDING',status:'PENDING',currency:'cad',service:{title:'Placement Boost'}};
    const sale={id:'welcome',title:'Welcome discount',couponCode:'WELCOME20',discountPercent:20,scope:'GLOBAL',active:true};
    let claim=null, sequence=0;
    const sessions=new Map();
    const queued=[];
    const prisma={
        servicePriceRule: { findFirst: async () => ({ id:'active-rule' }) },
        $queryRaw:async()=>[],
        order:{findUnique:async()=>order,findMany:async()=>[],update:async({data})=>Object.assign(order,data),updateMany:async({data})=>{Object.assign(order,data);return {count:1};}},
        serviceSale:{findUnique:async({where})=>where.couponCode===sale.couponCode?sale:null},
        couponUse:{findUnique:async()=>claim,create:async({data})=>{assert.equal(claim,null);claim={id:'claim',...data,usedAt:null};return claim;},deleteMany:async()=>{claim=null;}},
        rewardHistory:{aggregate:async()=>({_sum:{goldAmount:5000}}),create:async()=>({}),createMany:async()=>({count:1})},
        $transaction:async callback=>callback(prisma),
    };
    const stripe={checkout:{sessions:{
        retrieve:async id=>sessions.get(id),
        expire:async id=>{sessions.get(id).status='expired';},
        create:async args=>{const session={id:'cs_'+(++sequence),status:'open',ui_mode:args.ui_mode,metadata:args.metadata,client_secret:'secret-'+sequence,amount_total:args.line_items[0].price_data.unit_amount};sessions.set(session.id,session);return session;},
    }}};
    const originals=new Map();
    const mocks=new Map([
        [require.resolve('../src/prisma'),prisma],
        [require.resolve('../src/utils/stripeClient'),stripe],
        [require.resolve('../src/utils/referralProgram'),{grantReferralCompletionRewards:async()=>{}}],
        [require.resolve('../src/utils/orderConfirmationEmail'),{validEmail:()=>true,queueOrderConfirmation:async(db,id,email)=>queued.push({id,email})}],
    ]);
    for(const [file,exports] of mocks){originals.set(file,require.cache[file]);require.cache[file]={id:file,filename:file,loaded:true,exports};}
    const file=require.resolve('../src/controllers/paymentController');delete require.cache[file];
    t.after(()=>{delete require.cache[file];for(const [file,value] of originals){if(value)require.cache[file]=value;else delete require.cache[file];}});
    const {createCheckoutSession,verifyCheckoutSession}=require(file);
    const req={user:{id:order.customerId},body:{orderId:order.id,goldToUse:0,deferGoldOnly:true},hostname:'localhost',get:()=> 'http://localhost:5173'};
    const res={status(code){this.code=code;return this;},json(body){this.body=body;return this;}};
    await createCheckoutSession(req,res);
    const originalSession=order.stripeCheckoutSessionId;
    assert.equal(res.body.summary.totalCents,10000);
    req.body.couponCode='WELCOME20';
    await createCheckoutSession(req,res);
    assert.equal(res.code,200);
    assert.equal(res.body.summary.totalCents,9000);
    assert.equal(res.body.summary.saleDiscountCents,0);
    assert.equal(res.body.summary.promoDiscount.amountCents,2000);
    assert.deepEqual(res.body.summary.quantity,{label:'Placement Matches',value:3});
    assert.equal(sessions.get(originalSession).status,'expired');
    assert.equal(sessions.get(order.stripeCheckoutSessionId).metadata.couponCode,'WELCOME20');
    assert.equal(claim.usedAt,null);assert.equal(order.paymentStatus,'PENDING');assert.equal(queued.length,0);
    const discountedSession=order.stripeCheckoutSessionId;
    delete req.body.couponCode;
    await createCheckoutSession(req,res);
    assert.equal(order.stripeCheckoutSessionId,discountedSession);assert.equal(res.body.summary.totalCents,9000);
    req.body.couponCode='UNKNOWN';
    await createCheckoutSession(req,res);
    assert.equal(res.code,400);assert.equal(res.body.code,'COUPON_UNAVAILABLE');assert.equal(sessions.get(discountedSession).status,'open');
    delete req.body.couponCode;
    // Simulate a verified card payment: the order, reward/email work are one transaction.
    const paidSession=sessions.get(discountedSession);
    Object.assign(paidSession,{status:'complete',payment_status:'paid',payment_intent:'pi-test',currency:'cad',customer_details:{email:'receipt@example.test'}});
    prisma.order.findFirst=async()=>order;
    req.query={sessionId:discountedSession};
    await verifyCheckoutSession(req,res);
    assert.equal(res.body.paid,true);assert.equal(order.cashAmountCents,9000);assert.equal(queued.length,1);
    await verifyCheckoutSession(req,res);assert.equal(queued.length,1);
    // Separate unpaid gold scenario, no Stripe payment or SMTP send is performed.
    Object.assign(order,{paymentStatus:'PENDING',stripeCheckoutSessionId:null,paidAt:null});claim.usedAt=null;queued.length=0;
    req.body.goldToUse=900;
    await createCheckoutSession(req,res);
    assert.equal(res.body.goldOnlyReady,true);assert.equal(order.paymentStatus,'PENDING');assert.equal(queued.length,0);
    req.body.deferGoldOnly=false;req.body.contactEmail='gold@example.test';
    await createCheckoutSession(req,res);
    assert.equal(res.body.paidWithGoldOnly,true);assert.equal(order.paymentStatus,'PAID');assert.equal(order.cashAmountCents,0);assert.equal(order.goldRedeemed,900);
    assert.deepEqual(queued,[{id:order.id,email:'gold@example.test'}]);
});
