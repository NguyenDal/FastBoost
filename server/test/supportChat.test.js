const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
const { authorizeThread, onlineAdmins, validateMessage, saveSupportMessage, markSupportRead, EMAIL_DELAY_MS } = require('../src/utils/supportChat');
const { deliverSupportAlerts, buildSupportEmail, shouldDeliver } = require('../src/utils/supportEmail');

function fixture() {
    const messages = [];
    const alerts = [];
    const notifications = [];
    let online = false;
    const customer = { id: 'customer', role: 'CUSTOMER', username: 'Player' };
    const db = {
        supportThread: { findUnique: async ({ where }) => where.id === 'thread' ? { id: 'thread', customerId: customer.id } : null, update: async () => ({}) },
        supportMessage: {
            findUnique: async ({ where }) => messages.find(m => m.senderId === where.senderId_clientId?.senderId && m.clientId === where.senderId_clientId?.clientId),
            count: async () => messages.length,
            create: async ({ data }) => { const m = { ...data, id: `message-${messages.length}`, createdAt: new Date(), sender: customer }; messages.push(m); return m; },
        },
        supportEmailAlert: { createMany: async ({ data }) => { alerts.push(...data); } },
        notification: { createMany: async ({ data }) => { notifications.push(...data); } },
        user: { findMany: async ({ where }) => where.id ? [customer] : where.supportPresence ? online ? [{ id: 'admin' }] : [] : [{ id: 'admin' }, { id: 'admin-2' }] },
        $queryRaw: async () => [],
        $transaction: async fn => fn(db),
    };
    return { db, messages, alerts, notifications, customer, setOnline: value => { online = value; } };
}

test('support ownership, empty/long input and unsafe file types are rejected', async () => {
    const { db, customer } = fixture();
    await authorizeThread(db, customer, 'thread');
    await authorizeThread(db, { id: 'admin', role: 'ADMIN' }, 'thread');
    await assert.rejects(authorizeThread(db, { id: 'stranger', role: 'CUSTOMER' }, 'thread'), { status: 404 });
    const body = { clientId: 'test-message-id-001', text: 'Hello' };
    assert.equal(validateMessage(body), 'Hello');
    assert.throws(() => validateMessage({ ...body, text: ' ' }), { status: 400 });
    assert.throws(() => validateMessage({ ...body, text: 'x'.repeat(4001) }), { status: 400 });
    assert.throws(() => validateMessage(body, { originalname: 'malware.exe' }), { status: 400 });
    assert.throws(() => validateMessage(body, { originalname: 'page.html' }), { status: 400 });
});

test('support notifications reach both sides; offline admin alerts and customer replies wait five minutes without retry duplicates', async () => {
    const f = fixture();
    const body = { clientId: 'test-message-id-001', text: 'Order help' };
    const message = await saveSupportMessage(f.db, f.customer, 'thread', body);
    assert.equal(f.messages.length, 1);
    assert.deepEqual(f.alerts.map(a => a.adminId), ['admin', 'admin-2']);
    assert.equal((await saveSupportMessage(f.db, f.customer, 'thread', body)).id, message.id);
    assert.equal(f.messages.length, 1); assert.equal(f.alerts.length, 2);
    assert.equal(f.notifications.length, 2);
    assert.ok(f.alerts.every(a => a.nextAttemptAt.getTime() - message.createdAt.getTime() === EMAIL_DELAY_MS));
    assert.equal(f.notifications[0].type, 'CHAT_MESSAGE');
    assert.equal(f.notifications[0].data.targetPath, '/admin/support?thread=thread');
    await saveSupportMessage(f.db, f.customer, 'thread', { clientId: 'test-message-id-002' }, { originalname: 'proof.pdf', size: 1024, mimetype: 'application/pdf' }, async args => { assert.equal(args.conversationId, 'support-thread'); return { key: 'private-key' }; });
    assert.equal(f.alerts.length, 4); assert.equal(f.messages[1].attachmentName, 'proof.pdf');
    f.setOnline(true);
    await saveSupportMessage(f.db, f.customer, 'thread', { ...body, clientId: 'test-message-id-003' });
    f.setOnline(false);
    await saveSupportMessage(f.db, { id: 'admin', role: 'ADMIN' }, 'thread', { ...body, clientId: 'test-message-id-004' });
    assert.equal(f.alerts.length, 5);
    assert.equal(f.alerts.at(-1).adminId, 'customer');
    assert.equal(f.notifications.length, 7);
    assert.equal(f.notifications.at(-1).data.targetPath, '/account/dashboard?support=open');
    assert.equal(f.notifications[2].message, 'proof.pdf');
});

test('presence requires a current unexpired admin and excludes suspended accounts', async () => {
    const now = new Date();
    await onlineAdmins({ user: { findMany: async args => { assert.equal(args.where.role, 'ADMIN'); assert.equal(args.where.suspendedAt, null); assert.equal(args.where.supportPresence.some.expiresAt.gt, now); assert.equal(args.select.email, undefined); return []; } } }, now);
});

test('support message rate limit applies before a new message commits', async () => {
    const f = fixture(); f.db.supportMessage.count = async () => 12;
    await assert.rejects(saveSupportMessage(f.db, f.customer, 'thread', { clientId: 'test-rate-limit-001', text: 'Hi' }), { status: 429 });
    assert.equal(f.messages.length, 0); assert.equal(f.alerts.length, 0);
});

function emailFixture(toCustomer = false) {
    const now = new Date('2026-09-28T12:00:00Z');
    const messageTime = new Date(now.getTime() - EMAIL_DELAY_MS);
    const alert = { id: 'alert', messageId: 'message', adminId: toCustomer ? 'customer' : 'admin', attempts: 0, sentAt: null, nextAttemptAt: now,
        admin: { email: toCustomer ? 'customer@example.test' : 'admin@example.test', role: toCustomer ? 'CUSTOMER' : 'ADMIN', suspendedAt: null },
        message: { id: 'message', senderId: toCustomer ? 'admin' : 'customer', threadId: 'thread', createdAt: messageTime,
            thread: { customerId: 'customer', adminReadAt: new Date(0), customerReadAt: new Date(0) },
            content: '<script>test</script>', sender: { username: 'Player' }, attachmentName: 'proof.pdf' } };
    let notificationRead = false, deleted = false;
    const db = {
        notification: { findUnique: async () => ({ read: notificationRead }) },
        supportEmailAlert: {
            findMany: async ({ where }) => !deleted && !alert.sentAt && alert.nextAttemptAt <= where.nextAttemptAt.lte && alert.message.createdAt <= where.message.createdAt.lte ? [structuredClone(alert)] : [],
            findUnique: async () => deleted ? null : structuredClone(alert),
            updateMany: async ({ where, data }) => {
                if (deleted || (where.claim && where.claim !== alert.claim)) return { count: 0 };
                const attempts = data.attempts ? alert.attempts + data.attempts.increment : alert.attempts;
                Object.assign(alert, data, { attempts }); return { count: 1 };
            },
            deleteMany: async () => { deleted = true; return { count: 1 }; },
        },
    };
    return { db, alert, now, setRead: () => { notificationRead = true; }, deleted: () => deleted };
}

test('email sends in both directions only at five minutes, with protected destinations and one recipient', async t => {
    const old = process.env.CLIENT_URL; process.env.CLIENT_URL = 'https://www.fastboost.gg';
    t.after(() => { if (old === undefined) delete process.env.CLIENT_URL; else process.env.CLIENT_URL = old; });
    for (const customer of [false, true]) {
        const f = emailFixture(customer); let sent = 0;
        const transport = { sendMail: async mail => {
            sent++; assert.equal(mail.cc, undefined); assert.equal(mail.bcc, undefined); assert.equal(mail.html, undefined);
            assert.equal(mail.disableFileAccess, true); assert.equal(mail.disableUrlAccess, true);
            assert.equal(mail.to.address, f.alert.admin.email);
            assert.ok(mail.text.includes(customer ? 'https://www.fastboost.gg/support' : '/admin/support?thread=thread'));
            assert.match(mail.text, /proof.pdf/); return { accepted: [f.alert.admin.email] };
        } };
        await deliverSupportAlerts(f.db, transport, new Date(f.now.getTime() - 1)); assert.equal(sent, 0);
        await deliverSupportAlerts(f.db, transport, f.now); assert.equal(sent, 1); assert.ok(f.alert.sentAt);
        await deliverSupportAlerts(f.db, transport, f.now); assert.equal(sent, 1);
        assert.equal(buildSupportEmail(f.alert).to.address, f.alert.admin.email);
    }
});

test('read notifications, opened conversations, suspended and unauthorized recipients suppress both email directions', async () => {
    for (const customer of [false, true]) {
        for (const reason of ['notification', 'conversation', 'suspended', 'role', ...(customer ? ['ownership'] : [])]) {
            const f = emailFixture(customer);
            if (reason === 'notification') f.setRead();
            if (reason === 'conversation') f.alert.message.thread[customer ? 'customerReadAt' : 'adminReadAt'] = f.alert.message.createdAt;
            if (reason === 'suspended') f.alert.admin.suspendedAt = new Date();
            if (reason === 'role') f.alert.admin.role = 'PROVIDER';
            if (reason === 'ownership') f.alert.adminId = 'someone-else';
            await deliverSupportAlerts(f.db, { sendMail: async () => assert.fail('Read/ineligible messages must not email') }, f.now);
            assert.equal(f.deleted(), true); assert.equal(f.alert.sentAt, null);
        }
        const f = emailFixture(customer);
        f.alert.message.thread[customer ? 'customerReadAt' : 'adminReadAt'] = new Date(f.alert.message.createdAt.getTime() - 1);
        assert.equal(await shouldDeliver(f.db, f.alert), true, 'Reading an older message must not hide a newer message');
    }
});

test('failed email retries recheck read status before SMTP and concurrent workers honor claims', async t => {
    const old = process.env.CLIENT_URL; process.env.CLIENT_URL = 'https://www.fastboost.gg';
    t.after(() => { if (old === undefined) delete process.env.CLIENT_URL; else process.env.CLIENT_URL = old; });
    const f = emailFixture(true);
    await deliverSupportAlerts(f.db, { sendMail: async () => { throw Object.assign(new Error('smtp'), { code: 'ETIMEDOUT' }); } }, f.now);
    assert.equal(f.alert.lastError, 'ETIMEDOUT'); assert.ok(f.alert.nextAttemptAt > f.now);
    f.setRead();
    await deliverSupportAlerts(f.db, { sendMail: async () => assert.fail('Read during retry delay') }, f.alert.nextAttemptAt);
    assert.equal(f.deleted(), true);
    const busy = emailFixture(); busy.db.supportEmailAlert.updateMany = async () => ({ count: 0 });
    await deliverSupportAlerts(busy.db, { sendMail: async () => assert.fail('Another worker owns this alert') }, busy.now);
});

test('opening support marks only authorized conversation notifications through the displayed message', async () => {
    const f = fixture(); const stamp = new Date(); const updates = [];
    f.db.supportMessage.findUnique = async () => ({ id: 'latest', threadId: 'thread', createdAt: stamp });
    f.db.supportThread.updateMany = async args => { updates.push(args); };
    f.db.notification.updateMany = async args => { updates.push(args); };
    await markSupportRead(f.db, f.customer, 'thread', 'latest');
    assert.equal(updates[0].data.customerReadAt, stamp);
    assert.equal(updates[1].where.userId, 'customer');
    assert.deepEqual(updates[1].where.data, { path: ['supportThreadId'], equals: 'thread' });
    assert.equal(updates[1].where.createdAt.lte, stamp); assert.equal(updates[1].data.read, true);
    updates.length = 0;
    await markSupportRead(f.db, { id: 'admin', role: 'ADMIN' }, 'thread', 'latest');
    assert.equal(updates[0].data.adminReadAt, stamp); assert.equal(updates[1].where.user.role, 'ADMIN');
    updates.length = 0;
    await assert.rejects(markSupportRead(f.db, { id: 'stranger', role: 'CUSTOMER' }, 'thread', 'latest'), { status: 404 });
    assert.equal(updates.length, 0);
    f.db.supportMessage.findUnique = async () => ({ id: 'latest', threadId: 'another-thread', createdAt: stamp });
    await assert.rejects(markSupportRead(f.db, f.customer, 'thread', 'latest'), { status: 400 });
});

test('HTTP support routes require sign-in, current role and ownership before reading/uploading', async t => {
    const paths = [require.resolve('../src/prisma'), require.resolve('../src/utils/s3Upload')];
    const saved = paths.map(path => require.cache[path]);
    let currentRole = 'CUSTOMER'; let suspended = false; let signed = 0;
    const f = fixture();
    f.db.user.findUnique = async () => ({ id: 'customer', role: currentRole, suspendedAt: suspended ? new Date() : null });
    f.db.supportThread.findUnique = async () => ({ id: 'private-thread', customerId: 'other-customer' });
    f.db.supportMessage.findUnique = async () => ({ id: 'file', threadId: 'private-thread', attachmentKey: 'private', attachmentName: 'proof.pdf' });
    require.cache[paths[0]] = { exports: f.db, loaded: true };
    require.cache[paths[1]] = { exports: { createChatAttachmentSignedUrl: async args => { signed++; assert.deepEqual(args, { key: 'private', filename: 'proof.pdf' }); return 'https://example.test/inline-file'; }, uploadChatAttachmentToS3: async () => assert.fail('Do not upload unauthorized file') }, loaded: true };
    const route = require.resolve('../src/routes/supportRoutes'); delete require.cache[route];
    const oldSecret = process.env.JWT_SECRET; process.env.JWT_SECRET = 'support-test-only';
    const app = express(); app.use(express.json()); app.use('/support', require(route));
    const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
    t.after(() => { server.close(); delete require.cache[route]; paths.forEach((path, i) => { if (saved[i]) require.cache[path] = saved[i]; else delete require.cache[path]; }); if (oldSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = oldSecret; });
    const base = `http://127.0.0.1:${server.address().port}/support`;
    const headers = { Authorization: `Bearer ${jwt.sign({ id: 'customer', role: 'ADMIN' }, process.env.JWT_SECRET, { expiresIn: '5m' })}`, 'Content-Type': 'application/json' };
    assert.equal((await fetch(`${base}/status`)).status, 401);
    assert.equal((await fetch(`${base}/threads`, { headers })).status, 403);
    assert.equal((await fetch(`${base}/presence`, { method: 'POST', headers, body: JSON.stringify({ sessionId: 'test-presence-id-001' }) })).status, 403);
    assert.equal((await fetch(`${base}/threads/private-thread/messages`, { headers })).status, 404);
    assert.equal((await fetch(`${base}/threads/private-thread/messages`, { method: 'POST', headers, body: '{}' })).status, 404);
    assert.equal((await fetch(`${base}/attachments/file`, { headers })).status, 404);
    assert.equal(signed, 0);
    currentRole = 'PROVIDER'; assert.equal((await fetch(`${base}/status`, { headers })).status, 403);
    currentRole = 'ADMIN'; suspended = true; assert.equal((await fetch(`${base}/attachments/file`, { headers })).status, 403);
    suspended = false;
    const file = await fetch(`${base}/attachments/file`, { headers });
    assert.equal(file.status, 200); assert.equal((await file.json()).url, 'https://example.test/inline-file');
    currentRole = 'CUSTOMER';
    f.db.supportThread.findUnique = async () => ({ id: 'private-thread', customerId: 'customer' });
    assert.equal((await fetch(`${base}/attachments/file`, { headers })).status, 200);
    assert.equal(signed, 2);
});
