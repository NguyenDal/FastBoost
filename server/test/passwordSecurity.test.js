const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { signSessionToken, verifySessionToken } = require('../src/utils/sessionToken');

function controller(t, db, file = 'userController') {
    const paths = [`../src/controllers/${file}`, '../src/prisma', '../src/utils/s3Upload'].map(require.resolve);
    const saved = paths.map(path => [path, require.cache[path]]);
    delete require.cache[paths[0]];
    require.cache[paths[1]] = { exports: db, loaded: true };
    require.cache[paths[2]] = { exports: {}, loaded: true };
    t.after(() => { for (const [path, value] of saved) { if (value) require.cache[path] = value; else delete require.cache[path]; } });
    return require(paths[0]);
}
function environment(t) {
    const previous = process.env.JWT_SECRET; process.env.JWT_SECRET = 'password-security-test-secret';
    t.after(() => { if (previous === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = previous; });
}
const response = () => ({ code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });

test('password change invalidates previous sessions/reset links and returns a replacement with the same remember preference', async t => {
    environment(t);
    const user = { id: 'owner', role: 'CUSTOMER', passwordHash: await bcrypt.hash('OldPassword123!', 4), suspendedAt: null };
    let deleted = 0;
    const db = { user: {
        findUnique: async () => ({ ...user }),
        updateMany: async ({ where, data }) => {
            if (where.passwordHash !== user.passwordHash || user.suspendedAt) return { count: 0 };
            Object.assign(user, data); return { count: 1 };
        },
    }, passwordResetToken: { deleteMany: async () => { deleted++; return { count: 1 }; } } };
    db.$transaction = fn => fn(db);
    const oldToken = signSessionToken(user, true);
    const auth = controller(t, db), res = response();
    await auth.changeMyPassword({ user: jwt.decode(oldToken), body: {
        currentPassword: 'OldPassword123!', newPassword: 'NewPassword123!', confirmPassword: 'NewPassword123!',
    } }, res);
    assert.equal(res.code, 200); assert.equal(deleted, 1);
    assert.equal(await bcrypt.compare('NewPassword123!', user.passwordHash), true);
    await assert.rejects(verifySessionToken(oldToken, { db }));
    assert.equal((await verifySessionToken(res.body.token, { db })).rememberMe, true);
});

test('a password reset that wins a concurrent race cannot be overwritten using the earlier password', async t => {
    environment(t);
    const originalHash = await bcrypt.hash('OldPassword123!', 4);
    const user = { id: 'owner', role: 'CUSTOMER', passwordHash: originalHash, suspendedAt: null };
    const db = { user: {
        findUnique: async () => ({ ...user }),
        updateMany: async ({ where }) => {
            assert.equal(where.passwordHash, originalHash);
            user.passwordHash = 'hash-from-concurrent-reset'; return { count: 0 };
        },
    }, passwordResetToken: { deleteMany: async () => assert.fail('A failed change must not delete reset links') } };
    db.$transaction = fn => fn(db);
    const auth = controller(t, db), res = response();
    await auth.changeMyPassword({ user: { userId: user.id }, body: {
        currentPassword: 'OldPassword123!', newPassword: 'NewPassword123!', confirmPassword: 'NewPassword123!',
    } }, res);
    assert.equal(res.code, 409); assert.equal(res.body.token, undefined);
    assert.equal(user.passwordHash, 'hash-from-concurrent-reset');
});

test('password updates reject UTF-8 passwords whose bcrypt prefix would collide', async t => {
    environment(t);
    const auth = controller(t, { user: { findUnique: async () => assert.fail('Invalid passwords must not reach database work') } });
    const password = 'Aa1!' + '😀'.repeat(18); // 40 UTF-16 units but 76 UTF-8 bytes.
    const res = response();
    await auth.changeMyPassword({ user: { userId: 'owner' }, body: { currentPassword: 'OldPassword123!', newPassword: password, confirmPassword: password } }, res);
    assert.equal(res.code, 400); assert.equal(res.body.field, 'newPassword');
});

test('changing the account email invalidates recovery links and verification codes sent to the previous address', async t => {
    environment(t);
    const user = { id: 'owner', role: 'CUSTOMER', username: 'Owner', email: 'old@example.test', passwordHash: 'synthetic-hash', emailVerifiedAt: new Date(), suspendedAt: null };
    let resetLinks = 1, codes = 1;
    const db = { user: {
        findFirst: async () => null,
        findUnique: async () => ({ ...user }),
        updateMany: async ({ where }) => {
            assert.equal(where.email, 'old@example.test'); assert.equal(where.passwordHash, user.passwordHash);
            return { count: 1 };
        },
        update: async ({ data }) => { Object.assign(user, data); return { ...user, profile: null }; },
    }, passwordResetToken: {
        deleteMany: async () => { resetLinks = 0; return { count: 1 }; },
        findUnique: async () => { assert.equal(resetLinks, 0); return null; },
    }, verificationCode: { deleteMany: async ({ where }) => { assert.equal(where.type, 'EMAIL'); codes = 0; return { count: 1 }; } } };
    db.$transaction = fn => fn(db);
    const settings = controller(t, db), res = response();
    await settings.updateMyAccount({ user: { userId: user.id }, body: { username: 'Owner', email: 'new@example.test' } }, res);
    assert.equal(res.code, 200); assert.equal(user.email, 'new@example.test'); assert.equal(user.emailVerifiedAt, null);
    assert.equal(resetLinks, 0); assert.equal(codes, 0);
    const auth = controller(t, db, 'authController'), oldReset = response();
    await auth.resetPassword({ body: { token: 'link-from-old-mailbox', password: 'NewPassword123!', confirmPassword: 'NewPassword123!' } }, oldReset);
    assert.equal(oldReset.code, 400); assert.equal(oldReset.body.token, undefined);
});

test('a concurrent email change prevents a reset email from being issued to the earlier mailbox', async t => {
    environment(t);
    const db = { user: { findUnique: async () => ({ id: 'owner', email: 'old@example.test', passwordHash: 'synthetic-hash' }),
        updateMany: async ({ where }) => { assert.equal(where.email, 'old@example.test'); return { count: 0 }; } },
        passwordResetToken: { create: async () => assert.fail('The stale mailbox must not receive a new reset token'), deleteMany: async () => assert.fail('The current mailbox reset link must remain usable') } };
    db.$transaction = fn => fn(db);
    const auth = controller(t, db, 'authController'), res = response();
    await auth.forgotPassword({ body: { email: 'old@example.test' } }, res);
    assert.equal(res.code, 200); assert.equal(res.body.ok, true);
});
