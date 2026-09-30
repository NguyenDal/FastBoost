const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { signSessionToken } = require('../src/utils/sessionToken');
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
