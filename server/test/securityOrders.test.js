const test = require('node:test');
const assert = require('node:assert/strict');
const { paymentFixture } = require('../test-helpers/paymentFixture');

// Security proof cases describe the current vulnerable behavior. All records,
// credentials, Stripe events, notifications and rewards are synthetic in memory.
const response = () => ({ code: 200, status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; } });

function orderFixture(t, overrides = {}) {
    const order = { id: 'synthetic-order', orderNumber: 'TEST-ONLY', customerId: 'customer',
        serviceId: 'service', status: 'CANCELLED', paymentStatus: 'PAID',
        basePrice: 200, totalPrice: 200, amountCents: 20000, currency: 'usd',
        assignments: [{ boosterId: 'booster' }], trustpilotReviewSentAt: new Date(),
        ...overrides };
    const actor = { id: 'booster', role: 'PROVIDER', suspendedAt: null, hasBoosterAccess: false };
    const calls = { users: 0, decryptions: 0, statuses: [], referrals: [], notifications: [] };
    const db = {
        user: { findUnique: async () => { calls.users++; return { ...actor }; }, findMany: async () => [] },
        order: {
            findUnique: async () => structuredClone(order),
            update: async ({ data }) => { Object.assign(order, data); return structuredClone(order); },
        },
        orderAssignment: {
            findFirst: async () => order.assignments.length ? { orderId: order.id, boosterId: actor.id,
                booster: { username: 'Synthetic booster' }, order: structuredClone(order) } : null,
            delete: async () => { order.assignments = []; }, count: async () => order.assignments.length,
        },
        conversation: { findUnique: async () => null },
    };
    const replacements = new Map([
        [require.resolve('../src/prisma'), db],
        [require.resolve('../src/utils/stripeClient'), {}],
        [require.resolve('../src/utils/loyaltyTierBonuses'), { syncLoyaltyTierBonuses: async () => ({}) }],
        [require.resolve('../src/utils/referralProgram'), {
            grantReferralCompletionRewards: async id => { calls.referrals.push(id); return { granted: false }; },
        }],
        [require.resolve('../src/utils/orderNotifications'), {
            notifyOrderStatus: async (_db, record) => calls.statuses.push(record.status),
        }],
        [require.resolve('../src/utils/trustpilotEmail'), { sendTrustpilotReviewInvite: async () => false }],
        [require.resolve('../src/utils/orderPasswordCrypto'), {
            stripEncryptedPasswordFields: value => {
                const copy = { ...value }; delete copy.accountPasswordCiphertext; return copy;
            },
            hasEncryptedPasswordFields: value => Boolean(value.accountPasswordCiphertext),
            decryptOrderPassword: async () => { calls.decryptions++; return 'synthetic-password-never-real'; },
        }],
    ]);
    const saved = new Map();
    const controllerPath = require.resolve('../src/controllers/orderController');
    saved.set(controllerPath, require.cache[controllerPath]);
    for (const [path, exports] of replacements) {
        saved.set(path, require.cache[path]);
        require.cache[path] = { id: path, filename: path, loaded: true, exports };
    }
    delete require.cache[controllerPath];
    const controller = require(controllerPath);
    t.after(() => {
        for (const [path, previous] of saved) {
            if (previous) require.cache[path] = previous;
            else delete require.cache[path];
        }
    });
    return { order, actor, calls, db, controller,
        invoke: async (method, user = { id: actor.id, role: actor.role }) => {
            const res = response();
            await controller[method]({ user, params: { id: order.id }, query: {} }, res);
            return res;
        } };
}

test('security proof: a suspended or revoked assigned booster can still read decrypted order credentials', async t => {
    const f = orderFixture(t, { accountPasswordCiphertext: 'synthetic-ciphertext' });
    // Admin suspension/access changes retain assignments in the application.
    Object.assign(f.actor, { role: 'CUSTOMER', suspendedAt: new Date(), hasBoosterAccess: false });
    const result = await f.invoke('getOrderById', { id: 'booster', role: 'CUSTOMER' });
    assert.equal(result.code, 200);
    assert.equal(result.body.order.accountPassword, 'synthetic-password-never-real');
    assert.equal(f.calls.users, 0, 'credential access never reloads current account privileges');
    assert.equal(f.calls.decryptions, 1);
    const outsider = await f.invoke('getOrderById', { id: 'outsider', role: 'PROVIDER' });
    assert.equal(outsider.code, 403, 'negative control: unrelated booster is rejected');
    assert.equal(f.calls.decryptions, 1);
});

test('security proof: a demoted or suspended previous ADMIN token can decrypt an unrelated order', async t => {
    const f = orderFixture(t, { assignments: [], accountPasswordCiphertext: 'synthetic-ciphertext' });
    Object.assign(f.actor, { id: 'former-admin', role: 'CUSTOMER', suspendedAt: new Date() });
    const result = await f.invoke('getOrderById', { id: f.actor.id, role: 'ADMIN' });
    assert.equal(result.code, 200);
    assert.notEqual(f.order.customerId, f.actor.id);
    assert.deepEqual(f.order.assignments, []);
    assert.equal(result.body.order.accountPassword, 'synthetic-password-never-real');
    assert.equal(f.calls.users, 0, 'current database role and suspension are never consulted');
    assert.equal(f.calls.decryptions, 1);
    const { routeFor } = require('../src/utils/managementAudit');
    assert.equal(routeFor('GET', `/orders/${f.order.id}`), null,
        'the mounted management audit does not guard this read route');
});

test('security negative control: previous ADMIN token cannot change an unrelated order login details', async t => {
    const f = orderFixture(t, { assignments: [], accountPasswordCiphertext: 'synthetic-ciphertext',
        inGameName: 'Synthetic#Original' });
    const res = response();
    await f.controller.updateOrderLoginInfo({ user: { id: 'former-admin', role: 'ADMIN' },
        params: { id: f.order.id }, body: { inGameName: 'Synthetic#Attack', clearPassword: true } }, res);
    assert.equal(res.code, 403, 'write handler itself requires the order customer, irrespective of ADMIN claim');
    assert.equal(f.order.inGameName, 'Synthetic#Original');
    assert.equal(f.order.accountPasswordCiphertext, 'synthetic-ciphertext');
    const { routeFor } = require('../src/utils/managementAudit');
    assert.equal(routeFor('PATCH', `/orders/${f.order.id}/login-info`).action, 'order.login-info',
        'the mounted write additionally receives the fresh management actor check');
});

test('security proof: an assigned booster can complete an admin-cancelled paid order', async t => {
    const f = orderFixture(t);
    const result = await f.invoke('providerCompleteAssignedOrder');
    assert.equal(result.code, 200);
    assert.equal(f.order.status, 'COMPLETED');
    assert.deepEqual(f.calls.statuses, ['COMPLETED']);
    assert.deepEqual(f.calls.referrals, [f.order.id]);
});

test('security proof: an assigned booster can mark an unpaid order completed', async t => {
    const f = orderFixture(t, { status: 'PENDING', paymentStatus: 'PENDING' });
    const result = await f.invoke('providerCompleteAssignedOrder');
    assert.equal(result.code, 200);
    assert.equal(f.order.status, 'COMPLETED');
    assert.equal(f.order.paymentStatus, 'PENDING', 'this bypasses workflow, not Stripe payment validation');
});

test('security proof: the last booster can reopen a completed order by leaving it', async t => {
    const f = orderFixture(t, { status: 'COMPLETED' });
    const result = await f.invoke('providerLeaveAssignedOrder');
    assert.equal(result.code, 200);
    assert.equal(f.order.status, 'PENDING');
    assert.deepEqual(f.order.assignments, []);
});

test('security proof: accepting a pending invitation reopens an admin-cancelled order', async t => {
    const f = orderFixture(t, { assignments: [] });
    const request = { id: 'synthetic-invitation', orderId: f.order.id, boosterId: 'booster',
        requestedBy: 'admin', status: 'PENDING', order: structuredClone(f.order), booster: { ...f.actor } };
    f.db.assignmentRequest = {
        findUnique: async () => structuredClone(request),
        update: async ({ data }) => Object.assign(request, data),
    };
    f.db.orderAssignment.upsert = async ({ create }) => {
        f.order.assignments.push(create); return create;
    };
    f.db.conversation.findUnique = async () => ({ id: 'synthetic-conversation' });
    f.db.conversationParticipant = { upsert: async () => ({}) };
    f.db.notification = { updateMany: async () => ({ count: 1 }), create: async () => ({}) };
    const path = require.resolve('../src/controllers/assignmentRequestController');
    const previous = require.cache[path];
    delete require.cache[path];
    const controller = require(path);
    const res = response();
    try {
        await controller.acceptAssignmentRequest({ user: { id: 'booster', role: 'PROVIDER' },
            params: { requestId: request.id } }, res);
    } finally {
        if (previous) require.cache[path] = previous;
        else delete require.cache[path];
    }
    assert.equal(res.code, 200);
    assert.equal(request.status, 'ACCEPTED');
    assert.equal(f.order.status, 'IN_PROGRESS');
    assert.equal(f.order.assignments[0].boosterId, 'booster');
});

test('security proof: previously saved first-purchase referral discounts remain usable after the first payment', async t => {
    // createOrder obtains the offer only while there are no PAID orders and
    // saves that 10% discount in every draft. Checkout does not revalidate it.
    const f = paymentFixture(t, { initialGold: 0, orders: ['first', 'second'].map(id => ({
        id, basePrice: 50, totalPrice: 45, amountCents: 4500, referralDiscount: 5,
    })) });
    const first = await f.checkout('first', { goldToUse: 0 });
    assert.equal(first.code, 200);
    const firstSession = f.sessions.get(first.body.sessionId);
    Object.assign(firstSession, { status: 'complete', payment_status: 'paid', payment_intent: 'pi_synthetic' });
    assert.equal((await f.webhook('checkout.session.completed', firstSession)).code, 200);
    assert.equal(f.state.orders[0].paymentStatus, 'PAID');
    const second = await f.checkout('second', { goldToUse: 0 });
    assert.equal(second.code, 200);
    assert.equal(f.sessions.get(second.body.sessionId).amount_total, 4500);
    assert.equal(f.state.orders[1].referralDiscount, 5);
    assert.equal(f.state.orders[1].paymentStatus, 'PENDING');
});
