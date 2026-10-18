const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { signSessionToken } = require('../src/utils/sessionToken');

test('activity renews live remembered sessions, applies current roles, and rejects revoked sessions', async t => {
    const paths = ['../src/prisma', '../src/routes/authRoutes', '../src/controllers/authController', '../src/controllers/socialAuthController'].map(p => require.resolve(p));
    const saved = paths.map(p => [p, require.cache[p]]);
    const previous = process.env.JWT_SECRET; process.env.JWT_SECRET = 'test-activity-secret';
    const user = { id: 'user', role: 'CUSTOMER', passwordHash: 'synthetic-password-hash', suspendedAt: null };
    let reads = 0, changeDuringRefresh = false;
    t.after(() => {
        for (const [path, value] of saved) { if (value) require.cache[path] = value; else delete require.cache[path]; }
        if (previous === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = previous;
    });
    require.cache[paths[0]] = { exports: { user: { findUnique: async () => {
        reads++;
        if (changeDuringRefresh && reads % 2 === 0) user.passwordHash = 'reset-after-protect';
        return { ...user };
    } } } };
    paths.slice(1).forEach(p => delete require.cache[p]);
    const stack = require(paths[1]).stack.find(layer => layer.route?.path === '/session/activity').route.stack;
    const send = async token => {
        reads = 0;
        const req = { headers: { authorization: `Bearer ${token}` } };
        const res = { code: 200, set() { return this; }, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
        await stack[0].handle(req, res, () => stack[1].handle(req, res));
        return res;
    };
    const token = signSessionToken({ ...user, role: 'ADMIN' }, true);
    const response = await send(token);
    assert.equal(response.code, 200);
    const renewed = jwt.decode(response.body.token);
    assert.equal(renewed.exp - renewed.iat, 30 * 86400);
    assert.equal(renewed.role, 'CUSTOMER');
    assert.equal((await send(signSessionToken(user))).body.token, undefined);
    assert.equal((await send(jwt.sign({ ...jwt.decode(token), exp: 1 }, process.env.JWT_SECRET))).code, 401);
    user.suspendedAt = new Date();
    assert.equal((await send(token)).code, 401);
    user.suspendedAt = null;
    changeDuringRefresh = true;
    assert.equal((await send(token)).code, 401, 'a password reset between authentication and renewal cannot mint a new session');
    changeDuringRefresh = false;
    assert.equal((await send(token)).code, 401, 'a pre-reset token cannot renew');
});
