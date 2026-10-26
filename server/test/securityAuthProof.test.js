// Adversarial regression tests use only synthetic database, mail and provider
// fixtures. Fixed findings assert access is denied at the application boundary.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { createProtect, adminOnly } = require('../src/middleware/authMiddleware');
const { signSessionToken, sessionSecurityStamp } = require('../src/utils/sessionToken');

function environment(t, extra = {}) {
    const values = { JWT_SECRET: 'synthetic-security-proof-secret', CLIENT_URL: 'https://app.example.test', NODE_ENV: 'test', ...extra };
    const old = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
    Object.assign(process.env, values);
    t.after(() => { for (const [key, value] of Object.entries(old)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
}
function load(t, target, mocks = {}) {
    const paths = [target, ...Object.keys(mocks)].map(name => require.resolve(name));
    const old = paths.map(path => [path, require.cache[path]]);
    delete require.cache[paths[0]];
    Object.values(mocks).forEach((exports, i) => { require.cache[paths[i + 1]] = { exports, loaded: true }; });
    t.after(() => { for (const [path, value] of old) { if (value) require.cache[path] = value; else delete require.cache[path]; } });
    return require(paths[0]);
}
function response() {
    return { statusCode: 200, headers: {}, status(code) { this.statusCode = code; return this; }, set(key, value) { this.headers[key] = value; return this; }, setHeader(key, value) { this.headers[key] = value; return this; }, json(body) { this.body = body; return this; } };
}
async function authenticate(token, db, roleRequired = false) {
    const req = { headers: { authorization: `Bearer ${token}` }, query: {}, method: 'GET', path: '/admin/users' };
    const res = response(); let allowed = false;
    await createProtect(db)(req, res, () => roleRequired ? adminOnly(req, res, () => { allowed = true; }) : (allowed = true));
    return { req, res, allowed };
}

function resetFixture(account, { concurrentReads = false } = {}) {
    const record = { id: 'reset-record', tokenHash: crypto.createHash('sha256').update('synthetic-reset-token').digest('hex'), userId: account.id, user: { ...account }, usedAt: null, expiresAt: new Date(Date.now() + 60000) };
    let reads = 0, release, tail = Promise.resolve(), writes = 0;
    const readGate = new Promise(resolve => { release = resolve; });
    const db = { user: { findUnique: async () => ({ ...account }),
        updateMany: async ({ where }) => ({ count: account.passwordHash === where.passwordHash && !account.suspendedAt ? 1 : 0 }),
        update: async ({ data }) => { writes++; return Object.assign(account, data); } },
        passwordResetToken: {
            findUnique: async () => { const snapshot = { ...record }; if (concurrentReads) { if (++reads === 2) release(); await readGate; } return snapshot; },
            updateMany: async ({ where, data }) => {
                if (record.usedAt || where.tokenHash !== record.tokenHash || record.expiresAt <= where.expiresAt.gt) return { count: 0 };
                Object.assign(record, data); return { count: 1 };
            }, deleteMany: async () => ({ count: 0 }),
        }, socialIdentity: { deleteMany: async () => ({ count: 0 }) },
    };
    db.$transaction = callback => {
        const run = tail.then(async () => {
            const saved = structuredClone({ account, record });
            try { return await callback(db); }
            catch (error) { Object.assign(account, saved.account); Object.assign(record, saved.record); throw error; }
        });
        tail = run.catch(() => {}); return run;
    };
    return { db, record, writes: () => writes };
}
const resetRequest = password => ({ body: { token: 'synthetic-reset-token', password, confirmPassword: password } });

test('security regression: demotion, booster revocation, suspension and account deletion override stale JWT claims', async t => {
    environment(t);
    let actor = { id: 'former-admin', role: 'ADMIN', username: 'FormerAdmin', passwordHash: 'synthetic-hash', suspendedAt: null, hasBoosterAccess: true };
    const oldToken = signSessionToken(actor, true);
    const db = { user: { findUnique: async () => actor } };
    actor.role = 'CUSTOMER'; actor.hasBoosterAccess = false;
    const demoted = await authenticate(oldToken, db, true);
    assert.equal(demoted.allowed, false); assert.equal(demoted.res.statusCode, 403);
    assert.equal(demoted.req.user.role, 'CUSTOMER'); assert.equal(demoted.req.user.hasBoosterAccess, false);
    actor.suspendedAt = new Date();
    assert.equal((await authenticate(oldToken, db)).res.statusCode, 401);
    actor = null;
    assert.equal((await authenticate(oldToken, db)).res.statusCode, 401);
});

test('security regression: password reset revokes ordinary and remembered sessions and issues only a fresh token', async t => {
    environment(t);
    const account = { id: 'reset-owner', email: 'owner@example.test', role: 'CUSTOMER', passwordHash: 'old-hash', suspendedAt: null, emailVerifiedAt: new Date() };
    const tokens = [signSessionToken(account), signSessionToken(account, true)];
    const { db } = resetFixture(account);
    const { resetPassword } = load(t, '../src/controllers/authController', { '../src/prisma': db });
    const res = response(); await resetPassword(resetRequest('NewPassword123!'), res);
    assert.equal(res.statusCode, 200); assert.equal(await bcrypt.compare('NewPassword123!', account.passwordHash), true);
    for (const token of tokens) assert.equal((await authenticate(token, db)).allowed, false);
    assert.equal((await authenticate(res.body.token, db)).allowed, true);
    assert.equal(jwt.decode(res.body.token).rememberMe, false);
});

test('security regression: a suspended account cannot reset its password or obtain a fresh session', async t => {
    environment(t);
    const account = { id: 'suspended-owner', role: 'CUSTOMER', passwordHash: 'keep-hash', suspendedAt: new Date() };
    const { db, record, writes } = resetFixture(account);
    const { resetPassword } = load(t, '../src/controllers/authController', { '../src/prisma': db });
    const res = response(); await resetPassword(resetRequest('NewPassword123!'), res);
    assert.equal(res.statusCode, 400); assert.equal(res.body.token, undefined);
    assert.equal(account.passwordHash, 'keep-hash'); assert.equal(record.usedAt, null); assert.equal(writes(), 0);
});

test('security regression: email reset recovers an unverified account without preserving earlier provider access', async t => {
    environment(t);
    const account = { id: 'unverified-owner', role: 'CUSTOMER', passwordHash: 'preregistrant-hash', suspendedAt: null, emailVerifiedAt: null };
    const { db } = resetFixture(account);
    let removed = 0;
    db.socialIdentity.deleteMany = async ({ where }) => { assert.equal(where.userId, account.id); removed++; return { count: 2 }; };
    const { resetPassword } = load(t, '../src/controllers/authController', { '../src/prisma': db });
    const res = response(); await resetPassword(resetRequest('OwnerPassword123!'), res);
    assert.equal(res.statusCode, 200); assert.equal(removed, 1); assert.ok(account.emailVerifiedAt instanceof Date);
    assert.equal((await authenticate(res.body.token, db)).allowed, true);
});

test('security regression: concurrent use of a reset link has exactly one winner', async t => {
    environment(t);
    const account = { id: 'race-owner', role: 'CUSTOMER', passwordHash: 'keep-hash', suspendedAt: null, emailVerifiedAt: new Date() };
    const { db, writes } = resetFixture(account, { concurrentReads: true });
    const { resetPassword } = load(t, '../src/controllers/authController', { '../src/prisma': db });
    const first = response(), second = response();
    await Promise.all([resetPassword(resetRequest('FirstPassword123!'), first), resetPassword(resetRequest('SecondPassword123!'), second)]);
    assert.deepEqual([first.statusCode, second.statusCode].sort(), [200, 400]); assert.equal(writes(), 1);
    assert.equal([first, second].filter(res => res.body.token).length, 1);
});

test('security regression: route budgets bound repeated credential guesses and reset email sends', async t => {
    environment(t, { APP_BASE_URL: 'https://app.example.test' });
    const account = { id: 'target', email: 'target@example.test', passwordHash: 'synthetic-hash' };
    let comparisons = 0, messages = 0, tokenWrites = 0;
    const db = { user: { findUnique: async () => account, updateMany: async () => ({ count: 1 }) }, passwordResetToken: { deleteMany: async () => ({}), create: async () => { tokenWrites++; return {}; } } };
    db.$transaction = fn => fn(db);
    const auth = load(t, '../src/controllers/authController', { '../src/prisma': db,
        bcrypt: { compare: async () => { comparisons++; return false; } },
        nodemailer: { createTransport: () => ({ sendMail: async () => { messages++; } }) },
    });
    const router = load(t, '../src/routes/authRoutes', { '../src/prisma': db, '../src/controllers/authController': auth });
    const send = async path => {
        const req = { ip: '192.0.2.1', body: { email: account.email, password: 'WrongPassword123!' } }, res = response();
        const stack = router.stack.find(layer => layer.route?.path === path).route.stack;
        const run = i => stack[i]?.handle(req, res, () => run(i + 1));
        await run(0); return res;
    };
    for (let attempt = 0; attempt < 25; attempt++) {
        assert.equal((await send('/login')).statusCode, attempt < 15 ? 401 : 429);
        assert.equal((await send('/forgot-password')).statusCode, attempt < 3 ? 200 : 429);
    }
    assert.equal(comparisons, 15); assert.equal(messages, 3); assert.equal(tokenWrites, 3);
});

test('security regression: verified OAuth recovery removes preregistrant passwords, sessions and provider identities', async t => {
    environment(t);
    const knownPassword = 'AttackerKnows123!'; let account;
    const links = [{ id: 'attacker-discord', userId: 'precreated-account', provider: 'discord', providerUserId: 'attacker-discord-id' }];
    const db = { user: {
        findUnique: async ({ where }) => account && (where.id === account.id || where.email === account.email) ? account : null,
        findFirst: async () => null,
        create: async ({ data }) => (account = { ...data, id: 'precreated-account', emailVerifiedAt: null, profile: { displayName: data.username } }),
        update: async ({ data }) => Object.assign(account, data),
        updateMany: async ({ where, data }) => { if (where.passwordHash !== account.passwordHash || account.suspendedAt) return { count: 0 }; Object.assign(account, data); return { count: 1 }; },
    }, socialIdentity: {
        findUnique: async ({ where }) => links.find(link => where.userId_provider ? link.userId === where.userId_provider.userId && link.provider === where.userId_provider.provider : link.provider === where.provider_providerUserId.provider && link.providerUserId === where.provider_providerUserId.providerUserId) || null,
        create: async ({ data }) => { links.push(data); return data; },
        deleteMany: async ({ where }) => { const removed = links.filter(link => link.userId === where.userId); for (const link of removed) links.splice(links.indexOf(link), 1); return { count: removed.length }; },
    }, passwordResetToken: { deleteMany: async () => ({ count: 1 }) }, $transaction: async fn => fn(db) };
    const auth = load(t, '../src/controllers/authController', { '../src/prisma': db });
    const registered = response();
    await auth.registerUser({ body: { email: 'futurevictim@gmail.com', username: 'Precreated', password: knownPassword, termsAccepted: true } }, registered);
    assert.equal(registered.statusCode, 201); assert.equal(account.emailVerifiedAt, null);
    const social = load(t, '../src/controllers/socialAuthController', { '../src/prisma': db });
    const identity = { sub: 'victim-google-id', email: account.email, email_verified: true };
    const secret = crypto.createHmac('sha256', process.env.JWT_SECRET).update('fastboost-social-signup').digest('hex');
    const linkToken = jwt.sign({ provider: 'google', identity, userId: account.id, securityStamp: sessionSecurityStamp(account), origin: process.env.CLIENT_URL }, secret, { audience: 'fastboost-social-link-confirmation', expiresIn: '10m' });
    const confirmed = response();
    await social.confirmSocialLink({ headers: { origin: process.env.CLIENT_URL }, body: { linkToken, allow: true } }, confirmed);
    assert.equal(confirmed.statusCode, 200); assert.ok(confirmed.body.token); assert.ok(account.emailVerifiedAt);
    assert.equal(await bcrypt.compare(knownPassword, account.passwordHash), false);
    assert.deepEqual(links.map(link => link.provider), ['google']);
    assert.equal((await authenticate(registered.body.token, db)).allowed, false);
    const attacker = response(); await auth.loginUser({ body: { email: account.email, password: knownPassword } }, attacker);
    assert.equal(attacker.statusCode, 401);
    assert.equal((await authenticate(confirmed.body.token, db)).allowed, true);
    const replay = response(); await social.confirmSocialLink({ headers: { origin: process.env.CLIENT_URL }, body: { linkToken, allow: true } }, replay);
    assert.equal(replay.statusCode, 400); assert.equal(replay.body.token, undefined);
});

function socketHarness(t) {
    const signProfileImages = require('../src/utils/privateProfileImages').signProfileImages;
    const avatarKey = 'profiles/customer/1730000000000-abc.png';
    let io;
    class FakeServer {
        constructor() { io = this; this.clients = []; }
        use(handler) { this.middleware = handler; }
        on(_event, handler) { this.connected = handler; }
        in(room) { return { fetchSockets: async () => this.clients.filter(client => client.rooms.has(room)) }; }
    }
    let assigned = true;
    const users = new Map(['customer', 'booster', 'admin'].map(id => [id, { id, role: id === 'booster' ? 'PROVIDER' : id === 'admin' ? 'ADMIN' : 'CUSTOMER', passwordHash: 'synthetic-hash', suspendedAt: null }]));
    const db = { order: { findUnique: async () => ({ id: 'order', customerId: 'customer' }) },
        orderAssignment: { findFirst: async () => assigned ? { boosterId: 'booster' } : null },
        conversation: { findUnique: async () => ({ id: 'conversation', orderId: 'order' }), upsert: async () => ({ id: 'conversation', orderId: 'order' }), update: async () => ({}) },
        conversationParticipant: { upsert: async () => ({}) },
        user: { findUnique: async ({ where }) => users.get(where.id) },
        message: { count: async () => 0, findMany: async () => [{ id: 'old-message', content: 'private history', attachmentUrl: 'https://old-public.example.test/file',
            sender: { profile: { profileImageUrl: avatarKey } } }], create: async ({ data }) => ({ ...data, id: 'new-message', createdAt: new Date(),
            sender: { profile: { profileImageUrl: avatarKey } } }) },
        $queryRaw: async () => [], $transaction: callback => callback(db),
    };
    const { initSocket } = load(t, '../src/socket', { 'socket.io': { Server: FakeServer }, '../src/prisma': db,
        '../src/utils/chatNotifications': { createChatMessageNotifications: async () => {} },
        '../src/utils/privateProfileImages': { signProfileImages: value => signProfileImages(value,
            async key => `https://signed.example.test/${key}?expires=15m`) } });
    initSocket({});
    async function connect(id, expiresIn = null) {
        const user = users.get(id);
        let token = signSessionToken(user);
        if (expiresIn) { const claims = jwt.decode(token); delete claims.exp; token = jwt.sign(claims, process.env.JWT_SECRET, { expiresIn }); }
        const handlers = new Map();
        const client = { id, handshake: { auth: { token } }, handlers, rooms: new Set(), received: [],
            on: (name, callback) => handlers.set(name, callback), join(room) { this.rooms.add(room); }, leave(room) { this.rooms.delete(room); },
            emit(event, message) { this.received.push({ event, message }); } };
        await io.middleware(client, error => assert.equal(error, undefined));
        io.clients.push(client); io.connected(client); return client;
    }
    return { connect, users, revoke() { assigned = false; } };
}

test('security regression: unassigned booster is evicted before new private chat messages are emitted', async t => {
    environment(t);
    const harness = socketHarness(t);
    const booster = await harness.connect('booster');
    let joined;
    await booster.handlers.get('chat:join')({ orderId: 'order' }, result => { joined = result; });
    assert.equal(joined.ok, true);
    harness.revoke();
    let denied;
    await booster.handlers.get('chat:join')({ orderId: 'order' }, result => { denied = result; });
    assert.equal(denied.ok, false);
    const customer = await harness.connect('customer');
    let sent;
    await customer.handlers.get('chat:message')({ conversationId: 'conversation', content: 'new confidential data after removal' }, result => { sent = result; });
    assert.equal(sent.ok, true);
    assert.equal(booster.received.length, 0);
    assert.equal(booster.rooms.size, 0);
});

test('socket chat signs sender avatars and never emits legacy bare attachment URLs', async t => {
    environment(t);
    const harness = socketHarness(t);
    const booster = await harness.connect('booster');
    let joined;
    await booster.handlers.get('chat:join')({ orderId: 'order' }, result => { joined = result; });
    assert.equal(joined.ok, true);
    assert.equal(joined.messages[0].attachmentUrl, null, 'legacy row has no attachment key but cannot expose a dead public link');
    assert.match(joined.messages[0].sender.profile.profileImageUrl, /signed\.example\.test/);
    const customer = await harness.connect('customer');
    let sent;
    await customer.handlers.get('chat:message')({ conversationId: 'conversation', content: 'hello' }, result => { sent = result; });
    assert.equal(sent.ok, true);
    assert.equal(sent.message.attachmentUrl, null);
    assert.match(sent.message.sender.profile.profileImageUrl, /signed\.example\.test/);
    assert.equal(booster.received[0].message.attachmentUrl, null);
});

test('security regression: socket history is refused after JWT expiry', async t => {
    environment(t);
    const harness = socketHarness(t);
    const customer = await harness.connect('customer', 1);
    const now = Date.now();
    t.mock.method(Date, 'now', () => now + 60000);
    assert.throws(() => jwt.verify(customer.handshake.auth.token, process.env.JWT_SECRET), /expired/);
    let joined;
    await customer.handlers.get('chat:join')({ orderId: 'order' }, result => { joined = result; });
    assert.equal(joined.ok, false);
    assert.equal(joined.messages, undefined);
});

test('security regression: malformed socket payloads and non-function callbacks do not escape handlers', async t => {
    environment(t);
    const harness = socketHarness(t);
    const customer = await harness.connect('customer');
    for (const name of ['chat:join', 'chat:message']) {
        await assert.doesNotReject(customer.handlers.get(name)(null, {}));
        await assert.doesNotReject(customer.handlers.get(name)({ conversationId: {}, content: true, orderId: [] }, 'invalid callback'));
    }
});

test('security regression: suspension, demotion and password changes revoke passive socket delivery', async t => {
    environment(t);
    const harness = socketHarness(t);
    const admin = await harness.connect('admin');
    let joined;
    await admin.handlers.get('chat:join')({ orderId: 'order' }, result => { joined = result; });
    assert.equal(joined.ok, true);
    harness.users.get('admin').role = 'CUSTOMER';
    const customer = await harness.connect('customer');
    let sent;
    await customer.handlers.get('chat:message')({ conversationId: 'conversation', content: 'private after demotion' }, result => { sent = result; });
    assert.equal(sent.ok, true);
    assert.equal(admin.received.length, 0);
    assert.equal(admin.rooms.size, 0);
    for (const change of [{ suspendedAt: new Date() }, { passwordHash: 'changed-hash' }]) {
        const booster = await harness.connect('booster');
        await booster.handlers.get('chat:join')({ orderId: 'order' }, result => { joined = result; });
        assert.equal(joined.ok, true);
        Object.assign(harness.users.get('booster'), change);
        await customer.handlers.get('chat:message')({ conversationId: 'conversation', content: 'private after revocation' }, result => { sent = result; });
        assert.equal(sent.ok, true);
        assert.equal(booster.received.length, 0);
        assert.equal(booster.rooms.size, 0);
        Object.assign(harness.users.get('booster'), { suspendedAt: null, passwordHash: 'synthetic-hash' });
    }
});

test('security regression: spoofed attachment MIME and legacy objects are forced safe downloads', async t => {
    const commands = [];
    class Command { constructor(input) { this.input = input; } }
    class FakeS3 { async send(command) { commands.push(command.input); } }
    const s3 = load(t, '../src/utils/s3Upload', { '@aws-sdk/client-s3': { S3Client: FakeS3, PutObjectCommand: Command, GetObjectCommand: Command },
        '@aws-sdk/s3-request-presigner': { getSignedUrl: async (_client, command) => { commands.push(command.input); return 'https://assets.example.test/synthetic-signed-url'; } } });
    const file = { originalname: 'invoice.pdf', mimetype: 'text/html', buffer: Buffer.from('<!doctype html><script>window.securityProof = true</script>'), size: 58 };
    const uploaded = await s3.uploadChatAttachmentToS3({ conversationId: 'support-synthetic', userId: 'customer', file });
    await s3.createChatAttachmentSignedUrl({ key: uploaded.key, filename: file.originalname });
    assert.equal(commands[0].ContentType, 'application/octet-stream');
    assert.equal(commands[0].ContentDisposition, 'attachment');
    assert.match(commands[1].ResponseContentDisposition, /^attachment;/);
    assert.equal(commands[1].ResponseContentType, 'application/octet-stream');
    await s3.createChatAttachmentSignedUrl({ key: 'legacy/active.html', filename: 'active.html', download: false });
    assert.equal(commands[2].ResponseContentType, 'application/octet-stream');
    assert.match(commands[2].ResponseContentDisposition, /^attachment;/);
    for (const name of ['active.html', 'active.svg', 'payload.js']) await assert.rejects(s3.uploadChatAttachmentToS3({ conversationId: 'x', userId: 'x', file: { ...file, originalname: name } }), /not allowed/);
    await assert.rejects(s3.uploadProfileImageToS3({ userId: 'x', file: { ...file, originalname: 'avatar.png', mimetype: 'image/png' } }), /Only JPG/);
});
