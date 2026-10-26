const test = require('node:test');
const assert = require('node:assert/strict');
const { attachEarningsLedger } = require('../test-helpers/earningsLedgerFixture');
const { paymentFixture } = require('../test-helpers/paymentFixture');

function enableLedger(t) {
    const old = process.env.BOOSTER_MONTHLY_EARNINGS_ENABLED;
    process.env.BOOSTER_MONTHLY_EARNINGS_ENABLED = 'true';
    t.after(() => { if (old === undefined) delete process.env.BOOSTER_MONTHLY_EARNINGS_ENABLED; else process.env.BOOSTER_MONTHLY_EARNINGS_ENABLED = old; });
}

function enableEmails(t) {
    const previous = { BOOSTER_ORDER_EMAILS_ENABLED: process.env.BOOSTER_ORDER_EMAILS_ENABLED, CLIENT_URL: process.env.CLIENT_URL };
    process.env.BOOSTER_ORDER_EMAILS_ENABLED = 'true';
    process.env.CLIENT_URL = 'https://fastboost.example';
    t.after(() => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
}

const assignedBooster = boosterId => ({ boosterId, booster: { id: boosterId, role: 'PROVIDER', suspendedAt: null } });

function attachEmailOutbox(db, state) {
    state.emails = [];
    db.boosterOrderEmail = {
        updateMany: async ({ where, data }) => {
            const rows = state.emails.filter(row => Object.entries(where).every(([key, value]) => row[key] === value));
            rows.forEach(row => Object.assign(row, data)); return { count: rows.length };
        },
        createMany: async ({ data }) => {
            if (state.failEmail) throw new Error('Synthetic email queue failure');
            state.emails.push(...structuredClone(data).map(row => ({ sentAt: null, skippedAt: null, ...row })));
        },
    };
}

function fixture(t, { emails = false } = {}) {
    enableLedger(t);
    if (emails) enableEmails(t);
    const previousCompletion = process.env.ORDER_COMPLETION_EMAILS_ENABLED;
    process.env.ORDER_COMPLETION_EMAILS_ENABLED = 'false';
    const state = { order: { id: 'order', orderNumber: 'TEST-LEDGER', customerId: 'customer', status: 'IN_PROGRESS', paymentStatus: 'PAID',
        amountCents: 10000, goldDiscountCents: 0, currency: 'usd', boostType: 'Rank Boost', queueType: 'Solo/Duo', matchHistoryEnabled: false,
        assignments: [assignedBooster('booster')], contributions: [{ boosterId: 'booster', submittedMatches: 1, approvedMatches: 1 }],
        service: { title: 'Rank Boost' }, customer: { email: 'customer@example.test' }, trustpilotReviewSentAt: new Date() }, locks: [], audits: [] };
    const db = {
        user: { findUnique: async ({ where }) => ({ id: where.id, username: where.id === 'new-booster' ? 'New Booster' : 'Booster', role: 'PROVIDER', suspendedAt: null }), findMany: async () => [] },
        order: {
            findUnique: async ({ select } = {}) => {
                if (select?.assignments?.select?.booster) assert.match(state.locks.at(-1), /Order.*FOR UPDATE/, 'email snapshot follows the order lock');
                return structuredClone(state.order);
            },
            update: async ({ data }) => { Object.assign(state.order, data); return structuredClone(state.order); },
        },
        orderAssignment: {
            findFirst: async ({ where }) => state.order.assignments.some(row => row.boosterId === where.boosterId)
                ? { orderId: 'order', boosterId: where.boosterId, order: structuredClone(state.order), booster: { username: 'Synthetic' } } : null,
            upsert: async ({ create }) => {
                if (!state.order.assignments.some(row => row.boosterId === create.boosterId)) state.order.assignments.push(assignedBooster(create.boosterId));
                return create;
            },
            delete: async ({ where }) => { state.order.assignments = state.order.assignments.filter(row => row.boosterId !== where.orderId_boosterId.boosterId); },
            deleteMany: async ({ where }) => { state.order.assignments = state.order.assignments.filter(row => row.boosterId !== where.boosterId); },
            count: async () => state.order.assignments.length,
        },
        conversation: { upsert: async () => ({ id: 'chat' }), findUnique: async () => ({ id: 'chat' }) },
        conversationParticipant: { create: async () => ({}), findMany: async () => [], deleteMany: async () => ({}), upsert: async () => ({}) },
        notification: { create: async () => ({}), updateMany: async () => ({ count: 0 }) },
        assignmentRequest: {
            findUnique: async () => ({ id: 'invite', orderId: 'order', boosterId: 'new-booster', requestedBy: 'admin', status: 'PENDING',
                order: structuredClone(state.order), booster: { id: 'new-booster', role: 'PROVIDER', username: 'Synthetic' } }),
            update: async ({ data }) => ({ id: 'invite', ...data }),
        },
        managementAuditLog: { create: async ({ data }) => { state.audits.push(structuredClone(data)); return data; } },
        $queryRaw: async strings => { state.locks.push(strings.join('?')); return []; },
    };
    const ledger = attachEarningsLedger(db);
    attachEmailOutbox(db, state);
    db.$transaction = async callback => {
        const before = structuredClone({ order: state.order, emails: state.emails, entries: ledger.entries, balances: ledger.balances, audits: state.audits });
        try { return await callback(db); }
        catch (error) { state.order = before.order; state.emails = before.emails; ledger.entries = before.entries; ledger.balances = before.balances; state.audits = before.audits; throw error; }
    };
    const replacements = new Map([
        [require.resolve('../src/prisma'), db], [require.resolve('../src/utils/stripeClient'), {}],
        [require.resolve('../src/utils/loyaltyTierBonuses'), { syncLoyaltyTierBonuses: async () => ({}) }],
        [require.resolve('../src/utils/referralProgram'), { grantReferralCompletionRewards: async () => ({ granted: false }) }],
        [require.resolve('../src/utils/orderNotifications'), { notifyOrderStatus: async () => {} }],
        [require.resolve('../src/utils/trustpilotEmail'), { sendTrustpilotReviewInvite: async () => false }],
        [require.resolve('../src/utils/orderPasswordCrypto'), { stripEncryptedPasswordFields: row => ({ ...row }), hasEncryptedPasswordFields: () => false }],
    ]);
    const files = ['../src/controllers/orderController', '../src/controllers/assignmentRequestController'].map(require.resolve);
    const previous = new Map(files.map(file => [file, require.cache[file]]));
    for (const [file, exports] of replacements) { previous.set(file, require.cache[file]); require.cache[file] = { id: file, filename: file, loaded: true, exports }; }
    for (const file of files) delete require.cache[file];
    const controllers = files.map(require);
    t.mock.method(console, 'error', () => {});
    t.after(() => {
        for (const [file, value] of previous) { if (value) require.cache[file] = value; else delete require.cache[file]; }
        if (previousCompletion === undefined) delete process.env.ORDER_COMPLETION_EMAILS_ENABLED; else process.env.ORDER_COMPLETION_EMAILS_ENABLED = previousCompletion;
    });
    return { state, ledger, db, async invoke(method, options = {}) {
        const res = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
        const controller = controllers.find(value => value[method]);
        await controller[method]({ user: { id: options.actor || 'booster', role: 'ADMIN' },
            params: { id: 'order', boosterId: options.boosterId || 'new-booster', requestId: 'invite' }, body: { status: options.status || 'COMPLETED' } }, res);
        return res;
    } };
}

test('completion and cancellation create once-only entitlement deltas under ledger-before-checkout locks', async t => {
    const f = fixture(t);
    assert.equal((await f.invoke('updateOrderStatus')).code, 200);
    assert.deepEqual(f.ledger.entries.map(row => row.amountCents), [7000]);
    assert.match(f.state.locks[0], /pg_advisory_xact_lock/);
    const firstOrderLock = f.state.locks.findIndex(sql => /Order.*FOR UPDATE/.test(sql));
    assert.ok(firstOrderLock > 1, 'customer locks follow the ledger barrier and precede the order lock');
    assert.ok(f.state.locks.slice(1, firstOrderLock).every(sql => /User.*FOR UPDATE/.test(sql)));
    await f.invoke('providerCompleteAssignedOrder');
    assert.equal(f.ledger.entries.length, 1);
    assert.equal((await f.invoke('updateOrderStatus', { status: 'CANCELLED' })).code, 200);
    assert.deepEqual(f.ledger.entries.map(row => row.amountCents), [7000, -7000]);
    assert.equal(f.ledger.balances[0].amountCents, 0);
});

test('admin status responses retain promotion labels after commit and optional lookup failure cannot fail the status change', async t => {
    const f = fixture(t);
    Object.assign(f.state.order, { serviceId: 'rank-service', createdAt: new Date('2026-10-17T01:00:00Z'),
        basePrice: 100, addonPrice: 0, amountCents: 8500, totalPrice: 85 });
    let inTransaction = false;
    let failLookup = false;
    const transaction = f.db.$transaction;
    f.db.$transaction = async callback => {
        inTransaction = true;
        try { return await transaction(callback); } finally { inTransaction = false; }
    };
    f.db.serviceSale = { findMany: async () => {
        assert.equal(inTransaction, false, 'display metadata is loaded only after mutation commits');
        if (failLookup) throw new Error('Synthetic optional campaign read failure');
        return [{ title: 'Summer sale', discountPercent: '15', appliesTo: 'BASE_PRICE', active: true,
            scope: 'GLOBAL', serviceId: null, createdAt: new Date('2026-10-16'), updatedAt: new Date('2026-10-16'),
            startsAt: new Date('2026-10-16'), endsAt: new Date('2026-10-18') }];
    } };
    for (const status of ['COMPLETED', 'CANCELLED']) {
        const result = await f.invoke('updateOrderStatus', { status });
        assert.equal(result.code, 200);
        assert.equal(result.body.order.status, status);
        assert.deepEqual(result.body.order.priceSummary.adminBreakdown.promotion,
            { title: 'Summer sale', discountPercent: 15, source: 'historical_match' });
        assert.equal(result.body.order.priceSummary.totalCents, 8500);
    }
    failLookup = true;
    const result = await f.invoke('updateOrderStatus', { status: 'COMPLETED' });
    assert.equal(result.code, 200);
    assert.equal(result.body.order.status, 'COMPLETED');
    assert.equal(f.state.order.status, 'COMPLETED');
    assert.equal(result.body.order.priceSummary.adminBreakdown.promotion, null);
    assert.equal(result.body.order.priceSummary.adminBreakdown.promotionCents, 1500);
    assert.equal(result.body.order.priceSummary.totalCents, 8500);
});

test('assignment, invitation, leave, completion and cancellation hooks queue only the affected booster transitions', async t => {
    const f = fixture(t, { emails: true });
    for (const method of ['assignBooster', 'assignBooster', 'unassignBooster', 'unassignBooster']) assert.equal((await f.invoke(method)).code, 200);
    assert.deepEqual(f.state.emails.map(row => [row.boosterId, row.event]), [['new-booster', 'ASSIGNED'], ['new-booster', 'UNASSIGNED']]);
    assert.equal((await f.invoke('acceptAssignmentRequest', { actor: 'new-booster' })).code, 200);
    assert.equal((await f.invoke('providerLeaveAssignedOrder', { actor: 'new-booster' })).code, 200);
    assert.equal((await f.invoke('providerCompleteAssignedOrder')).code, 200);
    assert.equal((await f.invoke('updateOrderStatus')).code, 200);
    assert.equal((await f.invoke('updateOrderStatus', { status: 'CANCELLED' })).code, 200);
    assert.deepEqual(f.state.emails.map(row => [row.boosterId, row.event]), [
        ['new-booster', 'ASSIGNED'], ['new-booster', 'UNASSIGNED'], ['new-booster', 'ASSIGNED'], ['new-booster', 'UNASSIGNED'],
        ['booster', 'COMPLETED'], ['booster', 'CANCELLED'],
    ]);
    assert.deepEqual(f.state.audits.map(row => [row.action, row.actorName]), [
        ['assignment.accept', 'New Booster'], ['order.leave', 'New Booster'], ['order.complete', 'Booster'],
    ]);
    assert.ok(f.state.emails[0].skippedAt, 'an older assignment email cannot revive after reassignment');
});

test('email outbox failure rolls back completion and ledger, then a retry commits both once', async t => {
    const f = fixture(t, { emails: true }); f.state.failEmail = true;
    assert.equal((await f.invoke('updateOrderStatus')).code, 500);
    assert.equal(f.state.order.status, 'IN_PROGRESS');
    assert.equal(f.state.emails.length, 0); assert.equal(f.ledger.entries.length, 0);
    f.state.failEmail = false;
    assert.equal((await f.invoke('updateOrderStatus')).code, 200);
    assert.equal((await f.invoke('updateOrderStatus')).code, 200);
    assert.equal(f.state.emails.length, 1); assert.equal(f.ledger.entries.length, 1);
});

test('Stripe and Gold settlement hooks notify existing assigned boosters once and keep retries idempotent', async t => {
    enableEmails(t);
    const f = paymentFixture(t, { initialGold: 300, orders: [
        { id: 'card', stripeCheckoutSessionId: 'cs_test_paid', assignments: [assignedBooster('card-booster')] },
        { id: 'gold', assignments: [assignedBooster('gold-booster')] },
    ] });
    attachEmailOutbox(f.db, f.state);
    const session = f.paidSession('card', { customer_email: 'customer@example.test' });
    await Promise.all([f.webhook('checkout.session.completed', session), f.webhook('checkout.session.completed', session)]);
    assert.deepEqual(f.state.emails.map(row => [row.boosterId, row.event]), [['card-booster', 'PAYMENT_CONFIRMED']]);
    assert.equal((await f.checkout('gold', { goldToUse: 200, contactEmail: 'customer@example.test' })).code, 200);
    assert.equal((await f.checkout('gold', { goldToUse: 200, contactEmail: 'customer@example.test' })).code, 200);
    assert.deepEqual(f.state.emails.map(row => [row.boosterId, row.event]), [['card-booster', 'PAYMENT_CONFIRMED'], ['gold-booster', 'PAYMENT_CONFIRMED']]);
});

test('ledger failure rolls back completion instead of losing the corresponding monthly recognition', async t => {
    const f = fixture(t); f.ledger.failEntry = true;
    assert.equal((await f.invoke('providerCompleteAssignedOrder')).code, 500);
    assert.equal(f.state.order.status, 'IN_PROGRESS');
    assert.equal(f.ledger.entries.length, 0);
    f.ledger.failEntry = false;
    assert.equal((await f.invoke('providerCompleteAssignedOrder')).code, 200);
    assert.deepEqual(f.ledger.entries.map(row => row.amountCents), [7000]);
});

test('assignment corrections and leaving preserve completed status, while stale invitations cannot reopen it', async t => {
    const f = fixture(t);
    await f.invoke('updateOrderStatus');
    assert.equal((await f.invoke('assignBooster')).code, 200);
    assert.deepEqual(f.ledger.entries.map(row => row.amountCents), [7000, -7000], 'an unreviewed additional booster suspends the confirmed allocation');
    await f.invoke('assignBooster');
    assert.equal(f.ledger.entries.length, 2, 'duplicate assignment does not duplicate deltas');
    assert.equal((await f.invoke('unassignBooster')).code, 200);
    assert.deepEqual(f.ledger.entries.map(row => row.amountCents), [7000, -7000, 7000]);
    assert.equal((await f.invoke('providerLeaveAssignedOrder')).code, 200);
    assert.equal(f.state.order.status, 'COMPLETED');
    assert.deepEqual(f.ledger.entries.map(row => row.amountCents), [7000, -7000, 7000]);
    f.state.order.assignments = [{ boosterId: 'booster' }];
    await f.invoke('updateOrderStatus');
    assert.equal((await f.invoke('acceptAssignmentRequest', { actor: 'new-booster' })).code, 409);
    assert.equal(f.state.order.status, 'COMPLETED');
    assert.deepEqual(f.ledger.entries.map(row => row.amountCents), [7000, -7000, 7000]);
});

test('settling a completed order recognizes paid earnings once and ignores replayed webhooks', async t => {
    enableLedger(t);
    const f = paymentFixture(t, { orders: [{ id: 'order', status: 'COMPLETED', stripeCheckoutSessionId: 'cs_test_paid',
        boostType: 'Rank Boost', matchHistoryEnabled: false, assignments: [{ boosterId: 'booster' }],
        contributions: [{ boosterId: 'booster', submittedMatches: 1, approvedMatches: 1 }] }] });
    const ledger = attachEarningsLedger(f.db);
    const session = f.paidSession('order', { customer_email: 'customer@example.test' });
    assert.equal((await f.webhook('checkout.session.completed', session)).code, 200);
    assert.deepEqual(ledger.entries.map(row => row.amountCents), [1400]);
    await f.webhook('checkout.session.completed', session);
    assert.equal(ledger.entries.length, 1);
});
