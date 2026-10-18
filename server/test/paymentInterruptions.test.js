const test = require('node:test');
const assert = require('node:assert/strict');
const { paymentFixture } = require('../test-helpers/paymentFixture');

// Provider state intentionally lives outside the transactional database fixture,
// just as an accepted Stripe operation survives an application rollback/restart.
function durableStripeCreates(f) {
    const create = f.stripe.checkout.sessions.create;
    const responses = new Map();
    const keys = [];
    f.stripe.checkout.sessions.create = async (parameters, options) => {
        keys.push(options.idempotencyKey);
        if (!responses.has(options.idempotencyKey)) responses.set(options.idempotencyKey, await create(parameters, options));
        return structuredClone(responses.get(options.idempotencyKey));
    };
    return { keys, responses };
}

function loseNextCommitAcknowledgement(f) {
    const transaction = f.db.$transaction;
    let lost = false;
    f.db.$transaction = async (...args) => {
        const committed = await transaction(...args);
        if (!lost) { lost = true; throw Object.assign(new Error('Commit succeeded, acknowledgement lost'), { code: 'ECONNRESET' }); }
        return committed;
    };
}

async function verifyOrder(f, id, sessionId) {
    const res = f.response();
    await f.controller.verifyCheckoutSession({ user: { id: 'customer' }, query: sessionId ? { sessionId } : { orderId: id } }, res);
    return res;
}

test('Stripe create response loss and a server restart recover the same externally accepted session', async t => {
    const f = paymentFixture(t, { orders: [{ id: 'order' }] });
    const { keys } = durableStripeCreates(f);
    const create = f.stripe.checkout.sessions.create;
    let lost = false;
    f.stripe.checkout.sessions.create = async (...args) => {
        const accepted = await create(...args);
        if (!lost) { lost = true; throw Object.assign(new Error('Stripe accepted request, network reply lost'), { code: 'ECONNRESET' }); }
        return accepted;
    };
    assert.equal((await f.checkout('order')).code, 500);
    assert.equal(f.state.orders[0].stripeCheckoutSessionId, null);
    assert.equal(f.state.redemptions.length, 0);
    assert.equal(f.state.created.length, 1);
    f.restart();
    const recovered = await f.checkout('order');
    assert.equal(recovered.code, 200);
    assert.equal(recovered.body.sessionId, 'cs_test_1');
    assert.equal(keys[0], keys[1]);
    assert.equal(f.state.created.length, 1, 'lost Stripe responses cannot produce a second payable checkout');
    assert.equal(f.balance(), 100, 'preparing checkout never spends Gold');
});

test('a failed database write and lost cleanup response recover one session without duplicating charges', async t => {
    const f = paymentFixture(t, { orders: [{ id: 'order' }] });
    durableStripeCreates(f);
    const update = f.db.order.update;
    let failed = false;
    f.db.order.update = async args => { if (!failed) { failed = true; throw new Error('Database unavailable after Stripe create'); } return update(args); };
    f.state.failExpire = true;
    assert.equal((await f.checkout('order')).code, 500);
    assert.equal(f.state.orders[0].stripeCheckoutSessionId, null);
    assert.equal(f.sessions.get('cs_test_1').status, 'open');
    f.state.failExpire = false;
    f.restart();
    assert.equal((await f.checkout('order')).body.sessionId, 'cs_test_1');
    assert.equal(f.state.created.length, 1);
    assert.equal(f.state.redemptions.length, 0);
});

test('lost checkout commit acknowledgement leaves a recoverable expired session and one payable replacement', async t => {
    const f = paymentFixture(t, { orders: [{ id: 'order' }] });
    durableStripeCreates(f);
    loseNextCommitAcknowledgement(f);
    assert.equal((await f.checkout('order')).code, 503);
    assert.equal(f.state.orders[0].stripeCheckoutSessionId, 'cs_test_1', 'database commit was durable despite its lost reply');
    assert.equal(f.sessions.get('cs_test_1').status, 'expired', 'ambiguous checkout is retired before retry');
    f.restart();
    const recovered = await Promise.all([f.checkout('order'), f.checkout('order')]);
    assert.ok(recovered.every(res => res.code === 200 && res.body.sessionId === 'cs_test_2'));
    assert.deepEqual([...f.sessions.values()].filter(session => session.status === 'open').map(session => session.id), ['cs_test_2']);
    assert.equal(f.balance(), 100);
});

test('Gold-only commit followed by a lost HTTP response is discovered on retry without spending points twice', async t => {
    const f = paymentFixture(t, { orders: [{ id: 'gold', amountCents: 1000, totalPrice: 10, basePrice: 10 }] });
    await assert.rejects(f.controller.createCheckoutSession({ user: { id: 'customer' },
        body: { orderId: 'gold', goldToUse: 100, contactEmail: 'receipt@example.test' }, hostname: 'localhost', get: () => 'http://localhost:5173' },
    { status() { return this; }, json() { throw Object.assign(new Error('Customer Wi-Fi disappeared after commit'), { code: 'EPIPE' }); } }), /Wi-Fi/);
    assert.equal(f.state.orders[0].paymentStatus, 'PAID');
    assert.equal(f.balance(), 0);
    assert.equal(f.state.redemptions.length, 1);
    assert.equal(f.state.queued.length, 1);
    f.restart();
    const retries = await Promise.all([f.checkout('gold'), f.checkout('gold')]);
    assert.ok(retries.every(res => res.body.paid === true));
    assert.equal((await verifyOrder(f, 'gold')).body.paid, true);
    assert.equal(f.state.redemptions.length, 1);
    assert.equal(f.state.queued.length, 1);
    assert.deepEqual(f.state.referrals, ['gold']);
});

test('lost Gold-only database commit reply cannot reverse or repeat the committed redemption', async t => {
    const f = paymentFixture(t, { orders: [{ id: 'gold', amountCents: 1000, totalPrice: 10, basePrice: 10 }] });
    loseNextCommitAcknowledgement(f);
    assert.equal((await f.checkout('gold', { contactEmail: 'receipt@example.test' })).code, 503);
    assert.equal(f.state.orders[0].paymentStatus, 'PAID');
    f.restart();
    assert.equal((await f.checkout('gold')).body.paid, true);
    assert.equal(f.balance(), 0);
    assert.equal(f.state.redemptions.length, 1);
    assert.equal(f.state.queued.length, 1);
    assert.deepEqual(f.state.referrals, ['gold']);
});

test('a paid Stripe charge with lost settlement commit acknowledgement settles once across restart and event retries', async t => {
    const f = paymentFixture(t, { orders: [{ id: 'order' }] });
    const prepared = await f.checkout('order');
    const paid = f.paidSession('order');
    f.sessions.set(paid.id, paid);
    loseNextCommitAcknowledgement(f);
    assert.equal((await f.webhook('checkout.session.completed', paid)).code, 500);
    assert.equal(f.state.orders[0].paymentStatus, 'PAID');
    assert.equal(f.balance(), 0);
    f.restart();
    const results = await Promise.all([
        f.webhook('checkout.session.completed', paid), f.webhook('checkout.session.async_payment_succeeded', paid),
        verifyOrder(f, 'order', prepared.body.sessionId),
    ]);
    assert.ok(results.every(res => res.code === 200));
    assert.equal(results[2].body.paid, true);
    assert.equal(f.state.redemptions.length, 1);
    assert.equal(f.state.queued.length, 1);
    assert.deepEqual(f.state.referrals, ['order']);
});

test('lost Stripe expiration reply preserves Gold until restart safely transfers the claim between tabs', async t => {
    const f = paymentFixture(t, { orders: [{ id: 'first' }, { id: 'second' }] });
    const first = await f.checkout('first');
    const expire = f.stripe.checkout.sessions.expire;
    let lost = false;
    f.stripe.checkout.sessions.expire = async (...args) => {
        const accepted = await expire(...args);
        if (!lost) { lost = true; throw new Error('Expiration succeeded but network reply was lost'); }
        return accepted;
    };
    assert.equal((await f.checkout('second')).code, 503);
    assert.equal(f.sessions.get(first.body.sessionId).status, 'expired');
    assert.equal(f.state.orders[0].goldRedeemed, 100, 'ambiguous transfer rolls back allocation changes');
    assert.equal(f.state.orders[1].goldRedeemed, 0);
    f.restart();
    const second = await f.checkout('second');
    assert.equal(second.code, 200);
    assert.equal(f.state.orders[0].goldRedeemed, 0);
    assert.equal(f.state.orders[1].goldRedeemed, 100);
    const paid = f.paidSession('second'); f.sessions.set(paid.id, paid);
    assert.equal((await f.webhook('checkout.session.completed', paid)).code, 200);
    assert.equal(f.balance(), 0);
    const reopened = await f.checkout('first');
    assert.equal(reopened.body.summary.goldRedeemed, 0);
    assert.equal(reopened.body.summary.totalCents, 2000);
    assert.equal(f.state.redemptions.length, 1);
});

test('referral award failure rolls back payment and Gold so an automatic webhook retry can recover them atomically', async t => {
    const f = paymentFixture(t, { orders: [{ id: 'order' }] });
    await f.checkout('order');
    const paid = f.paidSession('order'); f.sessions.set(paid.id, paid);
    f.state.failReferral = true;
    assert.equal((await f.webhook('checkout.session.completed', paid)).code, 500);
    assert.equal(f.state.orders[0].paymentStatus, 'PENDING');
    assert.equal(f.balance(), 100);
    assert.equal(f.state.queued.length + f.state.redemptions.length + f.state.referrals.length, 0);
    f.state.failReferral = false; f.restart();
    assert.equal((await f.webhook('checkout.session.completed', paid)).code, 200);
    assert.equal(f.balance(), 0);
    assert.equal(f.state.queued.length, 1);
    assert.deepEqual(f.state.referrals, ['order']);
});

test('order-only verification recovers a paid charge after power loss before the Stripe return URL', async t => {
    const f = paymentFixture(t, { orders: [{ id: 'order' }] });
    await f.checkout('order');
    const paid = f.paidSession('order'); f.sessions.set(paid.id, paid);
    f.restart();
    const verified = await verifyOrder(f, 'order');
    assert.equal(verified.code, 200);
    assert.equal(verified.body.paid, true);
    assert.equal(f.balance(), 0);
    assert.equal(f.state.redemptions.length, 1);
    assert.equal(f.state.queued.length, 1);
    assert.deepEqual(f.state.referrals, ['order']);
});
