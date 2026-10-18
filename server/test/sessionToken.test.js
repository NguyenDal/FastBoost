const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { signSessionToken, verifySessionToken } = require('../src/utils/sessionToken');
test('remembered sessions last thirty days; regular sessions retain three days', () => {
    const previous = process.env.JWT_SECRET; process.env.JWT_SECRET = 'test-session-secret';
    try {
        for (const rememberMe of [true, false]) {
            const token = signSessionToken({ id: 'test', role: 'PROVIDER' }, rememberMe);
            const claims = jwt.decode(token);
            assert.equal(claims.exp - claims.iat, (rememberMe ? 30 : 3) * 86400);
            assert.equal(claims.rememberMe, rememberMe);
            assert.throws(() => jwt.verify(token, process.env.JWT_SECRET, { clockTimestamp: claims.exp }), /expired/);
            assert.equal(jwt.verify(token, process.env.JWT_SECRET, { clockTimestamp: claims.exp - 1 }).userId, 'test');
        }
    } finally { if (previous === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = previous; }
});

test('session verification rejects legacy, cross-purpose, non-expiring and password-revoked tokens before access', async t => {
    const previous = process.env.JWT_SECRET; process.env.JWT_SECRET = 'test-session-secret';
    t.after(() => { if (previous === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = previous; });
    const user = { id: 'owner', passwordHash: 'synthetic-private-hash', role: 'CUSTOMER', hasBoosterAccess: false };
    let reads = 0;
    const db = { user: { findUnique: async () => { reads++; return user; } } };
    const token = signSessionToken({ ...user, role: 'ADMIN', hasBoosterAccess: true }, true);
    const claims = jwt.decode(token);
    assert.doesNotMatch(JSON.stringify(claims), /synthetic-private-hash/);
    const fresh = await verifySessionToken(token, { db });
    assert.equal(fresh.role, 'CUSTOMER'); assert.equal(fresh.hasBoosterAccess, false);
    for (const invalid of [jwt.sign({ userId: user.id }, process.env.JWT_SECRET),
        jwt.sign({ ...claims, aud: 'fastboost-oauth-state' }, process.env.JWT_SECRET),
        jwt.sign(Object.fromEntries(Object.entries(claims).filter(([key]) => key !== 'exp')), process.env.JWT_SECRET),
        jwt.sign(claims, process.env.JWT_SECRET, { algorithm: 'HS384' }), 'x'.repeat(8193)]) {
        const before = reads;
        await assert.rejects(verifySessionToken(invalid, { db }));
        assert.equal(reads, before, 'invalid token shape or purpose must not reach account lookup');
    }
    user.passwordHash = 'replacement-hash';
    await assert.rejects(verifySessionToken(token, { db }), /no longer available/);
});

test('authentication fails closed during account-store errors without treating a live token as expired', async t => {
    const previous = process.env.JWT_SECRET; process.env.JWT_SECRET = 'test-session-secret';
    t.after(() => { if (previous === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = previous; });
    const { createProtect } = require('../src/middleware/authMiddleware');
    const token = signSessionToken({ id: 'owner', passwordHash: 'synthetic-hash' });
    const db = { user: { findUnique: async () => { throw new Error('synthetic database outage'); } } };
    const res = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
    await createProtect(db)({ headers: { authorization: `Bearer ${token}` } }, res, () => assert.fail('Unavailable authentication must block access'));
    assert.equal(res.code, 503);
    assert.doesNotMatch(res.body.message, /expired|synthetic/);
});
