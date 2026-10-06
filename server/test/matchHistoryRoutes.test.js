const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

test('history ownership, import deduplication, review revisions and complete earnings confirmation', async () => {
    const paths = ['../src/prisma', '../src/utils/riotMatches', '../src/routes/matchHistoryRoutes'].map(p => require.resolve(p));
    const saved = paths.map(p => [p, require.cache[p]]);
    let order = { id: 'order', customerId: 'customer', paymentStatus: 'PAID', status: 'IN_PROGRESS', amountCents: 10000,
        currency: 'cad', inGameName: 'Name#tag', region: 'North America', matchHistoryEnabled: true, matchHistoryRevision: 0,
        assignments: [{ boosterId: 'booster' }], contributions: [] };
    let matches = [], reviews = [], imports = 0, participantId = 'secret-puuid';
    let importedDetails = { selected: 0, players: [{ name: 'Player', tag: 'NA1', team: 100, championId: 103, kills: 7 }] };
    const db = {
        $queryRaw: async () => [],
        user: { findMany: async () => [{ id: 'booster', username: 'Player' }], findUnique: async ({ where }) => where.id === 'booster' ? { role: 'PROVIDER' } : null },
        order: { findUnique: async ({ where }) => where.id === order.id ? structuredClone(order) : null,
            update: async ({ data }) => { const revision = order.matchHistoryRevision + (data.matchHistoryRevision?.increment || 0); Object.assign(order, data, { matchHistoryRevision: revision }); } },
        orderMatch: {
            findMany: async () => structuredClone(matches),
            update: async ({ where, data }) => Object.assign(matches.find(m => m.id === where.id), data),
            createMany: async ({ data }) => { let count = 0; for (const m of data) if (!matches.some(v => v.externalId === m.externalId && v.participantId === m.participantId)) { matches.push({ ...m, id: 'match', status: 'PENDING', revision: 1 }); count++; } return { count }; },
            updateMany: async ({ where, data }) => { const m = matches.find(m => m.id === where.id && m.orderId === where.orderId && m.revision === where.revision); if (!m) return { count: 0 }; const revision = m.revision + 1; Object.assign(m, data, { revision }); return { count: 1 }; },
        },
        orderMatchReview: { create: async ({ data }) => { reviews.push(data); } },
    };
    db.$transaction = async fn => {
        const backup = structuredClone({ order, matches, reviews });
        try { return await fn(db); } catch (e) { ({ order, matches, reviews } = backup); throw e; }
    };
    let server;
    try {
        require.cache[paths[0]] = { exports: db };
        require.cache[paths[1]] = { exports: { configured: () => true, importSettings: () => ({}), importMatches: async () => { imports++; return { matches: [{ game: 'LOL', externalId: 'NA1_1', participantId, details: structuredClone(importedDetails), playedAt: new Date() }], nextStart: null }; } } };
        delete require.cache[paths[2]];
        const app = express(); app.use(express.json());
        app.use((req, res, next) => { const id = req.headers.authorization; if (!id) return res.sendStatus(401); req.actor = { id, role: id === 'admin' ? 'ADMIN' : id === 'customer' ? 'CUSTOMER' : 'PROVIDER' }; next(); });
        app.use(require(paths[2])); app.use((e, req, res, next) => res.status(e.status || 500).json({ message: e.message }));
        server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
        const request = (path, who, body) => fetch(`http://127.0.0.1:${server.address().port}/match-history/order${path}`, { method: body ? 'POST' : 'GET', headers: { ...(who ? { Authorization: who } : {}), 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
        assert.equal((await request('', '')).status, 401);
        assert.equal((await request('', 'foreign')).status, 404);
        assert.equal((await request('/import', 'customer', {})).status, 403);
        assert.equal((await request('/import', 'booster', {})).status, 200);
        assert.equal(imports, 1);
        assert.equal((await request('/import', 'booster', {})).status, 429);
        order.matchHistorySyncedAt = null;
        assert.equal((await request('/import', 'admin', {})).status, 200);
        assert.equal(matches.length, 1);
        assert.equal(order.matchHistoryRevision, 1, 'duplicate evidence must not invalidate reviews');
        participantId = 'rotated-app-puuid';
        importedDetails.players[0] = { ...importedDetails.players[0], kills: 99, summonerSpells: [4, 14], runes: [8112, 8200] };
        order.matchHistorySyncedAt = null;
        const rotatedImport = await request('/import', 'admin', {});
        assert.equal(rotatedImport.status, 200);
        assert.equal((await rotatedImport.json()).imported, 0, 'changing the API key must not duplicate the same game');
        assert.equal(matches.length, 1);
        assert.equal(matches[0].participantId, 'secret-puuid', 'original evidence and review identity are preserved');
        assert.equal(order.matchHistoryRevision, 1);
        assert.equal(matches[0].details.players[0].kills, 7, 'icon enrichment must preserve original review evidence');
        assert.deepEqual(matches[0].details.players[0].summonerSpells, [4, 14]);
        assert.deepEqual(matches[0].details.players[0].runes, [8112, 8200]);
        assert.equal(reviews.length, 0);
        const customerView = await (await request('', 'customer')).json();
        assert.equal(customerView.canReview, false);
        assert.equal(customerView.earnings, undefined);
        assert.equal((await request('/match/review', 'booster', { decision: 'APPROVED', revision: 1, boosterId: 'booster' })).status, 403);
        assert.equal((await request('/match/review', 'admin', { decision: 'APPROVED', revision: 1, boosterId: 'foreign' })).status, 400);
        assert.equal((await request('/match/review', 'admin', { decision: 'REJECTED', revision: 1 })).status, 400);
        assert.equal((await request('/confirm', 'admin', { revision: 1 })).status, 409, 'active orders cannot finalize');
        order.status = 'COMPLETED';
        assert.equal((await request('/confirm', 'admin', { revision: 1 })).status, 409, 'pending evidence cannot finalize');
        assert.equal((await request('/match/review', 'admin', { decision: 'APPROVED', revision: 1, boosterId: 'booster' })).status, 200);
        assert.equal(reviews.length, 1);
        assert.equal((await request('/match/review', 'admin', { decision: 'APPROVED', revision: 1, boosterId: 'booster' })).status, 409);
        assert.equal(reviews.length, 1, 'stale approval must not add an audit record');
        assert.equal((await request('/confirm', 'admin', { revision: 1 })).status, 409);
        assert.equal((await request('/confirm', 'admin', { revision: 2 })).status, 200);
        assert.equal((await (await request('', 'admin')).json()).earnings.shares[0].cents, 7000);
        assert.equal((await request('/import', 'admin', {})).status, 409);
        assert.equal((await request('/reopen', 'customer', { revision: 3 })).status, 403);
        assert.equal((await request('/reopen', 'admin', { revision: 3 })).status, 200);
        assert.deepEqual((await (await request('', 'admin')).json()).earnings.shares, []);
        order.matchHistoryEnabled = false;
        assert.equal((await request('/import', 'admin', {})).status, 409, 'legacy allocations remain on original flow');
    } finally {
        if (server) await new Promise(resolve => server.close(resolve));
        for (const [path, value] of saved) { if (value) require.cache[path] = value; else delete require.cache[path]; }
    }
});
