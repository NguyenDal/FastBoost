const test = require('node:test');
const assert = require('node:assert/strict');
const { enabled, buildAdminOrderEmail, queueAdminOrderEmail, deliverPendingAdminOrderEmails,
    startAdminOrderEmailWorker, wakeAdminOrderEmailWorker } = require('../src/utils/adminOrderEmail');

const order = { id: 'synthetic/order', orderNumber: 'LOL-RNK-PREVIEW', status: 'PENDING', paymentStatus: 'PAID',
    boostType: 'Rank Boost', currentRank: 'Silver I', desiredRank: 'Gold IV', queueType: 'Solo/Duo', region: 'North America',
    amountCents: 2500, goldDiscountCents: 500, cashAmountCents: 2000, currency: 'usd' };

function configure(t) {
    const keys = ['CLIENT_URL', 'ADMIN_ORDER_EMAILS_ENABLED', 'BOOSTER_ORDER_EMAILS_ENABLED', 'NODE_ENV'];
    const before = Object.fromEntries(keys.map(key => [key, process.env[key]]));
    process.env.CLIENT_URL = 'https://fastboost.example'; process.env.ADMIN_ORDER_EMAILS_ENABLED = 'true';
    t.after(() => { for (const key of keys) {
        if (before[key] === undefined) delete process.env[key]; else process.env[key] = before[key];
    } });
}

test('admin order email inherits team-email configuration, with an explicit independent override', t => {
    configure(t);
    delete process.env.ADMIN_ORDER_EMAILS_ENABLED; delete process.env.BOOSTER_ORDER_EMAILS_ENABLED;
    assert.equal(enabled(), false);
    process.env.BOOSTER_ORDER_EMAILS_ENABLED = 'true'; assert.equal(enabled(), true);
    process.env.ADMIN_ORDER_EMAILS_ENABLED = 'false'; assert.equal(enabled(), false);
    process.env.ADMIN_ORDER_EMAILS_ENABLED = 'true'; delete process.env.BOOSTER_ORDER_EMAILS_ENABLED;
    assert.equal(enabled(), true);
});

test('admin template shares order details and branding, with a private management link and no secrets', t => {
    configure(t);
    const mail = buildAdminOrderEmail({ ...order, region: '<script>bad</script>',
        customer: { email: 'private@example.test' }, accountPassword: 'SECRET-PASSWORD',
        accountUsername: 'SECRET-ACCOUNT', stripePaymentIntentId: 'pi_SECRET' });
    assert.match(mail.subject, /FastBoost.*New order placed.*LOL-RNK-PREVIEW/);
    assert.match(mail.text, /Current Rank: Silver I/); assert.match(mail.text, /Target Rank: Gold IV/);
    assert.match(mail.text, /Queue Type: Solo\/Duo/); assert.match(mail.text, /Payment: Paid/);
    assert.match(mail.text, /Total: \$20\.00/); assert.match(mail.text, /Booster pool \(70% of total\): \$14\.00/);
    assert.match(mail.html, /ADMIN ORDER UPDATE/);
    assert.match(mail.html, /href="https:\/\/fastboost.example\/admin\/orders\/synthetic%2Forder"/);
    assert.doesNotMatch(mail.html, /<script>/); assert.match(mail.html, /&lt;script&gt;/);
    assert.doesNotMatch(JSON.stringify(mail), /private@example|SECRET|accountPassword|stripePaymentIntentId/);
    assert.equal(mail.to, undefined); assert.equal((mail.html.match(/<a\b/gi) || []).length, 1);
    assert.throws(() => buildAdminOrderEmail({ ...order, paymentStatus: 'PENDING' }));
    assert.throws(() => buildAdminOrderEmail({ ...order, status: 'CANCELLED' }));
    process.env.NODE_ENV = 'production';
    for (const invalid of ['http://fastboost.example', 'http://localhost:5173', 'javascript:alert(1)']) {
        process.env.CLIENT_URL = invalid; assert.throws(() => buildAdminOrderEmail(order));
    }
});

test('placement queues an immutable message for every active admin, with database duplicate protection', async t => {
    configure(t);
    const { Prisma } = require('../src/generated/prisma/client');
    const fields = Prisma.dmmf.datamodel.models.find(model => model.name === 'Order').fields.map(field => field.name);
    let snapshot = { ...order }, queries = 0, batches = [];
    const tx = { order: { findUnique: async ({ select }) => {
        assert.ok(Object.keys(select).every(name => fields.includes(name)), 'no invalid fields can break paid checkout');
        for (const forbidden of ['customer', 'accountPassword', 'accountUsername', 'stripePaymentIntentId']) assert.equal(select[forbidden], undefined);
        return snapshot;
    } }, user: { findMany: async args => {
        queries++; assert.deepEqual(args, { where: { role: 'ADMIN', suspendedAt: null }, select: { id: true } });
        return [{ id: 'admin-1' }, { id: 'admin-2' }];
    } }, adminOrderEmail: { createMany: async args => batches.push(structuredClone(args)) } };
    await queueAdminOrderEmail(tx, order.id); await queueAdminOrderEmail(tx, order.id);
    assert.equal(batches.length, 2); assert.equal(batches[0].skipDuplicates, true);
    assert.deepEqual(batches[0], batches[1], 'duplicate hooks retain stable recipient keys and snapshots');
    assert.deepEqual(batches[0].data.map(row => row.adminId), ['admin-1', 'admin-2']);
    assert.notEqual(batches[0].data[0].id, batches[0].data[1].id);
    assert.equal(batches[0].data[0].payload.to, undefined);
    snapshot.paymentStatus = 'PENDING'; await queueAdminOrderEmail(tx, order.id);
    snapshot = { ...order, status: 'CANCELLED' }; await queueAdminOrderEmail(tx, order.id);
    assert.equal(queries, 2); assert.equal(batches.length, 2);
    process.env.ADMIN_ORDER_EMAILS_ENABLED = 'false'; await queueAdminOrderEmail({}, order.id);
});

function deliveryFixture() {
    const now = new Date('2026-10-29T12:00:00Z');
    const row = { id: 'placed-test', attempts: 0, claim: null, nextAttemptAt: now, sentAt: null, skippedAt: null,
        admin: { email: 'current@example.test', role: 'ADMIN', suspendedAt: null }, order: { ...order },
        payload: { subject: 'Subject', text: 'Text', html: '<p>Content</p>' } };
    const updates = [];
    function matches(where) {
        for (const [key, value] of Object.entries(where)) {
            if (key === 'nextAttemptAt') { if (row[key] > value.lte) return false; }
            else if (key === 'attempts' && typeof value === 'object') { if (row.attempts >= value.lt) return false; }
            else if (row[key] !== value) return false;
        }
        return true;
    }
    const db = { adminOrderEmail: {
        findMany: async ({ where, take }) => { assert.equal(take, 25); return matches(where) ? [structuredClone(row)] : []; },
        findUnique: async () => structuredClone(row),
        updateMany: async ({ where, data }) => {
            if (!matches(where)) return { count: 0 };
            updates.push(structuredClone(data));
            Object.assign(row, data, data.attempts ? { attempts: row.attempts + data.attempts.increment } : {});
            return { count: 1 };
        },
    } };
    return { row, db, now, updates };
}

test('delivery resolves the current active admin address, sends individually and preserves its stable message id', async t => {
    configure(t); const f = deliveryFixture(), sent = [];
    const transport = { sendMail: async mail => { sent.push(mail); return { accepted: ['CURRENT@example.test'] }; } };
    await Promise.all([deliverPendingAdminOrderEmails(f.db, transport, () => f.now), deliverPendingAdminOrderEmails(f.db, transport, () => f.now)]);
    assert.equal(sent.length, 1, 'concurrent workers cannot claim the same row');
    assert.deepEqual(sent[0].to, { address: 'current@example.test' });
    assert.equal(sent[0].bcc, undefined); assert.equal(sent[0].cc, undefined);
    assert.equal(sent[0].messageId, '<fastboost-admin-placed-test@fastboost.example>');
    assert.equal(sent[0].disableFileAccess, true); assert.equal(sent[0].disableUrlAccess, true);
    assert.ok(f.row.sentAt); assert.equal(f.row.claim, null); assert.equal(f.row.attempts, 1);
    await deliverPendingAdminOrderEmails(f.db, transport, () => f.now); assert.equal(sent.length, 1);
});

test('delayed messages never reach suspended or former admins, or orders no longer paid/active', async t => {
    configure(t);
    for (const mutate of [f => { f.row.admin.role = 'PROVIDER'; }, f => { f.row.admin.suspendedAt = new Date(); },
        f => { f.row.order.paymentStatus = 'REFUNDED'; }, f => { f.row.order.status = 'CANCELLED'; }]) {
        const f = deliveryFixture(); mutate(f);
        await deliverPendingAdminOrderEmails(f.db, { sendMail: async () => assert.fail('superseded message must not send') }, () => f.now);
        assert.ok(f.row.skippedAt); assert.equal(f.row.lastError, 'EVENT_SUPERSEDED'); assert.equal(f.row.claim, null);
    }
});

test('delivery retries failures without leaking SMTP text, respects backoff/limits and recovers expired leases', async t => {
    configure(t); const f = deliveryFixture(), logs = [];
    const original = console.error; console.error = value => logs.push(value); t.after(() => { console.error = original; });
    let sends = 0;
    const transport = { sendMail: async () => { sends++; throw Object.assign(new Error('SECRET email@example.test'), { code: 'bad SECRET' }); } };
    await deliverPendingAdminOrderEmails(f.db, transport, () => f.now);
    assert.equal(sends, 1); assert.equal(f.row.lastError, 'DELIVERY_FAILED'); assert.equal(f.row.claim, null);
    assert.equal(f.row.nextAttemptAt.getTime(), f.now.getTime() + 120000);
    assert.doesNotMatch(logs.join(' '), /SECRET|email@example/);
    await deliverPendingAdminOrderEmails(f.db, transport, () => f.now); assert.equal(sends, 1);
    f.row.nextAttemptAt = f.now; f.row.claim = 'expired-worker';
    await deliverPendingAdminOrderEmails(f.db, { sendMail: async () => ({ accepted: ['another@example.test'] }) }, () => f.now);
    assert.equal(f.row.attempts, 2); assert.equal(f.row.sentAt, null, 'wrong recipient acceptance is not success');
    f.row.nextAttemptAt = f.now; f.row.attempts = 8;
    await deliverPendingAdminOrderEmails(f.db, transport, () => f.now); assert.equal(sends, 1);
});

test('worker starts immediately and a payment wake during delivery schedules another pass', async t => {
    configure(t);
    let release, reads = 0, closes = 0, registered, requestedInterval;
    const pendingRead = new Promise(resolve => { release = resolve; });
    const db = { adminOrderEmail: { findMany: async () => { reads++; if (reads === 1) await pendingRead; return []; } } };
    const timer = { unref() {} };
    const options = { interval: (tick, ms) => { registered = tick; requestedInterval = ms; return timer; },
        transportFactory: () => ({ close: () => { closes++; } }) };
    assert.equal(startAdminOrderEmailWorker(db, options), timer);
    assert.equal(reads, 1, 'first delivery attempt is not delayed until interval');
    assert.equal(startAdminOrderEmailWorker(db, options), timer); assert.equal(requestedInterval, 30000);
    wakeAdminOrderEmailWorker(db); release();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(reads, 2, 'payment committed during an in-flight pass is picked up promptly'); assert.equal(closes, 1);
    await registered(); assert.equal(reads, 3); assert.equal(closes, 2);
});
