const test = require('node:test');
const assert = require('node:assert/strict');
const { WALLET_PACKAGES } = require('../src/utils/customerWallet');
const { walletFixture } = require('../test-helpers/walletFixture');
const topUp = (f, offer = 'usd-25') => f.service().createTopUp('customer', offer, 'http://localhost:5173');
const elementsTopUp = (f, offer = 'usd-25') => f.service().createTopUp('customer', offer, 'http://localhost:5173', { uiMode: 'elements' });

test('wallet offers exactly the five USD packages and fixed bonus credits', async t => {
    assert.deepEqual(WALLET_PACKAGES.map(p => [p.amountCents, p.bonusPercent, p.bonusCents, p.creditCents]),
        [[500, 8, 40, 540], [1000, 10, 100, 1100], [2500, 12, 300, 2800], [5000, 13, 650, 5650], [10000, 15, 1500, 11500]]);
    const f = walletFixture(t);
    await assert.rejects(topUp(f, 'usd-999'), { code: 'WALLET_PACKAGE' });
    assert.equal(f.state.created.length, 0);
    assert.equal((await f.service().snapshot('other')).balanceCents, 0);
    assert.equal(f.ledger.accounts.length, 1, 'balance reads never create accounts');
});

test('concurrent top-up creation and restart reuse one durable intent and Stripe idempotency key', async t => {
    const f = walletFixture(t);
    const [first, second] = await Promise.all([topUp(f), topUp(f)]);
    assert.equal(first.sessionId, second.sessionId);
    assert.equal(first.url, second.url);
    assert.equal(f.state.created.length, 1);
    assert.equal(f.ledger.topUps.length, 1);
    assert.equal((await topUp(f)).sessionId, first.sessionId);
    assert.equal(f.ledger.entries.length, 0, 'checkout preparation never grants balance');
});

test('lost Stripe create reply is recoverable after restart without a second charge session', async t => {
    const f = walletFixture(t);
    f.loseCreateResponse();
    await assert.rejects(topUp(f), /response was lost/);
    assert.equal(f.ledger.topUps[0].status, 'CREATING');
    assert.equal(f.ledger.topUps[0].stripeCheckoutSessionId, null);
    const recovered = await topUp(f);
    assert.equal(recovered.sessionId, 'cs_test_1');
    assert.equal(f.state.created.length, 1);
    assert.equal(f.ledger.topUps.length, 1);
});

test('expired checkout starts a new intent while ambiguous old creates require review', async t => {
    const f = walletFixture(t);
    const first = await topUp(f);
    f.sessions.get(first.sessionId).status = 'expired';
    const next = await topUp(f);
    assert.notEqual(next.sessionId, first.sessionId);
    assert.equal(f.ledger.topUps[0].status, 'EXPIRED');
    f.ledger.topUps[1].stripeCheckoutSessionId = null;
    f.ledger.topUps[1].createdAt = new Date(Date.now() - 24 * 3600000);
    await assert.rejects(topUp(f), { code: 'WALLET_TOPUP_REVIEW_REQUIRED' });
    assert.equal(f.state.created.length, 2);
});

test('paid top-up webhooks and verification credit purchased/bonus exactly once across duplicate events', async t => {
    const f = walletFixture(t);
    const created = await topUp(f);
    const session = f.paidTopUp(created.sessionId);
    const replies = await Promise.all([
        f.webhook('checkout.session.completed', session), f.webhook('checkout.session.async_payment_succeeded', session),
        f.service().verify('customer', { sessionId: session.id }),
    ]);
    assert.equal(replies[0].code, 200);
    assert.equal(replies[1].code, 200);
    assert.equal(replies[2].paid, true);
    assert.equal(f.ledger.entries.length, 1);
    assert.equal(f.ledger.accounts[0].purchasedBalanceCents, 2500);
    assert.equal(f.ledger.accounts[0].promotionalBalanceCents, 300);
    assert.equal((await f.service().snapshot('customer')).balanceCents, 2800);
    assert.equal(f.state.queued.length, 0, 'top-ups are not service orders');
});

test('top-up return verification enforces ownership before retrieving Stripe', async t => {
    const f = walletFixture(t);
    const created = await topUp(f);
    await assert.rejects(f.service().verify('other', { sessionId: created.sessionId }), { code: 'WALLET_TOPUP_UNAVAILABLE' });
    await assert.rejects(f.service().verify('other', { topUpId: created.topUpId }), { code: 'WALLET_TOPUP_UNAVAILABLE' });
    await assert.rejects(f.service().verify('customer', { sessionId: ['cs_bad'] }), { code: 'WALLET_TOPUP_ID' });
    assert.equal(f.ledger.entries.length, 0);
});

test('session amount, currency, mode, environment and metadata mismatches cannot grant credit', async t => {
    const f = walletFixture(t);
    const created = await topUp(f);
    const paid = f.paidTopUp(created.sessionId);
    for (const change of [
        { amount_total: 2499 }, { amount_subtotal: 1 }, { currency: 'cad' }, { livemode: true }, { mode: 'setup' },
        { metadata: { ...paid.metadata, customerId: 'other' } }, { metadata: { ...paid.metadata, bonusCents: '999999' } },
        { id: 'cs_different' }, { payment_intent: 'pi_other' },
    ]) await assert.rejects(f.service().settle({ ...paid, ...change }));
    assert.equal(f.ledger.entries.length, 0);
    assert.equal(f.ledger.accounts[0].purchasedBalanceCents, 0);
});

test('PaymentIntent mismatch and unverified charge cannot grant credit', async t => {
    const f = walletFixture(t);
    const created = await topUp(f);
    const session = f.paidTopUp(created.sessionId);
    const original = structuredClone(f.intents.get(session.payment_intent));
    for (const change of [{ amount_received: 1 }, { metadata: {} }, { status: 'processing' }, { latest_charge: 'ch_not_expanded' },
        { latest_charge: { ...original.latest_charge, paid: false } }]) {
        f.intents.set(session.payment_intent, { ...original, ...change });
        await assert.rejects(f.service().settle(session), { code: 'WALLET_QUOTE_MISMATCH' });
    }
    assert.equal(f.ledger.entries.length, 0);
});

test('metadata-bearing refund reverses the entire credited top-up and freezes spent debt exactly once', async t => {
    const f = walletFixture(t, { orders: [{ id: 'first' }] });
    const created = await topUp(f);
    const session = f.paidTopUp(created.sessionId);
    await f.service().settle(session);
    assert.equal((await f.payOrder('first')).code, 200);
    const charge = { ...f.intents.get(session.payment_intent).latest_charge, amount_refunded: 500, metadata: session.metadata };
    assert.equal((await f.webhook('charge.refunded', charge)).code, 200);
    assert.equal((await f.webhook('charge.refunded', charge)).code, 200);
    const wallet = await f.service().snapshot('customer');
    assert.equal(wallet.frozen, true);
    assert.equal(wallet.balanceCents, 0);
    assert.equal(wallet.debtCents, 2000);
    assert.equal(f.ledger.entries.filter(row => row.type === 'TOP_UP_REVERSAL').length, 1);
    await assert.rejects(topUp(f), { code: 'WALLET_FROZEN' });
});

test('refund arriving before completion and refunded charge lookup never issue usable balance', async t => {
    const f = walletFixture(t);
    const created = await topUp(f);
    const session = f.paidTopUp(created.sessionId);
    const charge = { ...f.intents.get(session.payment_intent).latest_charge, amount_refunded: 2500 };
    await f.webhook('charge.refunded', charge);
    await f.service().settle(session);
    assert.equal(f.ledger.entries.length, 0);
    assert.equal(f.ledger.topUps[0].status, 'REVERSED');
    assert.equal((await f.service().snapshot('customer')).frozen, true);
});

test('charge already refunded before a delayed paid webhook is frozen without credit', async t => {
    const f = walletFixture(t);
    const created = await topUp(f);
    const session = f.paidTopUp(created.sessionId);
    f.intents.get(session.payment_intent).latest_charge.amount_refunded = 2500;
    await f.service().settle(session);
    assert.equal(f.ledger.topUps[0].status, 'REVERSED');
    assert.equal(f.ledger.entries.length, 0);
});

test('dispute resolves its charge, reverses once, and a later paid event cannot regrant credit', async t => {
    const f = walletFixture(t);
    const created = await topUp(f, 'usd-5-v2');
    const session = f.paidTopUp(created.sessionId);
    await f.service().settle(session);
    const dispute = { charge: f.intents.get(session.payment_intent).latest_charge.id, metadata: session.metadata };
    await f.webhook('charge.dispute.created', dispute);
    await f.webhook('charge.dispute.funds_withdrawn', dispute);
    await f.service().settle(session);
    assert.equal(f.ledger.entries.length, 2);
    assert.equal(f.ledger.accounts[0].purchasedBalanceCents, 0);
    assert.ok(f.ledger.accounts[0].frozenAt);
});

test('top-up create recovery reports reversed when a dispute overtakes its completed session', async t => {
    const f = walletFixture(t);
    const created = await topUp(f);
    const session = f.paidTopUp(created.sessionId);
    const retrieve = f.stripe.checkout.sessions.retrieve;
    let reverse = true;
    f.stripe.checkout.sessions.retrieve = async (...args) => {
        if (reverse) {
            reverse = false;
            await f.webhook('charge.dispute.created', { payment_intent: session.payment_intent });
        }
        return retrieve(...args);
    };
    const recovered = await topUp(f);
    assert.equal(recovered.status, 'reversed');
    assert.equal(recovered.paid, false);
    assert.equal(f.ledger.entries.length, 0);
});

test('top-up credit rollback and lost commit reply recover exactly one ledger credit', async t => {
    const f = walletFixture(t);
    const created = await topUp(f);
    const session = f.paidTopUp(created.sessionId);
    const update = f.db.walletTopUp.update;
    f.db.walletTopUp.update = async args => {
        if (args.data.status === 'PAID') throw new Error('simulated paid-state persistence failure');
        return update(args);
    };
    await assert.rejects(f.service().settle(session), /persistence/);
    assert.equal(f.ledger.entries.length, 0);
    assert.equal(f.ledger.accounts[0].purchasedBalanceCents, 0);
    f.db.walletTopUp.update = update;
    const transact = f.db.$transaction;
    let lose = true;
    f.db.$transaction = async (...args) => {
        const result = await transact(...args);
        if (lose) { lose = false; throw new Error('database committed but acknowledgement was lost'); }
        return result;
    };
    await assert.rejects(f.service().settle(session), /acknowledgement/);
    assert.equal(f.ledger.topUps[0].status, 'PAID');
    assert.equal((await f.service().verify('customer', { sessionId: session.id })).paid, true);
    await f.service().settle(session);
    assert.equal(f.ledger.entries.length, 1);
    assert.equal(f.ledger.accounts[0].purchasedBalanceCents, 2500);
});

test('a changed pending Stripe quote is rejected before returning a payment URL', async t => {
    const f = walletFixture(t);
    const created = await topUp(f);
    f.sessions.get(created.sessionId).amount_total = 999;
    await assert.rejects(topUp(f), { code: 'WALLET_QUOTE_MISMATCH' });
    assert.equal(f.ledger.entries.length, 0);
    assert.equal(f.state.created.length, 1);
});

test('Elements top-up returns only its authoritative USD package and reusable checkout secret', async t => {
    const f = walletFixture(t);
    const created = await elementsTopUp(f, 'usd-50');
    assert.match(created.topUpId, /^wte_[0-9a-f-]{36}$/);
    assert.equal(created.uiMode, 'elements');
    assert.equal(created.clientSecret, `${created.sessionId}_secret_offline`);
    assert.equal(created.url, undefined);
    assert.deepEqual(created.summary, { packageId: 'usd-50', currency: 'usd', amountCents: 5000, bonusPercent: 13, bonusCents: 650, creditCents: 5650 });
    const { parameters, config } = f.createCalls[0];
    assert.equal(parameters.ui_mode, 'elements');
    assert.deepEqual(parameters.adaptive_pricing, { enabled: false });
    assert.deepEqual(parameters.automatic_tax, { enabled: false });
    assert.equal(parameters.return_url, 'http://localhost:5173/account/wallet?wallet_session_id={CHECKOUT_SESSION_ID}');
    for (const key of ['success_url', 'cancel_url', 'customer_email', 'allow_promotion_codes', 'discounts']) assert.equal(parameters[key], undefined, key);
    assert.equal(parameters.line_items.length, 1);
    assert.equal(parameters.line_items[0].price_data.unit_amount, 5000);
    assert.equal(parameters.line_items[0].price_data.currency, 'usd');
    assert.match(config.idempotencyKey, /^wallet-topup-elements-v1-wte_/);
    assert.deepEqual(await elementsTopUp(f, 'usd-50'), created, 'a fresh service instance resumes the same popup');
    assert.equal(f.state.created.length, 1);
    assert.equal(f.ledger.entries.length, 0);
    assert.equal(f.state.queued.length, 0);
});

test('concurrent Elements starts and a lost first reply retain one durable mode and session', async t => {
    const f = walletFixture(t);
    f.loseCreateResponse();
    await assert.rejects(elementsTopUp(f), /response was lost/);
    assert.match(f.ledger.topUps[0].id, /^wte_/);
    assert.equal(f.ledger.topUps[0].stripeCheckoutSessionId, null);
    const [first, second] = await Promise.all([elementsTopUp(f), elementsTopUp(f)]);
    assert.equal(first.sessionId, second.sessionId);
    assert.equal(first.clientSecret, second.clientSecret);
    assert.equal(f.state.created.length, 1);
    assert.equal(f.ledger.topUps.length, 1);
    assert.ok(f.createCalls.every(call => call.parameters.ui_mode === 'elements'));
});

test('switching an existing hosted top-up closes it before preparing an Elements replacement', async t => {
    const f = walletFixture(t);
    const hosted = await topUp(f);
    const original = f.stripe.checkout.sessions.create;
    f.stripe.checkout.sessions.create = async (...args) => {
        assert.equal(f.sessions.get(hosted.sessionId).status, 'expired', 'the prior checkout cannot remain payable');
        return original(...args);
    };
    const embedded = await elementsTopUp(f);
    assert.notEqual(embedded.sessionId, hosted.sessionId);
    assert.equal(embedded.uiMode, 'elements');
    assert.equal(f.ledger.topUps[0].status, 'EXPIRED');
    assert.equal(f.ledger.topUps[1].status, 'PENDING');
    assert.equal(f.state.created.length, 2);
});

test('a lost legacy hosted reply is recovered with its unchanged payload before switching UI', async t => {
    const f = walletFixture(t);
    f.loseCreateResponse();
    await assert.rejects(topUp(f), /response was lost/);
    const originalCall = structuredClone(f.createCalls[0]);
    const embedded = await elementsTopUp(f);
    assert.deepEqual(f.createCalls[1], originalCall, 'the legacy key must not be replayed with Elements parameters');
    assert.equal(f.sessions.get('cs_test_1').status, 'expired');
    assert.equal(embedded.sessionId, 'cs_test_2');
    assert.equal(f.state.created.length, 2);
});

test('mode switching settles an already-paid session and never replaces an unconfirmed payment', async t => {
    const f = walletFixture(t);
    const hosted = await topUp(f);
    f.paidTopUp(hosted.sessionId);
    const completed = await elementsTopUp(f);
    assert.equal(completed.paid, true);
    assert.equal(completed.sessionId, hosted.sessionId);
    assert.equal(completed.clientSecret, undefined);
    assert.equal(f.state.created.length, 1);
    assert.equal(f.ledger.entries.length, 1);
    const next = await topUp(f);
    f.sessions.get(next.sessionId).status = 'complete';
    await assert.rejects(elementsTopUp(f), { code: 'WALLET_TOPUP_PENDING' });
    assert.equal(f.state.created.length, 2);
    assert.deepEqual(f.state.expired, []);
});

test('failed expiration and completion racing a UI switch cannot create a second payable session', async t => {
    const f = walletFixture(t);
    const hosted = await topUp(f);
    f.state.failExpire = true;
    await assert.rejects(elementsTopUp(f), { code: 'WALLET_TOPUP_PENDING' });
    assert.equal(f.state.created.length, 1);
    f.stripe.checkout.sessions.expire = async id => { f.paidTopUp(id); throw new Error('Checkout completed before expiration'); };
    const result = await elementsTopUp(f);
    assert.equal(result.paid, true);
    assert.equal(result.sessionId, hosted.sessionId);
    assert.equal(f.state.created.length, 1);
    assert.equal(f.ledger.entries.length, 1);
});

test('Elements sessions retain settlement and reversal invariants without order side effects', async t => {
    const f = walletFixture(t);
    const created = await elementsTopUp(f, 'usd-5-v2');
    const paid = f.paidTopUp(created.sessionId);
    await f.service().settle(paid);
    await f.service().settle(paid);
    assert.equal((await f.service().verify('customer', { sessionId: created.sessionId })).balanceCents, 540);
    await f.webhook('charge.refunded', { ...f.intents.get(paid.payment_intent).latest_charge, amount_refunded: 500 });
    assert.equal((await f.service().snapshot('customer')).balanceCents, 0);
    assert.equal(f.ledger.entries.length, 2);
    assert.equal(f.state.queued.length, 0);
    assert.equal(f.state.redemptions.length, 0);
});

test('invalid UI modes, changed saved session modes and missing Elements secrets cannot open a popup', async t => {
    const f = walletFixture(t);
    await assert.rejects(f.service().createTopUp('customer', 'usd-25', 'http://localhost:5173', { uiMode: 'custom-injected' }), { code: 'WALLET_CHECKOUT_MODE' });
    assert.equal(f.state.created.length, 0);
    const created = await elementsTopUp(f);
    const session = f.sessions.get(created.sessionId);
    session.ui_mode = 'hosted';
    await assert.rejects(elementsTopUp(f), { code: 'WALLET_QUOTE_MISMATCH' });
    session.ui_mode = 'elements';
    session.client_secret = null;
    await assert.rejects(elementsTopUp(f), { code: 'WALLET_CHECKOUT_UNAVAILABLE' });
    assert.equal(f.state.created.length, 1);
    assert.equal(f.ledger.entries.length, 0);
});

test('current and legacy Stripe hosted mode names recover and settle old hosted sessions', async t => {
    for (const uiMode of ['hosted_page', 'hosted', null]) {
        const f = walletFixture(t);
        const created = await topUp(f);
        f.sessions.get(created.sessionId).ui_mode = uiMode;
        assert.equal((await topUp(f)).sessionId, created.sessionId);
        const paid = f.paidTopUp(created.sessionId);
        await f.service().settle(paid);
        assert.equal((await f.service().snapshot('customer')).balanceCents, 2800);
    }
});

test('the versioned five-dollar offer grants eight percent and never creates retired ten-percent intents', async t => {
    const f = walletFixture(t);
    const snapshot = await f.service().snapshot('customer');
    assert.equal(snapshot.packages[0].id, 'usd-5-v2');
    assert.equal(snapshot.packages.some(offer => offer.id === 'usd-5'), false);
    await assert.rejects(topUp(f, 'usd-5'), { code: 'WALLET_PACKAGE' });
    const created = await elementsTopUp(f, 'usd-5-v2');
    assert.deepEqual(created.summary, { packageId: 'usd-5-v2', currency: 'usd', amountCents: 500, bonusPercent: 8, bonusCents: 40, creditCents: 540 });
    assert.equal(f.createCalls[0].parameters.metadata.bonusCents, '40');
    assert.equal(f.ledger.topUps[0].bonusPercent, 8);
    assert.equal(f.ledger.entries.length, 0);
});

test('an old saved five-dollar intent recovers its promised ten-percent bonus and settles unchanged', async t => {
    const f = walletFixture(t);
    f.ledger.topUps.push({ id: 'legacy-five-dollar', userId: 'customer', packageId: 'usd-5', amountCents: 500,
        bonusPercent: 10, bonusCents: 50, currency: 'usd', clientUrl: 'http://localhost:5173', status: 'CREATING',
        stripeCheckoutSessionId: null, stripePaymentIntentId: null, createdAt: new Date() });
    f.loseCreateResponse();
    await assert.rejects(topUp(f, 'usd-5'), /response was lost/);
    const recovered = await topUp(f, 'usd-5');
    assert.equal(recovered.summary.bonusCents, 50);
    assert.equal(recovered.summary.creditCents, 550);
    const paid = f.paidTopUp(recovered.sessionId);
    await f.service().settle(paid);
    await f.service().settle(paid);
    assert.equal((await f.service().verify('customer', { sessionId: recovered.sessionId })).balanceCents, 550);
    assert.equal(f.ledger.entries[0].promotionalCents, 50);
    assert.equal(f.ledger.topUps[0].bonusPercent, 10);
    assert.equal(f.state.created.length, 1);
    await assert.rejects(topUp(f, 'usd-5'), { code: 'WALLET_PACKAGE' });
    assert.equal(f.state.created.length, 1, 'a retired package cannot start another checkout after settlement');
});

test('cancel authenticates the saved top-up owner before contacting Stripe', async t => {
    const f = walletFixture(t);
    const created = await elementsTopUp(f);
    let reads = 0;
    const retrieve = f.stripe.checkout.sessions.retrieve;
    f.stripe.checkout.sessions.retrieve = async (...args) => { reads++; return retrieve(...args); };
    await assert.rejects(f.service().cancel('other', created.sessionId), { code: 'WALLET_TOPUP_UNAVAILABLE' });
    for (const id of [null, ['cs_injected'], 'invalid', 'cs_bad?x=1']) await assert.rejects(f.service().cancel('customer', id), { code: 'WALLET_TOPUP_ID' });
    assert.equal(reads, 0);
    assert.deepEqual(f.state.expired, []);
});

test('cancel confirms expiration idempotently without crediting funds and works for a frozen account', async t => {
    const f = walletFixture(t);
    const created = await elementsTopUp(f);
    f.ledger.accounts[0].frozenAt = new Date();
    const cancelled = await f.service().cancel('customer', created.sessionId);
    assert.equal(cancelled.cancelled, true);
    assert.equal(cancelled.paid, false);
    assert.equal(cancelled.status, 'cancelled');
    assert.equal(cancelled.sessionId, created.sessionId);
    assert.equal(cancelled.balanceCents, 0);
    assert.equal(cancelled.frozen, true);
    assert.equal((await f.service().cancel('customer', created.sessionId)).cancelled, true);
    assert.equal(f.ledger.topUps[0].status, 'EXPIRED');
    assert.equal(f.ledger.entries.length, 0);
    assert.equal(f.state.expired.length, 1);
    assert.equal(f.state.created.length, 1);
});

test('cancel reports a paid or reversed top-up truthfully and never expires it', async t => {
    const f = walletFixture(t);
    const created = await elementsTopUp(f, 'usd-5-v2');
    const session = f.paidTopUp(created.sessionId);
    const paid = await f.service().cancel('customer', created.sessionId);
    assert.equal(paid.cancelled, false);
    assert.equal(paid.paid, true);
    assert.equal(paid.status, 'paid');
    assert.equal(paid.balanceCents, 540);
    await f.webhook('charge.refunded', { ...f.intents.get(session.payment_intent).latest_charge, amount_refunded: 500 });
    const reversed = await f.service().cancel('customer', created.sessionId);
    assert.equal(reversed.cancelled, false);
    assert.equal(reversed.paid, false);
    assert.equal(reversed.status, 'reversed');
    assert.equal(reversed.balanceCents, 0);
    assert.deepEqual(f.state.expired, []);
    assert.equal(f.state.created.length, 1);
});

test('complete unpaid and failed expiration remain pending rather than claiming cancellation', async t => {
    const f = walletFixture(t);
    const created = await elementsTopUp(f);
    f.state.failExpire = true;
    const open = await f.service().cancel('customer', created.sessionId);
    assert.equal(open.status, 'pending');
    assert.equal(open.cancelled, false);
    assert.equal(f.ledger.topUps[0].status, 'PENDING');
    f.sessions.get(created.sessionId).status = 'complete';
    const confirming = await f.service().cancel('customer', created.sessionId);
    assert.equal(confirming.status, 'pending');
    assert.equal(confirming.cancelled, false);
    assert.equal(confirming.paid, false);
    assert.deepEqual(f.state.expired, []);
    assert.equal(f.ledger.entries.length, 0);
});

test('cancel recovers a lost expiration reply and handles payment winning the expiration race', async t => {
    const f = walletFixture(t);
    const first = await elementsTopUp(f);
    const expireSession = f.stripe.checkout.sessions.expire;
    f.stripe.checkout.sessions.expire = async (...args) => { await expireSession(...args); throw new Error('expiration reply lost'); };
    assert.equal((await f.service().cancel('customer', first.sessionId)).cancelled, true);
    const second = await elementsTopUp(f);
    f.stripe.checkout.sessions.expire = async id => { f.paidTopUp(id); throw new Error('payment completed first'); };
    const result = await f.service().cancel('customer', second.sessionId);
    assert.equal(result.cancelled, false);
    assert.equal(result.status, 'paid');
    assert.equal(result.balanceCents, 2800);
    assert.equal(f.ledger.entries.length, 1);
});

test('cancel validates the saved quote before expiring or reporting cancellation', async t => {
    const f = walletFixture(t);
    const created = await elementsTopUp(f);
    f.sessions.get(created.sessionId).amount_total = 1;
    await assert.rejects(f.service().cancel('customer', created.sessionId), { code: 'WALLET_QUOTE_MISMATCH' });
    assert.deepEqual(f.state.expired, []);
    assert.equal(f.ledger.topUps[0].status, 'PENDING');
    assert.equal(f.ledger.entries.length, 0);
});
