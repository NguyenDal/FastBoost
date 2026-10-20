const test = require('node:test');
const assert = require('node:assert/strict');

function fixture(t, overrides = {}) {
    const previousEnv = { CLIENT_URL: process.env.CLIENT_URL, ORDER_COMPLETION_EMAILS_ENABLED: process.env.ORDER_COMPLETION_EMAILS_ENABLED };
    process.env.CLIENT_URL = 'https://fastboost.example';
    process.env.ORDER_COMPLETION_EMAILS_ENABLED = 'true';
    const state = { order: { id: 'order', orderNumber: 'TEST-COMPLETE', customerId: 'customer', status: 'IN_PROGRESS', paymentStatus: 'PAID',
        boostType: 'Win Boost', desiredWins: 3, customer: { id: 'customer', email: 'customer@example.test' },
        assignments: [{ boosterId: 'booster' }], ...overrides }, outbox: new Map(), enqueueCalls: 0, notifications: 0, trustpilotCalls: 0, failEnqueue: false, locks: [] };
    const db = {
        user: { findUnique: async () => ({ id: 'booster', role: 'PROVIDER', suspendedAt: null }) },
        orderAssignment: { findFirst: async () => ({ orderId: 'order', boosterId: 'booster' }) },
        order: {
            findUnique: async () => structuredClone(state.order),
            update: async ({ data }) => { Object.assign(state.order, data); return structuredClone(state.order); },
        },
        orderCompletionEmail: { upsert: async ({ where, create, update }) => {
            state.enqueueCalls++;
            assert.deepEqual(update, {});
            if (state.failEnqueue) throw new Error('synthetic outbox failure');
            if (!state.outbox.has(where.orderId)) state.outbox.set(where.orderId, structuredClone(create));
            return state.outbox.get(where.orderId);
        } },
        $queryRaw: async (strings, id) => {
            assert.match(strings.join('?'), /^SELECT id FROM "(?:User|Order)" WHERE id = \? FOR UPDATE$/);
            state.locks.push(id); return [{ id }];
        },
    };
    let tail = Promise.resolve();
    db.$transaction = callback => {
        const run = tail.then(async () => {
            const oldOrder = structuredClone(state.order), oldOutbox = structuredClone(state.outbox);
            try { return await callback(db); }
            catch (error) { state.order = oldOrder; state.outbox = oldOutbox; throw error; }
        });
        tail = run.catch(() => {});
        return run;
    };
    const replacements = new Map([
        [require.resolve('../src/prisma'), db],
        [require.resolve('../src/utils/stripeClient'), {}],
        [require.resolve('../src/utils/loyaltyTierBonuses'), { syncLoyaltyTierBonuses: async () => ({}) }],
        [require.resolve('../src/utils/referralProgram'), { grantReferralCompletionRewards: async () => ({ granted: false }) }],
        [require.resolve('../src/utils/orderNotifications'), { notifyOrderStatus: async () => { state.notifications++; } }],
        [require.resolve('../src/utils/trustpilotEmail'), { sendTrustpilotReviewInvite: async () => { state.trustpilotCalls++; return false; } }],
        [require.resolve('../src/utils/orderPasswordCrypto'), {
            stripEncryptedPasswordFields: order => ({ ...order }), hasEncryptedPasswordFields: () => false,
        }],
    ]);
    const saved = new Map();
    const controllerPath = require.resolve('../src/controllers/orderController');
    saved.set(controllerPath, require.cache[controllerPath]);
    for (const [path, exports] of replacements) { saved.set(path, require.cache[path]); require.cache[path] = { id: path, filename: path, loaded: true, exports }; }
    delete require.cache[controllerPath];
    const controller = require(controllerPath);
    const previousError = console.error; console.error = () => {};
    t.after(() => {
        console.error = previousError;
        for (const [path, value] of saved) { if (value) require.cache[path] = value; else delete require.cache[path]; }
        for (const [key, value] of Object.entries(previousEnv)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    });
    return { state, db, invoke: async (method, status = 'COMPLETED') => {
        const res = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
        await controller[method]({ user: { id: 'booster', role: method === 'updateOrderStatus' ? 'ADMIN' : 'PROVIDER' }, params: { id: 'order' }, body: { status } }, res);
        return res;
    } };
}

for (const method of ['updateOrderStatus', 'providerCompleteAssignedOrder']) {
    test(`${method} commits one completion email with the first paid status transition`, async t => {
        const f = fixture(t);
        const results = await Promise.all([f.invoke(method), f.invoke(method)]);
        assert.deepEqual(results.map(result => result.code), [200, 200]);
        assert.equal(f.state.order.status, 'COMPLETED');
        assert.equal(f.state.outbox.size, 1);
        assert.equal(f.state.enqueueCalls, 1, 'a concurrent repeat sees the locked completed state');
        assert.match(f.state.outbox.get('order').payload.text, /\/match\/order#order-rating/);
        assert.equal(f.state.locks.filter(id => id === 'order').length, 2, 'each completion attempt locks the order');
        for (let index = 0; index < f.state.locks.length; index++) {
            if (f.state.locks[index] === 'order') assert.equal(f.state.locks[index - 1], 'customer', 'customer must be locked before its order');
            else assert.equal(f.state.locks[index], 'customer');
        }
        assert.ok(f.state.trustpilotCalls > 0, 'existing Trustpilot integration still runs');
        assert.equal((await f.invoke(method)).code, 200);
        assert.equal(f.state.enqueueCalls, 1);
        const originalPayload = structuredClone(f.state.outbox.get('order').payload);
        f.state.order.status = 'IN_PROGRESS';
        f.state.order.customer.email = 'changed@example.test';
        await f.invoke(method);
        assert.equal(f.state.outbox.size, 1, 're-completion cannot create a second outbox record');
        assert.deepEqual(f.state.outbox.get('order').payload, originalPayload);
    });

    test(`${method} rolls back completion when the transactional outbox cannot be queued`, async t => {
        const f = fixture(t); f.state.failEnqueue = true;
        const result = await f.invoke(method);
        assert.equal(result.code, 500);
        assert.equal(f.state.order.status, 'IN_PROGRESS');
        assert.equal(f.state.outbox.size, 0);
        assert.equal(f.state.notifications, 0);
        assert.equal(f.state.trustpilotCalls, 0);
    });
}

test('disabled completion delivery needs no outbox schema and does not change current status handling', async t => {
    const f = fixture(t);
    process.env.ORDER_COMPLETION_EMAILS_ENABLED = 'false';
    delete f.db.orderCompletionEmail;
    assert.equal((await f.invoke('providerCompleteAssignedOrder')).code, 200);
    assert.equal(f.state.order.status, 'COMPLETED');
    assert.equal(f.state.outbox.size, 0);
});

test('unpaid provider completion is rejected and cancellation does not enqueue completion emails', async t => {
    const f = fixture(t, { paymentStatus: 'PENDING' });
    assert.equal((await f.invoke('providerCompleteAssignedOrder')).code, 409);
    assert.equal(f.state.outbox.size, 0);
    f.state.order.status = 'IN_PROGRESS'; f.state.order.paymentStatus = 'PAID';
    assert.equal((await f.invoke('updateOrderStatus', 'CANCELLED')).code, 200);
    assert.equal(f.state.order.status, 'CANCELLED');
    assert.equal(f.state.outbox.size, 0);
});
