const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { walletFixture } = require('../test-helpers/walletFixture');
const { CHECKOUT_LEASE_MS, renewCheckoutPresence } = require('../src/utils/checkoutPresence');
const { abandonWalletHold, sweepAbandonedWalletCheckouts } = require('../src/utils/abandonedWalletCheckout');

const fixture = t => walletFixture(t, { purchased: 5000, orders: [{ id: 'order' }, { id: 'other' }, { id: 'foreign', customerId: 'stranger' }] });
const quote = (f, view, amount = 1000, orderId = 'order') => f.checkout(orderId, { goldToUse: 0, walletToUseCents: amount, checkoutViewId: view });
const presence = async (f, view, { leave = false, user = 'customer', ...body } = {}) => {
    const res = f.response();
    await f.controller[leave ? 'leaveCheckoutPresence' : 'heartbeatCheckoutPresence']({ user: { id: user }, body: { orderId: 'order', checkoutViewId: view, ...body } }, res);
    return res;
};
const paid = (f, id) => ({ ...structuredClone(f.sessions.get(id)), status: 'complete', payment_status: 'paid', payment_intent: `pi_${id}` });

test('a quote registers its owned view atomically and heartbeat extends only that lease', async t => {
    const f = fixture(t), view = randomUUID();
    const before = Date.now();
    assert.equal((await quote(f, view)).code, 200);
    assert.equal(f.ledger.presences.length, 1);
    assert.equal(f.ledger.presences[0].orderId, 'order');
    assert.ok(f.ledger.presences[0].expiresAt.getTime() >= before + CHECKOUT_LEASE_MS);
    f.ledger.presences[0].expiresAt = new Date(Date.now() + 1000);
    assert.equal((await presence(f, view)).code, 200);
    assert.ok(f.ledger.presences[0].expiresAt.getTime() >= Date.now() + CHECKOUT_LEASE_MS - 100);
    assert.equal((await presence(f, randomUUID())).body.code, 'WALLET_VIEW_MISSING');
    assert.equal((await presence(f, view, { user: 'stranger' })).code, 404);
    assert.equal((await quote(f, 'not-a-uuid')).body.code, 'WALLET_VIEW_ID');
    assert.equal(f.ledger.holds.length, 1);
    assert.equal(f.ledger.entries.length, 0);
});

test('a normal last leave immediately releases a full-wallet hold without ledger or Stripe changes', async t => {
    const f = fixture(t), view = randomUUID();
    assert.equal((await quote(f, view, 2000)).body.walletOnlyReady, true);
    const res = await presence(f, view, { leave: true });
    assert.equal(res.body.released, true);
    assert.equal(res.body.availableBalanceCents, 5000);
    assert.equal(res.body.reservedBalanceCents, 0);
    assert.equal(f.ledger.holds.length, 0);
    assert.equal(f.ledger.entries.length, 0);
    assert.equal(f.state.created.length, 0);
    assert.equal(f.ledger.accounts[0].purchasedBalanceCents, 5000);
    assert.equal((await presence(f, view, { leave: true })).body.released, true);
});

test('all same-order views must leave before expiring the shared split session', async t => {
    const f = fixture(t), first = randomUUID(), second = randomUUID();
    const checkout = await quote(f, first);
    assert.equal((await quote(f, second)).body.sessionId, checkout.body.sessionId);
    assert.equal((await presence(f, first, { leave: true })).body.released, false);
    assert.equal(f.sessions.get(checkout.body.sessionId).status, 'open');
    assert.equal(f.ledger.holds.length, 1);
    const final = await presence(f, second, { leave: true });
    assert.equal(final.body.released, true);
    assert.equal(f.sessions.get(checkout.body.sessionId).status, 'expired');
    assert.equal(f.ledger.holds.length, 0);
    assert.equal(f.ledger.entries.length, 0);
});

test('leave tombstones reject delayed quotes, heartbeats and explicit wallet payment', async t => {
    const f = fixture(t), view = randomUUID();
    assert.equal((await presence(f, view, { leave: true })).code, 200, 'leave may arrive before initial registration');
    assert.equal((await quote(f, view, 2000)).body.code, 'WALLET_VIEW_CLOSED');
    assert.equal((await presence(f, view)).body.code, 'WALLET_VIEW_CLOSED');
    assert.equal((await f.payOrder('order', { checkoutViewId: view })).body.code, 'WALLET_VIEW_CLOSED');
    assert.equal(f.ledger.holds.length, 0);
    assert.equal(f.ledger.entries.length, 0);
    assert.equal(f.state.orders[0].paymentStatus, 'PENDING');
    assert.equal((await quote(f, randomUUID(), 2000)).body.walletOnlyReady, true);
});

test('closing one order cannot release a different order or a foreign customer’s reservation', async t => {
    const f = fixture(t), view = randomUUID();
    await quote(f, view, 2000);
    assert.equal((await presence(f, view, { leave: true, orderId: 'other' })).code, 404);
    assert.equal((await presence(f, view, { leave: true, user: 'stranger' })).code, 404);
    assert.equal(f.ledger.holds.length, 1);
    assert.equal(f.ledger.presences[0].closedAt, null);
});

test('lost Stripe create and expiration responses recover the same session before releasing', async t => {
    const f = fixture(t), view = randomUUID();
    f.loseCreateResponse();
    assert.equal((await quote(f, view)).code, 503);
    assert.equal(f.ledger.holds[0].stripeCheckoutSessionId, null);
    const expire = f.stripe.checkout.sessions.expire;
    f.stripe.checkout.sessions.expire = async id => { await expire(id); throw new Error('expiration reply lost'); };
    const left = await presence(f, view, { leave: true });
    assert.equal(left.body.released, true);
    assert.equal(f.state.created.length, 1);
    assert.deepEqual(f.createCalls[0], f.createCalls[1]);
    assert.equal(f.sessions.get('cs_test_1').status, 'expired');
    assert.equal(f.ledger.holds.length, 0);
    assert.equal((await quote(f, view)).body.code, 'WALLET_VIEW_CLOSED');
});

test('a paid expiration race settles the actual tenders and never reports a release', async t => {
    const f = fixture(t), view = randomUUID();
    const checkout = await quote(f, view);
    f.stripe.checkout.sessions.expire = async id => { Object.assign(f.sessions.get(id), paid(f, id)); throw new Error('payment won'); };
    const left = await presence(f, view, { leave: true });
    assert.equal(left.body.paid, true);
    assert.equal(left.body.released, false);
    assert.equal(left.body.availableBalanceCents, 4000);
    assert.equal(f.ledger.holds.length, 0);
    assert.equal(f.ledger.entries.length, 1);
    assert.equal(f.state.orders[0].paymentStatus, 'PAID');
    const repeated = await presence(f, view, { leave: true });
    assert.equal(repeated.body.paid, true);
    assert.equal(repeated.body.released, false);
    assert.equal((await f.webhook('checkout.session.completed', f.sessions.get(checkout.body.sessionId))).code, 200);
    assert.equal(f.ledger.entries.length, 1);
});

test('an unknown expiration response retains funds and lazy wallet reads retry it safely', async t => {
    const f = fixture(t), view = randomUUID();
    await quote(f, view);
    f.state.failExpire = true;
    assert.equal((await presence(f, view, { leave: true })).body.released, false);
    assert.equal(f.ledger.holds.length, 1);
    f.state.failExpire = false;
    assert.equal((await f.service().snapshot('customer')).availableBalanceCents, 5000);
    assert.equal(f.ledger.holds.length, 0);
});

test('payment protection survives quote refresh and a 3DS pagehide until its four-minute fallback', async t => {
    const f = fixture(t), view = randomUUID();
    const checkout = await quote(f, view);
    await presence(f, view, { paymentInProgress: true });
    const protectedUntil = f.ledger.presences[0].paymentProtectedUntil;
    await quote(f, view);
    assert.deepEqual(f.ledger.presences[0].paymentProtectedUntil, protectedUntil);
    assert.equal((await presence(f, view, { leave: true })).body.released, false);
    assert.equal((await f.service().snapshot('customer')).reservedBalanceCents, 1000);
    assert.equal(f.sessions.get(checkout.body.sessionId).status, 'open');
    const outcome = await f.db.$transaction(db => abandonWalletHold(db, f.ledger.holds[0], f.stripe, new Date(protectedUntil.getTime() + 1)));
    assert.equal(outcome.released, true);
    assert.equal(f.sessions.get(checkout.body.sessionId).status, 'expired');
    assert.equal(f.ledger.entries.length, 0);
});

test('definite confirmation failure clears protection so a normal leave releases promptly', async t => {
    const f = fixture(t), view = randomUUID();
    await quote(f, view);
    await presence(f, view, { paymentInProgress: true });
    await presence(f, view, { paymentInProgress: false });
    assert.equal((await presence(f, view, { leave: true })).body.released, true);
});

test('expired leases cannot revive and lazy wallet reads reclaim crashed views plus old legacy holds', async t => {
    const f = fixture(t), view = randomUUID();
    await quote(f, view, 2000);
    await f.checkout('other', { goldToUse: 0, walletToUseCents: 1000 });
    f.ledger.presences[0].expiresAt = new Date(Date.now() - 1);
    f.ledger.holds.forEach(hold => { hold.createdAt = new Date(Date.now() - CHECKOUT_LEASE_MS - 1000); });
    assert.equal((await presence(f, view)).body.code, 'WALLET_VIEW_EXPIRED');
    const snapshot = await f.service().snapshot('customer');
    assert.equal(snapshot.availableBalanceCents, 5000);
    assert.equal(snapshot.reservedBalanceCents, 0);
    assert.equal(snapshot.balanceCents, 5000);
    assert.equal(f.ledger.holds.length, 0);
    assert.equal(f.ledger.entries.length, 0);
    assert.equal((await quote(f, view)).body.code, 'WALLET_VIEW_CLOSED');
});

test('processing card payments and complete-unpaid payments retain their reservation after all views leave', async t => {
    const f = fixture(t), view = randomUUID();
    const checkout = await quote(f, view);
    const session = f.sessions.get(checkout.body.sessionId);
    session.payment_intent = 'pi_processing';
    f.intents.set('pi_processing', { id: 'pi_processing', status: 'processing' });
    assert.equal((await presence(f, view, { leave: true })).body.released, false);
    assert.equal(f.state.expired.length, 0);
    assert.equal((await f.service().snapshot('customer')).reservedBalanceCents, 1000);
    session.status = 'complete';
    f.intents.get('pi_processing').status = 'requires_payment_method';
    assert.equal((await f.service().snapshot('customer')).reservedBalanceCents, 1000);
    assert.equal(f.ledger.entries.length, 0);
});

test('lazy reconciliation settles a completed paid session before returning its final available balance', async t => {
    const f = fixture(t), view = randomUUID();
    const checkout = await quote(f, view);
    Object.assign(f.sessions.get(checkout.body.sessionId), paid(f, checkout.body.sessionId));
    f.ledger.presences[0].expiresAt = new Date(Date.now() - 1);
    f.ledger.holds[0].createdAt = new Date(Date.now() - CHECKOUT_LEASE_MS - 1000);
    const snapshot = await f.service().snapshot('customer');
    assert.equal(snapshot.balanceCents, 4000);
    assert.equal(snapshot.availableBalanceCents, 4000);
    assert.equal(snapshot.reservedBalanceCents, 0);
    assert.equal(f.ledger.entries.length, 1);
    assert.equal(f.state.orders[0].paymentStatus, 'PAID');
});

test('an explicit wallet pay racing leave either pays once or releases and rejects the closed view', async t => {
    const f = fixture(t), view = randomUUID();
    await quote(f, view, 2000);
    const [payment, left] = await Promise.all([f.payOrder('order', { checkoutViewId: view }), presence(f, view, { leave: true })]);
    assert.equal(payment.body.paidWithWallet, true);
    assert.equal(left.body.paid, true);
    assert.equal(f.ledger.entries.length, 1);
    assert.equal(f.ledger.holds.length, 0);
});

test('a verified canceled PaymentIntent releases a complete-unpaid session and clears its stale order pointer', async t => {
    const f = fixture(t), view = randomUUID();
    const checkout = await quote(f, view);
    const session = f.sessions.get(checkout.body.sessionId);
    Object.assign(session, { status: 'complete', payment_intent: 'pi_canceled' });
    const hold = structuredClone(f.ledger.holds[0]);
    const intent = { id: 'pi_canceled', object: 'payment_intent', status: 'canceled', currency: 'usd', amount: 1000,
        amount_received: 0, amount_capturable: 0, livemode: false, metadata: hold.stripeParametersJson.payment_intent_data.metadata };
    f.intents.set(intent.id, { ...intent, amount: 999 });
    assert.equal((await presence(f, view, { leave: true })).body.released, false, 'wrong amount cannot prove terminal cancellation');
    f.intents.set(intent.id, { ...intent, metadata: { ...intent.metadata, walletHoldId: 'another-hold' } });
    assert.equal((await f.service().snapshot('customer')).reservedBalanceCents, 1000);
    f.intents.set(intent.id, intent);
    assert.equal((await f.webhook('checkout.session.async_payment_failed', session)).code, 200);
    assert.equal(f.ledger.holds.length, 0);
    assert.equal(f.state.orders[0].stripeCheckoutSessionId, null);
    assert.equal(f.ledger.entries.length, 0);
    assert.equal((await quote(f, randomUUID())).code, 200, 'a confirmed failed old checkout cannot block a new quote');
});

test('a stale asynchronous failure rechecks current Stripe state and settles a payment that actually succeeded', async t => {
    const f = fixture(t), view = randomUUID();
    const checkout = await quote(f, view);
    const staleFailure = { ...structuredClone(f.sessions.get(checkout.body.sessionId)), status: 'complete', payment_intent: 'pi_raced' };
    Object.assign(f.sessions.get(checkout.body.sessionId), paid(f, checkout.body.sessionId));
    assert.equal((await f.webhook('checkout.session.async_payment_failed', staleFailure)).code, 200);
    assert.equal(f.state.orders[0].paymentStatus, 'PAID');
    assert.equal(f.ledger.entries.length, 1);
    assert.equal(f.ledger.holds.length, 0);
});

test('leave during external Stripe creation recovers and expires that durable session before a late quote can return it', async t => {
    const f = fixture(t), view = randomUUID();
    const create = f.stripe.checkout.sessions.create;
    let accepted, resume;
    const acceptedPromise = new Promise(resolve => { accepted = resolve; });
    const resumePromise = new Promise(resolve => { resume = resolve; });
    let first = true;
    f.stripe.checkout.sessions.create = async (...args) => {
        const result = await create(...args);
        if (first) { first = false; accepted(); await resumePromise; }
        return result;
    };
    const pending = quote(f, view);
    await acceptedPromise;
    const left = await presence(f, view, { leave: true });
    assert.equal(left.body.released, true);
    resume();
    const late = await pending;
    assert.notEqual(late.code, 200);
    assert.equal(late.body.clientSecret, undefined);
    assert.equal(f.state.created.length, 1);
    assert.equal(f.sessions.get('cs_test_1').status, 'expired');
    assert.equal(f.ledger.holds.length, 0);
    assert.equal(f.ledger.entries.length, 0);
});

test('worker advances past unresolved older holds and rechecks a live lease under checkout locks', async t => {
    const f = fixture(t), start = Date.now() - CHECKOUT_LEASE_MS - 1000;
    f.ledger.holds = Array.from({ length: 26 }, (_, i) => ({ id: `hold_${String(i).padStart(2, '0')}`, userId: 'customer', orderId: 'order',
        createdAt: new Date(start + i), amountCents: 1000, cashAmountCents: i === 25 ? 1000 : 2000,
        stripeCheckoutSessionId: i === 25 ? null : 'unknown', stripeParametersJson: i === 25 ? { walletOnly: true } : {} }));
    const whereQueries = [];
    const originalFindMany = f.db.walletCheckoutHold.findMany;
    f.db.walletCheckoutHold.findMany = async args => {
        if (!args.where.order) return originalFindMany(args);
        whereQueries.push(args.where);
        const after = args.where.OR;
        return structuredClone(f.ledger.holds.filter(row => !after || row.createdAt > after[0].createdAt.gt ||
            (row.createdAt.getTime() === after[1].createdAt.getTime() && row.id > after[1].id.gt)).slice(0, args.take));
    };
    const cursor = {};
    await sweepAbandonedWalletCheckouts(f.db, f.stripe, async () => assert.fail('no paid sessions'), new Date(), cursor);
    assert.equal(cursor.after.id, 'hold_24');
    assert.equal(f.ledger.holds.length, 26);
    await sweepAbandonedWalletCheckouts(f.db, f.stripe, async () => {}, new Date(), cursor);
    assert.equal(f.ledger.holds.length, 25, 'later full-wallet hold is released despite deferred older sessions');
    assert.equal(cursor.after, null);
    assert.ok(whereQueries[0].order.walletCheckoutPresences.none.expiresAt.gt instanceof Date);
    f.ledger.holds = [{ id: 'race', userId: 'customer', orderId: 'order', createdAt: new Date(start),
        amountCents: 2000, cashAmountCents: 2000, stripeCheckoutSessionId: null, stripeParametersJson: { walletOnly: true } }];
    const findUnique = f.db.walletCheckoutHold.findUnique;
    let locked = false;
    f.db.$queryRaw = async () => { locked = true; return []; };
    f.db.walletCheckoutHold.findUnique = async args => {
        assert.equal(locked, true);
        if (!f.ledger.presences.length) await renewCheckoutPresence(f.db, 'customer', 'order', randomUUID(), { create: true });
        return findUnique(args);
    };
    await sweepAbandonedWalletCheckouts(f.db, f.stripe, async () => {}, new Date(), cursor);
    assert.equal(f.ledger.holds.length, 1, 'presence renewed before locked recheck retains its funds');
});
