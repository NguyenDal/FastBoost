const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
test('activity renews only live remembered sessions with the current active account', async () => {
    const paths = ['../src/prisma', '../src/routes/authRoutes', '../src/controllers/authController', '../src/controllers/socialAuthController'].map(p => require.resolve(p));
    const saved = paths.map(p => [p, require.cache[p]]);
    const previous = process.env.JWT_SECRET; process.env.JWT_SECRET = 'test-activity-secret';
    let suspended = false, server;
    try {
        require.cache[paths[0]] = { exports: { user: { findUnique: async () => ({ id: 'user', role: 'CUSTOMER', suspendedAt: suspended ? new Date() : null }) } } };
        paths.slice(1).forEach(p => delete require.cache[p]);
        const app = express(); app.use(express.json()); app.use(require(paths[1]));
        server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
        const send = async (rememberMe, expiresIn = 60) => {
            const token = jwt.sign({ userId: 'user', rememberMe, role: 'ADMIN' }, process.env.JWT_SECRET, { expiresIn });
            return fetch(`http://127.0.0.1:${server.address().port}/session/activity`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
        };
        let response = await send(true);
        const renewed = jwt.decode((await response.json()).token);
        assert.equal(renewed.exp - renewed.iat, 30 * 86400);
        assert.equal(renewed.role, 'CUSTOMER');
        assert.equal((await (await send(false)).json()).token, undefined);
        assert.equal((await send(true, -1)).status, 401);
        suspended = true;
        assert.equal((await send(true)).status, 401);
    } finally {
        if (server) await new Promise(resolve => server.close(resolve));
        for (const [path, value] of saved) { if (value) require.cache[path] = value; else delete require.cache[path]; }
        if (previous === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = previous;
    }
});
