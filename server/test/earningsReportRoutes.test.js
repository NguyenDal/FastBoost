const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

test('admin report is read-only, keeps missing amounts, and preserves provider earnings contracts', async () => {
    const paths = ['../src/prisma', '../src/middleware/authMiddleware', '../src/routes/operationsRoutes',
        '../src/routes/contractRoutes', '../src/routes/matchHistoryRoutes', '../src/routes/providerAgreementRoutes'].map(path => require.resolve(path));
    const saved = paths.map(path => [path, require.cache[path]]);
    const booster = { id: 'booster', username: 'TestBooster', role: 'PROVIDER', profile: { displayName: 'Test Booster' } };
    const source = [{ id: 'known', currency: 'cad', amountCents: 1000, goldDiscountCents: 0, paidAt: new Date('2026-09-02'),
        contributions: [{ boosterId: booster.id, booster, submittedMatches: 1, approvedMatches: 1, revision: 3 }], assignments: [], matches: [] },
    { id: 'unknown', currency: 'cad', amountCents: null, paidAt: null, contributions: [], assignments: [], matches: [] }];
    let earningsReads = 0;
    const db = {
        user: { findUnique: async ({ where }) => where.id === 'admin' ? { id: 'admin', role: 'ADMIN' } : booster, findMany: async () => [booster] },
        order: { findMany: async query => {
            earningsReads++;
            assert.deepEqual(query.where, { paymentStatus: 'PAID', status: 'COMPLETED' });
            assert.deepEqual(query.orderBy, [{ paidAt: 'desc' }, { id: 'desc' }]);
            for (const relation of [query.select.assignments.select.booster, query.select.matches.select.booster, query.select.contributions.include.booster]) {
                assert.deepEqual(relation.select, { id: true, username: true, profile: { select: { displayName: true } } });
            }
            return source;
        } },
        boosterProfile: { findUnique: async () => null }, boosterContract: { findMany: async () => [] },
    };
    let server;
    try {
        require.cache[paths[0]] = { exports: db };
        require.cache[paths[1]] = { exports: { protect: (req, res, next) => {
            if (!req.headers.authorization) return res.sendStatus(401);
            req.user = { userId: req.headers.authorization }; next();
        } } };
        for (const path of paths.slice(3)) require.cache[path] = { exports: express.Router() };
        delete require.cache[paths[2]];
        const app = express(); app.use(require(paths[2]));
        server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
        const request = (path, actor) => fetch(`http://127.0.0.1:${server.address().port}${path}`, { headers: actor ? { Authorization: actor } : {} });
        assert.equal((await request('/earnings')).status, 401);
        assert.equal((await request('/earnings', 'booster')).status, 403);
        assert.equal(earningsReads, 0);
        const response = await request('/earnings', 'admin');
        assert.equal(response.status, 200);
        assert.equal(response.headers.get('cache-control'), 'no-store');
        const report = await response.json();
        assert.equal(report.ok, true);
        assert.equal(report.rows.length, 2);
        assert.equal(report.boosterDirectory[0].username, 'TestBooster');
        assert.equal(report.missingAmounts, 1);
        assert.equal(report.rows[0].reviewMode, 'contributions');
        assert.equal(report.rows[0].contributions[0].revision, 3);
        assert.equal(report.rows[0].contributions[0].booster.username, 'TestBooster');
        assert.equal(report.rows[1].revenueCents, null);
        assert.equal(report.rows[1].paidAt, null);
        assert.equal(Object.hasOwn(report.rows[0], 'matches'), false);
        assert.equal(Object.hasOwn(report.rows[0], 'assignments'), false);
        assert.deepEqual((await (await request('/me', 'booster')).json()).earnings, { CAD: 700 });
        assert.deepEqual((await (await request('/boosters', 'admin')).json()).boosters[0].earnings, { CAD: 700 });
        assert.equal(earningsReads, 3);
    } finally {
        if (server) await new Promise(resolve => server.close(resolve));
        for (const [path, value] of saved) { if (value) require.cache[path] = value; else delete require.cache[path]; }
    }
});
