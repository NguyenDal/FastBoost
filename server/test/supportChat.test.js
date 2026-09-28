const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
const { authorizeThread, onlineAdmins, validateMessage, saveSupportMessage } = require('../src/utils/supportChat');
const { deliverSupportAlerts, buildSupportEmail } = require('../src/utils/supportEmail');

function fixture() {
    const messages = [];
    const alerts = [];
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
        user: { findMany: async ({ where }) => where.supportPresence ? online ? [{ id: 'admin' }] : [] : [{ id: 'admin' }, { id: 'admin-2' }] },
        $queryRaw: async () => [],
        $transaction: async fn => fn(db),
    };
    return { db, messages, alerts, customer, setOnline: value => { online = value; } };
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

test('offline text and attachments queue all admins, while retries and admin/online messages do not', async () => {
    const f = fixture();
    const body = { clientId: 'test-message-id-001', text: 'Order help' };
    const message = await saveSupportMessage(f.db, f.customer, 'thread', body);
    assert.equal(f.messages.length, 1);
    assert.deepEqual(f.alerts.map(a => a.adminId), ['admin', 'admin-2']);
    assert.equal((await saveSupportMessage(f.db, f.customer, 'thread', body)).id, message.id);
    assert.equal(f.messages.length, 1); assert.equal(f.alerts.length, 2);
    await saveSupportMessage(f.db, f.customer, 'thread', { clientId: 'test-message-id-002' }, { originalname: 'proof.pdf', size: 1024, mimetype: 'application/pdf' }, async args => { assert.equal(args.conversationId, 'support-thread'); return { key: 'private-key' }; });
    assert.equal(f.alerts.length, 4); assert.equal(f.messages[1].attachmentName, 'proof.pdf');
    f.setOnline(true);
    await saveSupportMessage(f.db, f.customer, 'thread', { ...body, clientId: 'test-message-id-003' });
    f.setOnline(false);
    await saveSupportMessage(f.db, { id: 'admin', role: 'ADMIN' }, 'thread', { ...body, clientId: 'test-message-id-004' });
    assert.equal(f.alerts.length, 4);
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

test('email retries failed recipients separately and never exposes other admin addresses', async t => {
    const old = process.env.CLIENT_URL; process.env.CLIENT_URL = 'https://www.fastboost.gg';
    t.after(() => { if (old === undefined) delete process.env.CLIENT_URL; else process.env.CLIENT_URL = old; });
    const alert = { id: 'alert', attempts: 0, admin: { email: 'admin@example.test', role: 'ADMIN', suspendedAt: null }, message: { threadId: 'thread', content: '<script>test</script>', sender: { username: 'Player' }, attachmentName: 'proof.pdf' } };
    const payload = buildSupportEmail(alert);
    assert.equal(payload.to.address, 'admin@example.test'); assert.equal(payload.html, undefined);
    assert.match(payload.text, /admin\/support\?thread=thread/); assert.match(payload.text, /proof.pdf/);
    const updates = [];
    const db = { supportEmailAlert: { findMany: async () => [alert], updateMany: async args => { updates.push(args.data); return { count: 1 }; } } };
    await deliverSupportAlerts(db, { sendMail: async () => { throw Object.assign(new Error('smtp'), { code: 'ETIMEDOUT' }); } });
    assert.equal(updates[1].lastError, 'ETIMEDOUT'); assert.ok(updates[1].nextAttemptAt > new Date());
    updates.length = 0;
    await deliverSupportAlerts(db, { sendMail: async mail => { assert.equal(mail.cc, undefined); assert.equal(mail.bcc, undefined); assert.equal(mail.disableFileAccess, true); return { accepted: ['admin@example.test'] }; } });
    assert.ok(updates[1].sentAt); assert.equal(updates[1].lastError, null);
    alert.admin.role = 'CUSTOMER';
    await deliverSupportAlerts(db, { sendMail: async () => assert.fail('A former admin must not receive customer messages') });
});

test('HTTP support routes require sign-in, current role and ownership before reading/uploading', async t => {
    const paths = [require.resolve('../src/prisma'), require.resolve('../src/utils/s3Upload')];
    const saved = paths.map(path => require.cache[path]);
    let currentRole = 'CUSTOMER'; let suspended = false; let fileReads = 0; let fileName = 'notes.txt';
    const f = fixture();
    f.db.user.findUnique = async () => ({ id: 'customer', role: currentRole, suspendedAt: suspended ? new Date() : null });
    f.db.supportThread.findUnique = async () => ({ id: 'private-thread', customerId: 'other-customer' });
    f.db.supportMessage.findUnique = async () => ({ id: 'file', threadId: 'private-thread', attachmentKey: 'private', attachmentName: fileName });
    require.cache[paths[0]] = { exports: f.db, loaded: true };
    require.cache[paths[1]] = { exports: { createChatAttachmentSignedUrl: async () => assert.fail('Do not sign unauthorized file'), uploadChatAttachmentToS3: async () => assert.fail('Do not upload unauthorized file'), readChatAttachmentFromS3: async key => { assert.equal(key, 'private'); fileReads++; return Buffer.from('Private support notes'); } }, loaded: true };
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
    assert.equal((await fetch(`${base}/attachments/file/preview`)).status, 401);
    assert.equal((await fetch(`${base}/attachments/file/preview`, { headers })).status, 404);
    assert.equal((await fetch(`${base}/attachments/file/content`, { headers })).status, 404);
    assert.equal(fileReads, 0);
    currentRole = 'PROVIDER'; assert.equal((await fetch(`${base}/status`, { headers })).status, 403);
    currentRole = 'ADMIN'; suspended = true; assert.equal((await fetch(`${base}/status`, { headers })).status, 403);
    assert.equal((await fetch(`${base}/attachments/file/preview`, { headers })).status, 403);
    suspended = false;
    const preview = await fetch(`${base}/attachments/file/preview`, { headers });
    assert.equal(preview.status, 200);
    assert.equal((await preview.json()).text, 'Private support notes');
    assert.equal(fileReads, 1);
    currentRole = 'CUSTOMER';
    f.db.supportThread.findUnique = async () => ({ id: 'private-thread', customerId: 'customer' });
    assert.equal((await fetch(`${base}/attachments/file/preview`, { headers })).status, 200);
    assert.equal((await fetch(`${base}/attachments/file/content`, { headers })).status, 415);
    fileName = 'terms.pdf';
    const content = await fetch(`${base}/attachments/file/content`, { headers });
    assert.equal(content.status, 200);
    assert.equal(content.headers.get('content-type'), 'application/pdf');
    assert.equal(content.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(content.headers.get('cache-control'), 'no-store');
});
