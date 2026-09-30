const test = require('node:test');
const assert = require('node:assert/strict');
const { existsSync } = require('node:fs');
const { resolve } = require('node:path');
const express = require('express');
const jwt = require('jsonwebtoken');

test('agreement HTML and PDF require a valid session and current admin or booster access', async () => {
    const dbPath = require.resolve('../src/prisma');
    const routePaths = ['operationsRoutes', 'contractRoutes', 'providerAgreementRoutes'].map(name => require.resolve(`../src/routes/${name}`));
    const saved = [dbPath, ...routePaths].map(path => [path, require.cache[path]]);
    const oldSecret = process.env.JWT_SECRET;
    process.env.JWT_SECRET = 'agreement-access-unit-test-only';
    const users = {
        admin: { id: 'admin', role: 'ADMIN' },
        booster: { id: 'booster', role: 'PROVIDER' },
        extraAccess: { id: 'extraAccess', role: 'CUSTOMER', hasBoosterAccess: true },
        customer: { id: 'customer', role: 'CUSTOMER' },
        suspended: { id: 'suspended', role: 'ADMIN', suspendedAt: new Date() },
    };
    let server;
    try {
        require.cache[dbPath] = { exports: { user: { findUnique: async ({ where }) => users[where.id] || null } } };
        routePaths.forEach(path => delete require.cache[path]);
        const app = express();
        app.use('/api/operations', require(routePaths[0]));
        server = await new Promise(resolve => { const value = app.listen(0, '127.0.0.1', () => resolve(value)); });
        const base = `http://127.0.0.1:${server.address().port}/api/operations/provider-agreement`;
        const token = (id, expiresIn = '1h') => jwt.sign({ userId: id, role: 'ADMIN', hasBoosterAccess: true }, process.env.JWT_SECRET, { expiresIn });
        const request = (suffix, auth) => fetch(base + suffix, { headers: auth ? { Authorization: `Bearer ${auth}` } : {} });
        for (const suffix of ['', '/document']) {
            for (const auth of [null, 'invalid', token('admin', -1)]) {
                const response = await request(suffix, auth);
                assert.equal(response.status, 401);
                assert.doesNotMatch(await response.text(), /Booster &amp; Service Provider|%PDF/);
            }
            for (const id of ['customer', 'suspended', 'missing']) {
                const response = await request(suffix, token(id));
                assert.equal(response.status, 403, `${id} cannot access ${suffix || 'HTML'} even with stale admin claims`);
                assert.doesNotMatch(await response.text(), /Booster &amp; Service Provider|%PDF/);
            }
            for (const id of ['admin', 'booster', 'extraAccess']) {
                const response = await request(suffix, token(id));
                assert.equal(response.status, 200);
                assert.match(response.headers.get('cache-control'), /no-store/);
                if (suffix) {
                    assert.match(response.headers.get('content-type'), /application\/pdf/);
                    assert.equal(Buffer.from(await response.arrayBuffer()).subarray(0, 5).toString(), '%PDF-');
                } else assert.match((await response.json()).html, /Booster &amp; Service Provider Agreement/);
            }
        }
        users.extraAccess.hasBoosterAccess = false;
        assert.equal((await request('', token('extraAccess'))).status, 403, 'revoked access is read from the database');
        for (const name of ['provider-agreement.html', 'provider-agreement-review.pdf']) {
            assert.equal(existsSync(resolve(__dirname, '../../client/public/legal', name)), false, `${name} must not be a public asset`);
        }
    } finally {
        if (server) await new Promise(resolve => server.close(resolve));
        if (oldSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = oldSecret;
        for (const [path, entry] of saved) { if (entry) require.cache[path] = entry; else delete require.cache[path]; }
    }
});
