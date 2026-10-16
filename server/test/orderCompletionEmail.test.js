const test = require('node:test');
const assert = require('node:assert/strict');
const { buildCompletion, queueOrderCompletion, deliverPendingCompletions } = require('../src/utils/orderCompletionEmail');

const order = { id: 'synthetic/order', orderNumber: 'LOL-TEST-123', customerId: 'customer', status: 'COMPLETED', paymentStatus: 'PAID',
    boostType: 'Rank Boost', currentRank: 'Silver I', desiredRank: 'Gold IV', region: 'North America', queueType: 'Solo/Duo',
    customer: { email: 'customer@example.test' } };

function configure(t) {
    const keys = ['CLIENT_URL', 'ORDER_COMPLETION_EMAILS_ENABLED', 'NODE_ENV'];
    const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
    process.env.CLIENT_URL = 'https://fastboost.example';
    process.env.ORDER_COMPLETION_EMAILS_ENABLED = 'true';
    t.after(() => { for (const key of keys) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; } });
}

test('completion email has a safe internal rating link, service details, and paid-completed eligibility', t => {
    configure(t);
    const mail = buildCompletion({ ...order, region: '<script>unsafe</script>' });
    assert.equal(mail.to, order.customer.email);
    assert.equal(mail.subject, 'FastBoost order #LOL-TEST-123 completed');
    assert.match(mail.text, /https:\/\/fastboost.example\/match\/synthetic%2Forder#order-rating/);
    assert.match(mail.html, /href="https:\/\/fastboost.example\/match\/synthetic%2Forder#order-rating"/);
    assert.match(mail.html, /Rate your booster/);
    assert.match(mail.text, /Target Rank: Gold IV/);
    assert.doesNotMatch(mail.html, /<script>|accountPassword/);
    assert.match(mail.html, /&lt;script&gt;/);
    assert.doesNotMatch(mail.text, /Payment confirmed|Trustpilot|Amount paid/);
    for (const invalid of [{ status: 'IN_PROGRESS' }, { status: 'CANCELLED' }, { paymentStatus: 'PENDING' },
        { customer: { email: 'customer@example.test\r\nBcc: other@example.test' } }]) {
        assert.throws(() => buildCompletion({ ...order, ...invalid }));
    }
    process.env.NODE_ENV = 'production';
    for (const origin of ['http://fastboost.example', 'http://localhost:5173', 'https://localhost']) {
        process.env.CLIENT_URL = origin;
        assert.throws(() => buildCompletion(order));
    }
});

test('queue is opt-in, ignores ineligible orders, and keeps one immutable payload per order', async t => {
    configure(t);
    const rows = new Map();
    const transaction = { orderCompletionEmail: { upsert: async ({ where, create, update }) => {
        assert.deepEqual(update, {});
        if (!rows.has(where.orderId)) rows.set(where.orderId, create);
    } } };
    process.env.ORDER_COMPLETION_EMAILS_ENABLED = 'false';
    await queueOrderCompletion({}, order);
    process.env.ORDER_COMPLETION_EMAILS_ENABLED = 'true';
    await queueOrderCompletion({}, { ...order, paymentStatus: 'PENDING' });
    await queueOrderCompletion({}, { ...order, status: 'IN_PROGRESS' });
    assert.equal(rows.size, 0);
    await queueOrderCompletion(transaction, order);
    await queueOrderCompletion(transaction, { ...order, customer: { email: 'changed@example.test' } });
    assert.equal(rows.size, 1);
    assert.equal(rows.get(order.id).payload.to, order.customer.email);
});

function deliveryFixture() {
    const now = new Date('2026-10-16T12:00:00Z');
    const row = { orderId: order.id, payload: buildCompletion(order), attempts: 0, nextAttemptAt: now, sentAt: null, claim: null };
    const current = structuredClone(order);
    const state = { beforeFresh: null, writes: 0 };
    const eligible = () => current.status === 'COMPLETED' && current.paymentStatus === 'PAID';
    const db = { orderCompletionEmail: {
        findMany: async ({ where, take }) => {
            assert.deepEqual(where.order, { status: 'COMPLETED', paymentStatus: 'PAID' });
            assert.equal(take, 10);
            return !row.sentAt && row.attempts < where.attempts.lt && row.nextAttemptAt <= where.nextAttemptAt.lte && eligible() ? [structuredClone(row)] : [];
        },
        findUnique: async () => {
            state.beforeFresh?.();
            return { ...structuredClone(row), order: structuredClone(current) };
        },
        updateMany: async ({ where, data }) => {
            if (row.sentAt || (where.claim && where.claim !== row.claim) || (where.attempts !== undefined && row.attempts !== where.attempts) ||
                (where.nextAttemptAt && row.nextAttemptAt > where.nextAttemptAt.lte) || (where.order && !eligible())) return { count: 0 };
            const attempts = data.attempts ? row.attempts + (data.attempts.increment || 0) - (data.attempts.decrement || 0) : row.attempts;
            Object.assign(row, data, { attempts }); state.writes++;
            return { count: 1 };
        },
    } };
    return { now, row, current, state, db };
}

test('completion retries are bounded and concurrent workers claim only one send to the current address', async t => {
    configure(t);
    const f = deliveryFixture();
    const previousError = console.error; console.error = () => {}; t.after(() => { console.error = previousError; });
    await deliverPendingCompletions(f.db, { sendMail: async () => { throw Object.assign(new Error('private SMTP detail'), { code: 'ETIMEDOUT' }); } }, () => f.now);
    assert.equal(f.row.attempts, 1);
    assert.equal(f.row.sentAt, null);
    assert.equal(f.row.lastError, 'ETIMEDOUT');
    assert.ok(f.row.nextAttemptAt > f.now);
    let sent = 0;
    f.current.customer.email = 'current@example.test';
    const transport = { sendMail: async mail => {
        sent++;
        assert.deepEqual(mail.to, { address: 'current@example.test' });
        assert.equal(mail.disableFileAccess, true); assert.equal(mail.disableUrlAccess, true);
        assert.match(mail.messageId, /^<fastboost-completed-/);
        return { accepted: ['current@example.test'] };
    } };
    await deliverPendingCompletions(f.db, transport, () => f.now);
    assert.equal(sent, 0, 'retry does not run before backoff');
    const due = f.row.nextAttemptAt;
    await Promise.all([deliverPendingCompletions(f.db, transport, () => due), deliverPendingCompletions(f.db, transport, () => due)]);
    assert.equal(sent, 1);
    assert.ok(f.row.sentAt);
    assert.equal(f.row.claim, null);
    await deliverPendingCompletions(f.db, transport, () => new Date(due.getTime() + 600000));
    assert.equal(sent, 1, 'sent orders are not delivered again');
    f.row.sentAt = null; f.row.attempts = 8;
    await deliverPendingCompletions(f.db, transport, () => new Date(due.getTime() + 600000));
    assert.equal(sent, 1, 'retry limit stops further SMTP attempts');
});

test('worker skips cancelled/unpaid orders and rechecks eligibility after its claim', async t => {
    configure(t);
    const f = deliveryFixture();
    let sent = 0;
    const transport = { sendMail: async () => { sent++; return { accepted: [order.customer.email] }; } };
    f.current.status = 'CANCELLED';
    await deliverPendingCompletions(f.db, transport, () => f.now);
    f.current.status = 'COMPLETED'; f.current.paymentStatus = 'PENDING';
    await deliverPendingCompletions(f.db, transport, () => f.now);
    assert.equal(f.state.writes, 0);
    f.current.paymentStatus = 'PAID';
    f.state.beforeFresh = () => { f.current.status = 'IN_PROGRESS'; };
    await deliverPendingCompletions(f.db, transport, () => f.now);
    assert.equal(sent, 0);
    assert.equal(f.row.sentAt, null);
    assert.equal(f.row.claim, null);
    assert.equal(f.row.attempts, 0, 'a status race does not consume a delivery attempt');
});

test('SMTP must accept the intended recipient before a completion is marked sent', async t => {
    configure(t);
    const f = deliveryFixture();
    const previousError = console.error; console.error = () => {}; t.after(() => { console.error = previousError; });
    await deliverPendingCompletions(f.db, { sendMail: async () => ({ accepted: ['someone-else@example.test'] }) }, () => f.now);
    assert.equal(f.row.sentAt, null);
    assert.equal(f.row.lastError, 'DELIVERY_FAILED');
});

test('each row receives a fresh claim lease and failures back off from their actual failure time', async t => {
    configure(t);
    let time = new Date('2026-10-16T12:00:00Z');
    const clock = () => new Date(time);
    const rows = ['first', 'second'].map(orderId => ({ orderId, payload: buildCompletion({ ...order, id: orderId }),
        attempts: 0, sentAt: null, claim: null, nextAttemptAt: clock() }));
    const db = { orderCompletionEmail: {
        findMany: async ({ where }) => structuredClone(rows.filter(row => !row.sentAt && row.attempts < where.attempts.lt && row.nextAttemptAt <= where.nextAttemptAt.lte)),
        findUnique: async ({ where }) => ({ ...structuredClone(rows.find(row => row.orderId === where.orderId)), order: structuredClone(order) }),
        updateMany: async ({ where, data }) => {
            const row = rows.find(row => row.orderId === where.orderId);
            if (row.sentAt || (where.claim && row.claim !== where.claim) || (where.attempts !== undefined && row.attempts !== where.attempts) ||
                (where.nextAttemptAt && row.nextAttemptAt > where.nextAttemptAt.lte)) return { count: 0 };
            const attempts = row.attempts + (data.attempts?.increment || 0);
            Object.assign(row, data, { attempts }); return { count: 1 };
        },
    } };
    let calls = 0, duplicateCalls = 0;
    const previousError = console.error; console.error = () => {}; t.after(() => { console.error = previousError; });
    await deliverPendingCompletions(db, { sendMail: async () => {
        calls++;
        if (calls === 1) {
            time = new Date(time.getTime() + 6 * 60000);
            return { accepted: [order.customer.email] };
        }
        assert.equal(rows[1].nextAttemptAt.getTime(), time.getTime() + 5 * 60000);
        await deliverPendingCompletions(db, { sendMail: async () => { duplicateCalls++; return { accepted: [order.customer.email] }; } }, clock);
        time = new Date(time.getTime() + 60000);
        throw Object.assign(new Error('synthetic failure'), { code: 'ETIMEDOUT' });
    } }, clock);
    assert.equal(calls, 2);
    assert.equal(duplicateCalls, 0, 'a later batch row cannot be reclaimed using an expired batch-start lease');
    assert.equal(rows[1].nextAttemptAt.getTime(), time.getTime() + 2 * 60000, 'backoff starts when SMTP fails');
});
