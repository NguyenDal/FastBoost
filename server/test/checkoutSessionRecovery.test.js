const test = require('node:test');
const assert = require('node:assert/strict');
const { paymentFixture } = require('../test-helpers/paymentFixture');

function cacheCreateResponses(f) {
    const create = f.stripe.checkout.sessions.create;
    const cache = new Map();
    const keys = [];
    f.stripe.checkout.sessions.create = async (parameters, options) => {
        keys.push(options.idempotencyKey);
        if (!cache.has(options.idempotencyKey)) {
            cache.set(options.idempotencyKey, structuredClone(await create(parameters, options)));
        }
        return structuredClone(cache.get(options.idempotencyKey));
    };
    return { cache, keys };
}

test('retry after a database rollback replaces expired cached create responses and reuses the recovered session', async t => {
    const f = paymentFixture(t, { orders: [{ id: 'order' }] });
    const { keys } = cacheCreateResponses(f);
    const update = f.db.order.update;
    let fail = true;
    f.db.order.update = async args => {
        if (fail) { fail = false; throw new Error('Simulated write failure after Stripe create'); }
        return update(args);
    };
    assert.equal((await f.checkout('order')).code, 500);
    assert.equal(f.state.orders[0].stripeCheckoutSessionId, null);
    assert.deepEqual(f.state.expired, ['cs_test_1']);
    const recovered = await f.checkout('order');
    assert.equal(recovered.code, 200);
    assert.equal(recovered.body.sessionId, 'cs_test_2');
    assert.equal(f.sessions.get(recovered.body.sessionId).status, 'open');
    assert.equal(keys[0], keys[1], 'retry first checks the original idempotent create');
    assert.notEqual(keys[1], keys[2], 'expired sessions use a distinct recovery key');
    assert.ok(keys[2].length <= 255);
    assert.equal(f.state.orders[0].stripeCheckoutSessionId, recovered.body.sessionId);
    assert.equal((await f.checkout('order')).body.sessionId, recovered.body.sessionId);
    assert.equal(f.state.created.length, 2, 'refresh does not create another payable session');
});

test('recovery keys are deterministic across another rollback and concurrent retries keep one payable session', async t => {
    const f = paymentFixture(t, { orders: [{ id: 'order' }] });
    const { keys } = cacheCreateResponses(f);
    const update = f.db.order.update;
    let failures = 2;
    f.db.order.update = async args => {
        if (failures-- > 0) throw new Error('Simulated repeated database failure');
        return update(args);
    };
    assert.equal((await f.checkout('order')).code, 500);
    assert.equal((await f.checkout('order')).code, 500);
    const recovered = await Promise.all([f.checkout('order'), f.checkout('order')]);
    assert.ok(recovered.every(res => res.code === 200 && res.body.sessionId === 'cs_test_3'));
    assert.equal(keys[2], keys[4], 'the same expired session produces the same recovery key');
    assert.deepEqual([...f.sessions.values()].filter(session => session.status === 'open').map(session => session.id), ['cs_test_3']);
});

test('a completed cached session is bound for verification without creating another charge', async t => {
    const f = paymentFixture(t, { orders: [{ id: 'order' }] });
    cacheCreateResponses(f);
    const create = f.stripe.checkout.sessions.create;
    f.stripe.checkout.sessions.create = async (...args) => {
        const cached = await create(...args);
        Object.assign(f.sessions.get(cached.id), { status: 'complete', payment_status: 'paid', payment_intent: 'pi_offline' });
        return cached;
    };
    const res = await f.checkout('order');
    assert.equal(res.code, 200);
    assert.equal(res.body.completed, true);
    assert.equal(res.body.clientSecret, undefined);
    assert.equal(f.state.created.length, 1);
    assert.equal(f.state.orders[0].stripeCheckoutSessionId, res.body.sessionId);
    const verified = f.response();
    await f.controller.verifyCheckoutSession({ user: { id: 'customer' }, query: { sessionId: res.body.sessionId } }, verified);
    assert.equal(verified.body.paid, true);
    assert.equal(f.balance(), 0);
    assert.equal(f.state.queued.length, 1);
});

test('expired replay chains are bounded and never return unusable client secrets', async t => {
    const f = paymentFixture(t, { orders: [{ id: 'order' }] });
    const { keys } = cacheCreateResponses(f);
    const create = f.stripe.checkout.sessions.create;
    f.stripe.checkout.sessions.create = async (...args) => {
        const cached = await create(...args);
        f.sessions.get(cached.id).status = 'expired';
        return cached;
    };
    const res = await f.checkout('order');
    assert.equal(res.code, 503);
    assert.equal(res.body.code, 'CHECKOUT_SESSION_UNAVAILABLE');
    assert.equal(res.body.clientSecret, undefined);
    assert.equal(keys.length, 3);
    assert.equal(f.state.orders[0].stripeCheckoutSessionId, 'cs_test_3', 'bounded exhaustion checkpoints only a confirmed expired session');
    assert.equal(f.state.expired.length, 0, 'known expired sessions do not need rollback cleanup');
});

test('three rollback failures cannot permanently trap a healthy draft behind expired replay responses', async t => {
    const f = paymentFixture(t, { orders: [{ id: 'order' }] });
    cacheCreateResponses(f);
    const update = f.db.order.update;
    let failures = 3;
    f.db.order.update = async args => {
        if (failures-- > 0) throw new Error('Simulated database outage');
        return update(args);
    };
    for (let attempt = 0; attempt < 3; attempt++) assert.equal((await f.checkout('order')).code, 500);
    assert.equal(f.state.orders[0].stripeCheckoutSessionId, null);
    const bounded = await f.checkout('order');
    assert.equal(bounded.code, 503);
    assert.equal(f.state.orders[0].stripeCheckoutSessionId, 'cs_test_3');
    assert.equal(f.state.orders[0].goldRedeemed, 0, 'checkpoint cannot commit failed price/Gold changes');
    const recovered = await f.checkout('order');
    assert.equal(recovered.code, 200);
    assert.equal(recovered.body.sessionId, 'cs_test_4');
    assert.equal(f.sessions.get(recovered.body.sessionId).status, 'open');
    assert.equal(f.state.created.length, 4);
});

test('recovery checkpoint cannot overwrite a newer checkout created after rollback', async t => {
    const f = paymentFixture(t, { orders: [{ id: 'order' }] });
    cacheCreateResponses(f);
    const create = f.stripe.checkout.sessions.create;
    f.stripe.checkout.sessions.create = async (...args) => {
        const cached = await create(...args);
        f.sessions.get(cached.id).status = 'expired';
        return cached;
    };
    const transaction = f.db.$transaction;
    let transactions = 0;
    f.db.$transaction = callback => {
        if (++transactions === 2) f.state.orders[0].stripeCheckoutSessionId = 'cs_newer_checkout';
        return transaction(callback);
    };
    assert.equal((await f.checkout('order')).code, 503);
    assert.equal(f.state.orders[0].stripeCheckoutSessionId, 'cs_newer_checkout');
});

test('failed status retrieval rolls back and expires the candidate instead of returning stale data', async t => {
    const f = paymentFixture(t, { orders: [{ id: 'order' }] });
    cacheCreateResponses(f);
    f.state.failRetrieve = true;
    const res = await f.checkout('order');
    assert.equal(res.code, 500);
    assert.equal(res.body.clientSecret, undefined);
    assert.equal(f.state.orders[0].stripeCheckoutSessionId, null);
    assert.deepEqual(f.state.expired, ['cs_test_1']);
    f.state.failRetrieve = false;
    assert.equal((await f.checkout('order')).body.sessionId, 'cs_test_2');
});
