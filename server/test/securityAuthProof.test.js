// Safe, synthetic proofs of the security review's current findings. These tests
// deliberately assert the vulnerable behavior so the audit stays reproducible;
// invert the relevant expectations when implementing the recommended fixes.
// No real database, mail transport, OAuth provider or S3 request is used.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { protect, adminOnly } = require('../src/middleware/authMiddleware');
const { signSessionToken } = require('../src/utils/sessionToken');

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
    return { statusCode: 200, headers: {}, status(code) { this.statusCode = code; return this; }, set(key, value) { this.headers[key] = value; return this; }, json(body) { this.body = body; return this; } };
}
function authenticate(token, roleRequired = false) {
    const req = { headers: { authorization: `Bearer ${token}` }, query: {}, method: 'GET', path: '/admin/users' };
    const res = response(); let allowed = false;
    protect(req, res, () => roleRequired ? adminOnly(req, res, () => { allowed = true; }) : (allowed = true));
    return { req, res, allowed };
}

test('security proof: a demoted/suspended admin token still reads the user directory', async t => {
    environment(t);
    const actor = { id: 'former-admin', role: 'ADMIN', username: 'FormerAdmin', suspendedAt: null };
    const oldToken = signSessionToken(actor, true);
    actor.role = 'CUSTOMER'; actor.suspendedAt = new Date();
    const db = { user: { findUnique: async () => actor, count: async () => 1, findMany: async () => [{ id: 'victim', email: 'private@example.test' }] } };
    const { adminListUsers } = load(t, '../src/controllers/adminUserController', { '../src/prisma': db });
    const { createManagementAudit } = load(t, '../src/middleware/managementAudit', { '../src/prisma': db });
    const { req, res, allowed } = authenticate(oldToken, true);
    let auditPassed = false;
    createManagementAudit(db)(req, res, () => { auditPassed = true; });
    assert.equal(auditPassed, true); // This GET is outside the mutation audit list.
    assert.equal(allowed, true);
    await adminListUsers(req, res);
    assert.equal(res.statusCode, 200);
    assert.ok(res.body.items.some(user => user.email === 'private@example.test'));
    assert.equal(res.body.canManageExtraRoles, false);
});

test('security proof: password reset leaves an existing remembered token usable and renewable', async t => {
    environment(t);
    const account = { id: 'reset-owner', email: 'owner@example.test', role: 'CUSTOMER', passwordHash: 'old-hash', suspendedAt: null };
    const oldToken = signSessionToken(account, true);
    const record = { id: 'reset-record', userId: account.id, user: account, usedAt: null, expiresAt: new Date(Date.now() + 60000) };
    const db = { user: { findUnique: async () => account, update: async ({ data }) => Object.assign(account, data) },
        passwordResetToken: { findUnique: async () => record, update: async ({ data }) => Object.assign(record, data), deleteMany: async () => ({ count: 0 }) },
        $transaction: async values => Promise.all(values) };
    const { resetPassword } = load(t, '../src/controllers/authController', { '../src/prisma': db });
    const res = response();
    await resetPassword({ body: { token: 'synthetic-reset-token', password: 'NewPassword123!', confirmPassword: 'NewPassword123!' } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(await bcrypt.compare('NewPassword123!', account.passwordHash), true);
    assert.equal(authenticate(oldToken).allowed, true);
    const router = load(t, '../src/routes/authRoutes', { '../src/prisma': db });
    const activity = router.stack.find(layer => layer.route?.path === '/session/activity').route.stack;
    const refresh = response(), request = { user: jwt.verify(oldToken, process.env.JWT_SECRET) };
    await activity[1].handle(request, refresh);
    assert.equal(refresh.statusCode, 200);
    const claims = jwt.verify(refresh.body.token, process.env.JWT_SECRET);
    assert.equal(claims.exp - claims.iat, 30 * 86400);
    assert.equal(claims.userId, account.id);
});

test('security proof: a suspended account receives a fresh session from password reset', async t => {
    environment(t);
    const account = { id: 'suspended-owner', email: 'suspended@example.test', role: 'CUSTOMER', suspendedAt: new Date() };
    const record = { id: 'record', userId: account.id, user: account, expiresAt: new Date(Date.now() + 60000) };
    const db = { user: { update: async () => account }, passwordResetToken: { findUnique: async () => record, update: async () => ({}), deleteMany: async () => ({}) }, $transaction: async values => Promise.all(values) };
    const { resetPassword } = load(t, '../src/controllers/authController', { '../src/prisma': db });
    const res = response();
    await resetPassword({ body: { token: 'synthetic-reset-token', password: 'NewPassword123!', confirmPassword: 'NewPassword123!' } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(authenticate(res.body.token).allowed, true);
});

test('security proof: repeated failed logins and password-reset mail have no application throttle', async t => {
    environment(t, { APP_BASE_URL: 'https://app.example.test' });
    const account = { id: 'target', email: 'target@example.test', passwordHash: 'synthetic-hash' };
    let comparisons = 0, messages = 0, tokenWrites = 0;
    const db = { user: { findUnique: async () => account }, passwordResetToken: {
        deleteMany: async () => ({}), create: async () => { tokenWrites++; return {}; },
    } };
    const auth = load(t, '../src/controllers/authController', { '../src/prisma': db,
        bcrypt: { compare: async () => { comparisons++; return false; } },
        nodemailer: { createTransport: () => ({ sendMail: async () => { messages++; } }) },
    });
    for (let attempt = 0; attempt < 25; attempt++) {
        const login = response();
        await auth.loginUser({ body: { email: account.email, password: 'WrongPassword123!' } }, login);
        assert.equal(login.statusCode, 401);
        const reset = response();
        await auth.forgotPassword({ body: { email: account.email } }, reset);
        assert.equal(reset.statusCode, 200);
    }
    assert.equal(comparisons, 25);
    assert.equal(messages, 25);
    assert.equal(tokenWrites, 25);
});

test('security proof: OAuth linking an unverified pre-created account preserves the attacker password', async t => {
    environment(t);
    const knownPassword = 'AttackerKnows123!';
    let account;
    const links = [];
    const db = { user: {
        findUnique: async ({ where }) => account && (where.id === account.id || where.email === account.email) ? account : null,
        findFirst: async () => null,
        create: async ({ data }) => (account = { ...data, id: 'precreated-account', emailVerifiedAt: null, profile: { displayName: data.username } }),
        update: async ({ data }) => Object.assign(account, data),
    }, socialIdentity: {
        findUnique: async ({ where }) => links.find(link => where.userId_provider ? link.userId === where.userId_provider.userId && link.provider === where.userId_provider.provider : link.provider === where.provider_providerUserId.provider && link.providerUserId === where.provider_providerUserId.providerUserId) || null,
        create: async ({ data }) => { links.push(data); return data; },
    }, $transaction: async fn => fn(db) };
    const auth = load(t, '../src/controllers/authController', { '../src/prisma': db });
    const registered = response();
    await auth.registerUser({ body: { email: 'futurevictim@gmail.com', username: 'Precreated', password: knownPassword, termsAccepted: true } }, registered);
    assert.equal(registered.statusCode, 201);
    assert.equal(account.emailVerifiedAt, null); // Registration never proved email ownership.
    const social = load(t, '../src/controllers/socialAuthController', { '../src/prisma': db });
    const identity = { sub: 'victim-google-id', email: account.email, email_verified: true };
    await assert.rejects(social.resolveSocialUser(db, 'google', identity, { mode: 'login' }), error => error.code === 'SOCIAL_LINK_CONFIRMATION_REQUIRED');
    const secret = crypto.createHmac('sha256', process.env.JWT_SECRET).update('fastboost-social-signup').digest('hex');
    const linkToken = jwt.sign({ provider: 'google', identity, userId: account.id, origin: process.env.CLIENT_URL }, secret, { audience: 'fastboost-social-link-confirmation', expiresIn: '10m' });
    const confirmed = response();
    await social.confirmSocialLink({ headers: { origin: process.env.CLIENT_URL }, body: { linkToken, allow: true } }, confirmed);
    assert.equal(confirmed.statusCode, 200);
    assert.ok(confirmed.body.token);
    assert.ok(account.emailVerifiedAt);
    const attacker = response();
    await auth.loginUser({ body: { email: account.email, password: knownPassword } }, attacker);
    assert.equal(attacker.statusCode, 200);
    assert.equal(jwt.verify(attacker.body.token, process.env.JWT_SECRET).userId, confirmed.body.user.id);
});

function socketHarness(t) {
    let io;
    class FakeServer {
        constructor() { io = this; this.clients = []; }
        use(handler) { this.middleware = handler; }
        on(_event, handler) { this.connected = handler; }
        to(room) { return { emit: (event, message) => { for (const client of this.clients) if (client.rooms.has(room)) client.received.push({ event, message }); } }; }
    }
    let assigned = true;
    const db = { order: { findUnique: async () => ({ id: 'order', customerId: 'customer' }) },
        orderAssignment: { findFirst: async () => assigned ? { boosterId: 'booster' } : null },
        conversation: { findUnique: async () => ({ id: 'conversation', orderId: 'order' }), update: async () => ({}) },
        conversationParticipant: { upsert: async () => ({}), findUnique: async ({ where }) => where.conversationId_userId.userId === 'customer' || assigned ? {} : null },
        user: { findUnique: async ({ where }) => ({ id: where.id, role: 'CUSTOMER', suspendedAt: null }) },
        message: { findMany: async () => [{ id: 'old-message', content: 'private history' }], create: async ({ data }) => ({ ...data, id: 'new-message', createdAt: new Date() }) },
    };
    const { initSocket } = load(t, '../src/socket', { 'socket.io': { Server: FakeServer }, '../src/prisma': db,
        '../src/utils/chatNotifications': { createChatMessageNotifications: async () => {} } });
    initSocket({});
    function connect(user, expiresIn = 60) {
        const handlers = new Map();
        const client = { handshake: { auth: { token: jwt.sign(user, process.env.JWT_SECRET, { expiresIn }) } },
            handlers, rooms: new Set(), received: [], on: (name, callback) => handlers.set(name, callback), join(room) { this.rooms.add(room); } };
        io.middleware(client, error => assert.equal(error, undefined));
        io.clients.push(client); io.connected(client); return client;
    }
    return { connect, revoke() { assigned = false; } };
}

test('security proof: unassigned booster remains subscribed to new private chat messages', async t => {
    environment(t);
    const harness = socketHarness(t);
    const booster = harness.connect({ userId: 'booster', role: 'PROVIDER' });
    let joined;
    await booster.handlers.get('chat:join')({ orderId: 'order' }, result => { joined = result; });
    assert.equal(joined.ok, true);
    harness.revoke(); // Mirrors deletion of the order assignment and participant.
    let denied;
    await booster.handlers.get('chat:join')({ orderId: 'order' }, result => { denied = result; });
    assert.equal(denied.ok, false);
    const customer = harness.connect({ userId: 'customer', role: 'CUSTOMER' });
    let sent;
    await customer.handlers.get('chat:message')({ conversationId: 'conversation', content: 'new confidential data after removal' }, result => { sent = result; });
    assert.equal(sent.ok, true);
    assert.ok(booster.received.some(item => item.message.content === 'new confidential data after removal'));
});

test('security proof: socket joins continue to return private history after JWT expiry', async t => {
    environment(t);
    const harness = socketHarness(t);
    const customer = harness.connect({ userId: 'customer', role: 'CUSTOMER' }, 1);
    const now = Date.now();
    t.mock.method(Date, 'now', () => now + 60000);
    assert.throws(() => jwt.verify(customer.handshake.auth.token, process.env.JWT_SECRET), /expired/);
    let joined;
    await customer.handlers.get('chat:join')({ orderId: 'order' }, result => { joined = result; });
    assert.equal(joined.ok, true);
    assert.equal(joined.messages[0].content, 'private history');
});

test('security proof: a support PDF filename can store HTML and receive an inline HTML URL', async t => {
    const commands = [];
    class Command { constructor(input) { this.input = input; } }
    class FakeS3 { async send(command) { commands.push(command.input); } }
    const s3 = load(t, '../src/utils/s3Upload', { '@aws-sdk/client-s3': { S3Client: FakeS3, PutObjectCommand: Command, GetObjectCommand: Command },
        '@aws-sdk/s3-request-presigner': { getSignedUrl: async (_client, command) => { commands.push(command.input); return 'https://assets.example.test/synthetic-signed-url'; } } });
    const file = { originalname: 'invoice.pdf', mimetype: 'text/html', buffer: Buffer.from('<!doctype html><script>window.securityProof = true</script>'), size: 58 };
    const { validateMessage } = require('../src/utils/supportChat');
    assert.doesNotThrow(() => validateMessage({ clientId: 'synthetic-attachment-id' }, file));
    const uploaded = await s3.uploadChatAttachmentToS3({ conversationId: 'support-synthetic', userId: 'customer', file });
    await s3.createChatAttachmentSignedUrl({ key: uploaded.key, filename: file.originalname });
    assert.equal(commands[0].ContentType, 'text/html');
    assert.deepEqual(commands[0].Body, file.buffer);
    assert.match(commands[1].ResponseContentDisposition, /^inline;/);
    assert.equal(commands[1].ResponseContentType, undefined);
});
