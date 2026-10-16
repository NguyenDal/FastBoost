const test = require('node:test');
const assert = require('node:assert/strict');
const { buildBoosterOrderEmail, boosterOrderEvents, withBoosterOrderEmails, deliverPendingBoosterOrderEmails, startBoosterOrderEmailWorker } = require('../src/utils/boosterOrderEmail');

const booster = id => ({ boosterId: id, booster: { id, role: 'PROVIDER', hasBoosterAccess: false, suspendedAt: null } });
const order = { id: 'synthetic/order', orderNumber: 'LOL-RNK-PREVIEW', status: 'IN_PROGRESS', paymentStatus: 'PAID', boostType: 'Rank Boost',
    currentRank: 'Silver', currentDivision: 'I', desiredRank: 'Gold', desiredDivision: 'IV', queueType: 'Solo/Duo', region: 'North America', assignments: [booster('a'), booster('b')] };

function configure(t) {
    const keys = ['CLIENT_URL', 'BOOSTER_ORDER_EMAILS_ENABLED', 'NODE_ENV'];
    const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
    process.env.CLIENT_URL = 'https://fastboost.example';
    process.env.BOOSTER_ORDER_EMAILS_ENABLED = 'true';
    t.after(() => { for (const key of keys) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; } });
}

test('five booster templates provide safe relevant links without customer, credential or payment secrets', t => {
    configure(t);
    for (const event of ['ASSIGNED', 'UNASSIGNED', 'COMPLETED', 'CANCELLED', 'PAYMENT_CONFIRMED']) {
        const mail = buildBoosterOrderEmail({ ...order, region: '<script>bad</script>', customer: { email: 'private@example.test' }, accountPassword: 'SECRET-PASSWORD', stripePaymentIntentId: 'pi_SECRET', accountUsername: 'SECRET-ACCOUNT' }, event);
        assert.match(mail.subject, /FastBoost.*LOL-RNK-PREVIEW/);
        assert.match(mail.text, /League of Legends/);
        assert.match(mail.text, /Rank Boost/);
        assert.equal(mail.to, undefined, 'recipient is resolved only at delivery');
        assert.doesNotMatch(JSON.stringify(mail), /private@example|SECRET|stripePaymentIntentId|accountPassword/);
        assert.doesNotMatch(mail.html, /<script>/);
        if (event === 'UNASSIGNED') {
            assert.match(mail.text, /View assigned orders: https:\/\/fastboost.example\/provider\/portal/);
            assert.doesNotMatch(mail.text + mail.html, /\/match\//);
        } else {
            assert.match(mail.html, /href="https:\/\/fastboost.example\/match\/synthetic%2Forder"/);
            assert.match(mail.html, /&lt;script&gt;/);
        }
    }
    assert.throws(() => buildBoosterOrderEmail(order, '__proto__'));
    process.env.NODE_ENV = 'production';
    for (const origin of ['http://fastboost.example', 'https://localhost', 'http://localhost:5173', 'javascript:alert(1)']) {
        process.env.CLIENT_URL = origin;
        assert.throws(() => buildBoosterOrderEmail(order, 'ASSIGNED'));
    }
});

test('only actual assignment/status/payment transitions select directly affected eligible boosters', () => {
    assert.deepEqual(boosterOrderEvents(order, structuredClone(order)), []);
    assert.deepEqual(boosterOrderEvents({ ...order, assignments: [booster('a')] }, { ...order, assignments: [booster('b'), booster('b')] }), [
        { boosterId: 'b', event: 'ASSIGNED' }, { boosterId: 'a', event: 'UNASSIGNED' },
    ]);
    for (const [status, event] of [['COMPLETED', 'COMPLETED'], ['CANCELLED', 'CANCELLED']]) {
        assert.deepEqual(boosterOrderEvents(order, { ...order, status }), [{ boosterId: 'a', event }, { boosterId: 'b', event }]);
        assert.deepEqual(boosterOrderEvents({ ...order, status }, { ...order, status }), []);
    }
    assert.deepEqual(boosterOrderEvents({ ...order, paymentStatus: 'PENDING', assignments: [booster('a')] }, order), [
        { boosterId: 'b', event: 'ASSIGNED' }, { boosterId: 'a', event: 'PAYMENT_CONFIRMED' },
    ]);
    assert.deepEqual(boosterOrderEvents({ ...order, paymentStatus: 'PENDING', assignments: [] }, { ...order, assignments: [] }), [], 'no broadcast to unassigned boosters on payment');
    const inactive = [{ boosterId: 'suspended', booster: { role: 'PROVIDER', suspendedAt: new Date() } }, { boosterId: 'customer', booster: { role: 'CUSTOMER' } }, { boosterId: 'admin', booster: { role: 'ADMIN' } }];
    assert.deepEqual(boosterOrderEvents({ ...order, assignments: [] }, { ...order, assignments: inactive }), []);
    assert.deepEqual(boosterOrderEvents({ ...order, assignments: [] }, { ...order, assignments: [{ boosterId: 'admin', booster: { role: 'ADMIN', hasBoosterAccess: true } }] }), [{ boosterId: 'admin', event: 'ASSIGNED' }]);
});

function mutationFixture() {
    const state = { order: { ...structuredClone(order), assignments: [] }, rows: [], reads: 0, failQueue: false };
    const tx = {
        order: { findUnique: async ({ select }) => {
            state.reads++;
            assert.equal(select.customer, undefined); assert.equal(select.accountPassword, undefined);
            return structuredClone(state.order);
        } },
        boosterOrderEmail: { updateMany: async ({ where, data }) => {
            const rows = state.rows.filter(row => row.orderId === where.orderId && row.boosterId === where.boosterId && row.event === where.event && row.sentAt === null && row.skippedAt === null);
            for (const row of rows) Object.assign(row, data);
            return { count: rows.length };
        }, createMany: async ({ data }) => {
            if (state.failQueue) throw new Error('Simulated queue failure');
            state.rows.push(...structuredClone(data).map(row => ({ sentAt: null, skippedAt: null, ...row })));
        } },
    };
    let lock = Promise.resolve();
    const transaction = mutation => {
        const pending = lock.then(async () => {
            const before = structuredClone(state);
            try { return await withBoosterOrderEmails(tx, order.id, mutation); }
            catch (error) { Object.assign(state, before); throw error; }
        });
        lock = pending.catch(() => {}); return pending;
    };
    return { state, tx, transaction };
}

test('locked snapshots enqueue once on retries/nested calls, with a fresh event for a later reassignment', async t => {
    configure(t);
    const f = mutationFixture();
    await Promise.all([1, 2].map(() => f.transaction(async () => { f.state.order.assignments = [booster('a')]; return 'updated'; })));
    assert.equal(f.state.rows.length, 1);
    assert.equal(f.state.rows[0].event, 'ASSIGNED');
    assert.match(f.state.rows[0].id, /^[a-f\d-]{36}$/);
    const nestedResult = await f.transaction(() => withBoosterOrderEmails(f.tx, order.id, async () => { f.state.order.assignments = []; return 42; }));
    assert.equal(nestedResult, 42);
    assert.deepEqual(f.state.rows.map(row => row.event), ['ASSIGNED', 'UNASSIGNED']);
    await f.transaction(async () => { f.state.order.assignments = [booster('a')]; });
    assert.deepEqual(f.state.rows.map(row => row.event), ['ASSIGNED', 'UNASSIGNED', 'ASSIGNED']);
    assert.equal(new Set(f.state.rows.map(row => row.id)).size, 3);
    assert.ok(f.state.rows[0].skippedAt, 'a repeated assignment supersedes its older pending episode');
    assert.equal(f.state.rows[2].skippedAt, null);
    process.env.BOOSTER_ORDER_EMAILS_ENABLED = 'false';
    const reads = f.state.reads;
    assert.equal(await withBoosterOrderEmails({}, order.id, async () => 'no-email'), 'no-email');
    assert.equal(f.state.reads, reads);
    assert.equal(startBoosterOrderEmailWorker({}), undefined);
});

test('outbox failures roll back the order mutation and retry queues the event once', async t => {
    configure(t);
    const f = mutationFixture();
    f.state.failQueue = true;
    await assert.rejects(f.transaction(async () => { f.state.order.assignments = [booster('a')]; }), /queue failure/);
    assert.deepEqual(f.state.order.assignments, []);
    assert.equal(f.state.rows.length, 0);
    f.state.failQueue = false;
    await f.transaction(async () => { f.state.order.assignments = [booster('a')]; });
    assert.equal(f.state.rows.length, 1);
});

function deliveryFixture(event = 'ASSIGNED') {
    const now = new Date('2026-10-16T12:00:00Z');
    const row = { id: 'event-uuid', orderId: order.id, boosterId: 'a', event, payload: buildBoosterOrderEmail(order, event), attempts: 0, nextAttemptAt: now, sentAt: null, skippedAt: null, claim: null };
    const current = { order: structuredClone(order), booster: { role: 'PROVIDER', email: 'current@example.test', suspendedAt: null } };
    const state = { beforeFresh: null };
    const matches = where => !row.sentAt && !row.skippedAt && (!where.claim || where.claim === row.claim) &&
        (where.attempts === undefined || where.attempts === row.attempts) && (!where.nextAttemptAt || row.nextAttemptAt <= where.nextAttemptAt.lte);
    const db = { boosterOrderEmail: {
        findMany: async ({ where, take }) => { assert.equal(take, 10); return !row.sentAt && !row.skippedAt && row.attempts < where.attempts.lt && row.nextAttemptAt <= where.nextAttemptAt.lte ? [structuredClone(row)] : []; },
        findUnique: async () => { state.beforeFresh?.(); return { ...structuredClone(row), ...structuredClone(current) }; },
        updateMany: async ({ where, data }) => {
            if (!matches(where)) return { count: 0 };
            const attempts = row.attempts + (data.attempts?.increment || 0);
            Object.assign(row, data, { attempts }); return { count: 1 };
        },
    } };
    return { now, row, current, state, db };
}

test('delivery uses current booster email, stable message IDs, bounded retry and concurrent claims', async t => {
    configure(t); t.mock.method(console, 'error', () => {});
    const f = deliveryFixture();
    let sent = 0;
    const messageIds = [];
    const failedTransport = { sendMail: async mail => {
        messageIds.push(mail.messageId);
        throw Object.assign(new Error('private SMTP message'), { code: 'ETIMEDOUT' });
    } };
    await deliverPendingBoosterOrderEmails(f.db, failedTransport, () => f.now);
    assert.equal(f.row.attempts, 1); assert.equal(f.row.sentAt, null); assert.equal(f.row.lastError, 'ETIMEDOUT');
    assert.ok(f.row.nextAttemptAt > f.now);
    f.current.booster.email = 'changed@example.test';
    const transport = { sendMail: async mail => {
        sent++; messageIds.push(mail.messageId);
        assert.deepEqual(mail.to, { address: 'changed@example.test' });
        assert.equal(mail.disableFileAccess, true); assert.equal(mail.disableUrlAccess, true);
        return { accepted: ['changed@example.test'] };
    } };
    await deliverPendingBoosterOrderEmails(f.db, transport, () => f.now);
    assert.equal(sent, 0);
    const due = f.row.nextAttemptAt;
    await Promise.all([deliverPendingBoosterOrderEmails(f.db, transport, () => due), deliverPendingBoosterOrderEmails(f.db, transport, () => due)]);
    assert.equal(sent, 1); assert.ok(f.row.sentAt); assert.equal(f.row.claim, null);
    assert.equal(new Set(messageIds).size, 1);
    await deliverPendingBoosterOrderEmails(f.db, transport, () => new Date(due.getTime() + 600000));
    assert.equal(sent, 1);
    f.row.sentAt = null; f.row.attempts = 8;
    await deliverPendingBoosterOrderEmails(f.db, transport, () => new Date(due.getTime() + 600000));
    assert.equal(sent, 1);
});

test('superseded events and revoked booster access are skipped after a fresh eligibility check', async t => {
    configure(t);
    for (const [event, mutate] of [
        ['ASSIGNED', f => { f.current.order.assignments = []; }],
        ['ASSIGNED', f => { f.current.order.status = 'COMPLETED'; }],
        ['COMPLETED', f => { f.current.order.status = 'CANCELLED'; }],
        ['CANCELLED', f => { f.current.order.status = 'IN_PROGRESS'; }],
        ['PAYMENT_CONFIRMED', f => { f.current.order.paymentStatus = 'PENDING'; }],
        ['UNASSIGNED', () => {}],
        ['ASSIGNED', f => { f.current.booster.suspendedAt = new Date(); }],
        ['ASSIGNED', f => { f.current.booster.role = 'CUSTOMER'; }],
    ]) {
        const f = deliveryFixture(event);
        f.state.beforeFresh = () => mutate(f);
        await deliverPendingBoosterOrderEmails(f.db, { sendMail: async () => assert.fail('ineligible alert must not be sent') }, () => f.now);
        assert.ok(f.row.skippedAt, event); assert.equal(f.row.claim, null); assert.equal(f.row.sentAt, null);
        assert.equal(f.row.lastError, 'EVENT_SUPERSEDED');
    }
});

test('unassignment alerts send without order access; all event types deliver when still relevant', async t => {
    configure(t);
    for (const event of ['ASSIGNED', 'UNASSIGNED', 'COMPLETED', 'CANCELLED', 'PAYMENT_CONFIRMED']) {
        const f = deliveryFixture(event);
        if (event === 'UNASSIGNED') f.current.order.assignments = [];
        if (event === 'COMPLETED') f.current.order.status = 'COMPLETED';
        if (event === 'CANCELLED') f.current.order.status = 'CANCELLED';
        let sent = 0;
        await deliverPendingBoosterOrderEmails(f.db, { sendMail: async () => { sent++; return { accepted: ['current@example.test'] }; } }, () => f.now);
        assert.equal(sent, 1, event); assert.ok(f.row.sentAt); assert.equal(f.row.skippedAt, null);
    }
});

test('invalid addresses and accepting a different recipient never mark a booster alert sent', async t => {
    configure(t); t.mock.method(console, 'error', () => {});
    const invalid = deliveryFixture(); invalid.current.booster.email = 'bad@example.test\r\nBcc: other@example.test';
    await deliverPendingBoosterOrderEmails(invalid.db, { sendMail: async () => assert.fail('invalid recipient must not reach SMTP') }, () => invalid.now);
    assert.equal(invalid.row.sentAt, null); assert.equal(invalid.row.lastError, 'DELIVERY_FAILED');
    const rejected = deliveryFixture();
    await deliverPendingBoosterOrderEmails(rejected.db, { sendMail: async () => ({ accepted: ['other@example.test'] }) }, () => rejected.now);
    assert.equal(rejected.row.sentAt, null); assert.equal(rejected.row.lastError, 'DELIVERY_FAILED');
});
