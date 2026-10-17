const test = require('node:test');
const assert = require('node:assert/strict');

function fixture(t, status = 'IN_PROGRESS') {
    const state = {
        order: { id: 'synthetic-order', customerId: 'customer', paymentStatus: 'PAID', status,
            amountCents: 10000, currency: 'usd', boostType: 'Rank Boost', queueType: 'Solo/Duo',
            inGameName: 'Sample#TEST', region: 'North America', matchHistoryEnabled: true,
            matchHistoryRevision: 1, matchHistoryConfirmedAt: null, matchHistorySyncedAt: null,
            assignments: [{ boosterId: 'booster' }], contributions: [] },
        matches: [{ id: 'saved', orderId: 'synthetic-order', game: 'LOL', externalId: 'NA1_1',
            details: { queueId: 420, players: [{ name: 'Sample', tag: 'TEST', team: 100, championId: 103, damageTaken: 100 }] },
            playedAt: new Date('2026-10-15T12:00:00Z'), status: 'APPROVED', boosterId: 'booster', revision: 2 }],
        imports: 0, locks: 0, orderWrites: 0, matchWrites: 0, closeDuringImport: null,
    };
    let inTransaction = false, locked = false;
    const db = {
        $queryRaw: async () => { assert.equal(inTransaction, true); locked = true; state.locks++; return []; },
        order: {
            findUnique: async () => {
                if (inTransaction) assert.equal(locked, true, 'read the current status only after the order row lock');
                return structuredClone(state.order);
            },
            update: async ({ data }) => {
                assert.equal(locked, true); state.orderWrites++;
                const revision = state.order.matchHistoryRevision + (data.matchHistoryRevision?.increment || 0);
                Object.assign(state.order, data, { matchHistoryRevision: revision });
                return structuredClone(state.order);
            },
        },
        orderMatch: {
            findMany: async () => structuredClone(state.matches),
            update: async ({ where, data }) => { state.matchWrites++; Object.assign(state.matches.find(match => match.id === where.id), data); },
            createMany: async ({ data }) => {
                assert.equal(locked, true); state.matchWrites++;
                state.matches.push(...data.map((match, index) => ({ ...match, id: `new-${index}`, status: 'PENDING', revision: 1 })));
                return { count: data.length };
            },
        },
        user: { findMany: async () => [{ id: 'booster', username: 'Sample' }] },
    };
    db.$transaction = async callback => {
        const before = structuredClone({ order: state.order, matches: state.matches });
        inTransaction = true; locked = false;
        try { return await callback(db); }
        catch (error) { Object.assign(state, before); throw error; }
        finally { inTransaction = false; locked = false; }
    };
    const replacements = new Map([
        [require.resolve('../src/prisma'), db],
        [require.resolve('../src/utils/boosterEarningsLedger'), { withEarningsLedgerMutation: async (tx, id, callback) => callback() }],
        [require.resolve('../src/utils/riotMatches'), {
            configured: () => true, importSettings: () => ({}),
            importMatches: async () => {
                assert.equal(inTransaction, false, 'Riot requests must not hold a database lock');
                state.imports++;
                if (state.closeDuringImport) state.order.status = state.closeDuringImport;
                return { matches: [
                    { ...structuredClone(state.matches[0]), details: { queueId: 420, players: [{ name: 'Sample', tag: 'TEST', team: 100, championId: 103, summonerSpells: [4, 14], runes: [8112, 8200] }] } },
                    { game: 'LOL', externalId: 'NA1_2', participantId: 'synthetic-player', playedAt: new Date(), details: { queueId: 420 } },
                ], nextStart: null };
            },
        }],
    ]);
    const routePath = require.resolve('../src/routes/matchHistoryRoutes');
    const saved = new Map([[routePath, require.cache[routePath]]]);
    for (const [path, exports] of replacements) {
        saved.set(path, require.cache[path]);
        require.cache[path] = { id: path, filename: path, loaded: true, exports };
    }
    delete require.cache[routePath];
    const router = require(routePath);
    t.after(() => {
        for (const [path, value] of saved) { if (value) require.cache[path] = value; else delete require.cache[path]; }
    });
    return { state, async request(method, suffix = '', actorId = 'admin') {
        const route = router.stack.find(layer => layer.route?.path === `/match-history/:orderId${suffix}` && layer.route.methods[method]);
        assert.ok(route, 'exercise the actual route handler without a database, HTTP listener, or Riot connection');
        const req = { actor: { id: actorId, role: actorId === 'admin' ? 'ADMIN' : actorId === 'customer' ? 'CUSTOMER' : 'PROVIDER' },
            params: { orderId: state.order.id }, body: {} };
        const res = { status: 200, json(body) { this.body = body; return this; } };
        await route.route.stack[0].handle(req, res, error => { res.status = error.status || 500; res.body = { message: error.message }; });
        return res;
    } };
}

for (const status of ['COMPLETED', 'CANCELLED']) {
    test(`${status} rejects new imports before Riot or sync writes and keeps saved history readable`, async t => {
        const { state, request } = fixture(t, status);
        for (const actor of ['admin', 'booster']) {
            const response = await request('post', '/import', actor);
            assert.equal(response.status, 409);
            assert.match(response.body.message, /ongoing/);
            const history = await request('get', '', actor);
            assert.equal(history.status, 200);
            assert.equal(history.body.canImport, false);
            assert.equal(history.body.matches[0].id, 'saved');
            if (actor === 'admin') {
                assert.equal(history.body.canReview, status === 'COMPLETED');
                assert.equal(history.body.canConfirm, status === 'COMPLETED');
            } else assert.equal(history.body.canSubmit, status === 'COMPLETED');
        }
        const customer = await request('get', '', 'customer');
        assert.equal(customer.status, 200);
        assert.equal(customer.body.matches[0].id, 'saved');
        assert.equal(customer.body.canImport, false);
        assert.equal((await request('post', '/import', 'customer')).status, 403);
        assert.equal(state.imports, 0);
        assert.equal(state.orderWrites, 0);
        assert.equal(state.matchWrites, 0);
        if (status === 'COMPLETED') {
            state.order.matchHistoryConfirmedAt = new Date();
            const confirmed = await request('get');
            assert.equal(confirmed.body.canReopen, true);
            assert.equal(confirmed.body.earnings.shares[0].cents, 7000);
        }
    });

    test(`an order becoming ${status} during Riot fetch discards new matches and detail enrichment`, async t => {
        const { state, request } = fixture(t);
        const savedMatches = structuredClone(state.matches);
        state.closeDuringImport = status;
        const response = await request('post', '/import');
        assert.equal(response.status, 409);
        assert.match(response.body.message, /ongoing/);
        assert.equal(state.imports, 1);
        assert.equal(state.locks, 2, 'eligibility is re-read under the post-fetch order lock');
        assert.equal(state.order.status, status);
        assert.equal(state.orderWrites, 1, 'only the pre-fetch rate-limit reservation was saved');
        assert.equal(state.matchWrites, 0);
        assert.deepEqual(state.matches, savedMatches);
        assert.equal(state.order.matchHistoryRevision, 1);
    });
}

for (const status of ['PENDING', 'IN_PROGRESS']) {
    test(`paid ${status} orders retain the existing import workflow`, async t => {
        const { state, request } = fixture(t, status);
        assert.equal((await request('get')).body.canImport, true);
        const response = await request('post', '/import');
        assert.equal(response.status, 200);
        assert.equal(response.body.imported, 1);
        assert.equal(state.imports, 1);
        assert.equal(state.locks, 2);
        assert.equal(state.matches.length, 2);
        assert.equal(state.order.matchHistoryRevision, 2);
    });
}
