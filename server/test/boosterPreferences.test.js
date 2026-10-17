const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { validatePreferences, missingPreferencesTable, loadPreferences } = require('../src/utils/boosterPreferences');

const empty = { firstRole: null, secondRole: null, championIds: [] };
const chosen = { firstRole: 'Middle', secondRole: 'Fill', championIds: ['Ahri', 'MonkeyKing', 'KSante'] };
const missing = () => Object.assign(new Error('relation "public.BoosterPreferences" does not exist'), {
    code: 'P2021', meta: { table: 'public.BoosterPreferences' },
});

test('preference validation bounds IDs, roles, counts, and writable fields', () => {
    assert.deepEqual(validatePreferences(chosen), chosen);
    assert.deepEqual(validatePreferences(empty), empty);
    assert.deepEqual(validatePreferences({ ...chosen, secondRole: 'Support' }).secondRole, 'Support');
    for (const invalid of [null, [], {}, { ...chosen, userId: 'other' }, { ...chosen, firstRole: 'Fill' },
        { ...chosen, firstRole: 'middle' }, { ...chosen, secondRole: 'Middle' }, { ...chosen, secondRole: 'unknown' },
        { ...chosen, firstRole: null }, { ...chosen, championIds: ['Ahri', 'Ahri'] },
        { ...chosen, championIds: ['Ahri', 'Akali', 'Annie', 'Ashe', 'Bard', 'Garen'] },
        { ...chosen, championIds: 'Ahri' }, { ...chosen, championIds: [123] },
        { ...chosen, championIds: ['../../private'] }, { ...chosen, championIds: ['https://evil.test/Ahri'] },
        { ...chosen, championIds: ['<script>'] }, { ...chosen, championIds: ['A'.repeat(33)] },
        { ...chosen, championIds: [''] }, { ...chosen, championIds: [' Ahri '] }]) {
        assert.throws(() => validatePreferences(invalid), error => error.status === 400);
    }
});

test('only a missing preference table is treated as staged unavailability', async () => {
    assert.equal(missingPreferencesTable(missing()), true);
    assert.equal(missingPreferencesTable({ code: 'P2021', meta: { table: 'public.User' } }), false);
    assert.equal(missingPreferencesTable({ code: 'P2022', meta: { table: 'public.BoosterPreferences' } }), false);
    assert.equal(missingPreferencesTable({ code: 'P2010', meta: { driverAdapterError: { cause: {
        originalCode: '42P01', originalMessage: 'relation "BoosterPreferences" does not exist',
    } } } }), true);
    assert.deepEqual(await loadPreferences({ boosterPreferences: { findUnique: async () => { throw missing(); } } }, 'booster'), {
        preferences: empty, preferencesAvailable: false,
    });
    const unrelated = Object.assign(new Error('connection lost'), { code: 'P1001' });
    await assert.rejects(loadPreferences({ boosterPreferences: { findUnique: async () => { throw unrelated; } } }, 'booster'), unrelated);
});

test('preferences remain self-scoped, while the admin directory batches saved roles and champions', async () => {
    const paths = ['../src/prisma', '../src/middleware/authMiddleware', '../src/routes/operationsRoutes',
        '../src/routes/contractRoutes', '../src/routes/matchHistoryRoutes', '../src/routes/providerAgreementRoutes',
        '../src/utils/boosterEarnings', '../src/utils/orderRatings'].map(path => require.resolve(path));
    const saved = paths.map(path => [path, require.cache[path]]);
    const rows = new Map();
    const state = { writes: 0, error: null, batchReads: 0, singleReads: 0, listReads: 0, emptyDirectory: false };
    const users = {
        booster: { id: 'booster', role: 'PROVIDER' }, other: { id: 'other', role: 'PROVIDER' },
        access: { id: 'access', role: 'CUSTOMER', hasBoosterAccess: true },
        customer: { id: 'customer', role: 'CUSTOMER' }, admin: { id: 'admin', role: 'ADMIN' },
        suspended: { id: 'suspended', role: 'PROVIDER', suspendedAt: new Date() },
    };
    const db = {
        user: {
            findUnique: async ({ where }) => users[where.id] || null,
            findMany: async ({ where }) => {
                state.listReads++;
                assert.deepEqual(where, { OR: [{ role: 'PROVIDER' }, { hasBoosterAccess: true }] });
                return state.emptyDirectory ? [] : [users.booster, users.other, users.access];
            },
        },
        boosterProfile: { findUnique: async () => null }, boosterContract: { findMany: async () => [] },
        boosterPreferences: {
            findUnique: async ({ where, select }) => {
                state.singleReads++;
                assert.deepEqual(select, { firstRole: true, secondRole: true, championIds: true });
                if (state.error) throw state.error;
                return rows.get(where.userId) || null;
            },
            findMany: async ({ where, select }) => {
                state.batchReads++;
                assert.deepEqual(where, { userId: { in: ['booster', 'other', 'access'] } });
                assert.deepEqual(select, { userId: true, firstRole: true, secondRole: true, championIds: true });
                if (state.error) throw state.error;
                // Deliberately change row order to prove directory preferences
                // are associated by user ID rather than response position.
                return [...rows].reverse().map(([userId, preferences]) => ({ userId, ...preferences }));
            },
            upsert: async ({ where, create, update, select }) => {
                if (state.error) throw state.error;
                assert.equal(create.userId, where.userId);
                assert.deepEqual(select, { firstRole: true, secondRole: true, championIds: true });
                const data = rows.has(where.userId) ? update : create;
                const preferences = { firstRole: data.firstRole, secondRole: data.secondRole, championIds: data.championIds };
                rows.set(where.userId, preferences); state.writes++;
                return preferences;
            },
        },
    };
    let server;
    try {
        require.cache[paths[0]] = { exports: db };
        require.cache[paths[1]] = { exports: { protect: (req, res, next) => {
            if (!req.headers.authorization) return res.sendStatus(401);
            // Deliberately stale token claims: routes must use current DB access.
            req.user = { userId: req.headers.authorization, role: 'PROVIDER' }; next();
        } } };
        for (const path of paths.slice(3, 6)) require.cache[path] = { exports: express.Router() };
        require.cache[paths[6]] = { exports: { boosterEarnings: async () => ({}) } };
        require.cache[paths[7]] = { exports: {
            boosterRating: async () => ({ average: null, count: 0, available: true }),
            boosterRatings: async (db, ids) => new Map(ids.map(id => [id, { average: null, count: 0, available: true }])),
        } };
        delete require.cache[paths[2]];
        const app = express(); app.use(express.json()); app.use(require(paths[2]));
        server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
        const request = (actor, body, path = '/me/preferences') => fetch(`http://127.0.0.1:${server.address().port}${path}`, {
            method: body === undefined ? 'GET' : 'PATCH',
            headers: { ...(actor ? { Authorization: actor } : {}), 'Content-Type': 'application/json' },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        assert.equal((await request(null, chosen)).status, 401);
        assert.equal((await request(null, undefined, '/boosters')).status, 401);
        for (const actor of ['customer', 'admin', 'suspended', 'deleted']) {
            assert.equal((await request(actor, chosen)).status, 403);
            assert.equal((await request(actor, undefined, '/me')).status, 403);
        }
        assert.equal(state.writes, 0);
        for (const actor of ['booster', 'access', 'customer', 'suspended', 'deleted']) {
            assert.equal((await request(actor, undefined, '/boosters')).status, 403);
        }
        assert.equal(state.listReads, 0, 'unauthorized callers cannot read the directory');
        assert.equal(state.batchReads, 0, 'unauthorized callers cannot read anyone\'s preferences');
        const initial = await (await request('booster', undefined, '/me')).json();
        assert.deepEqual(initial.preferences, empty);
        assert.equal(initial.preferencesAvailable, true);
        const savedResponse = await request('booster', chosen, '/me/preferences?userId=other');
        assert.equal(savedResponse.status, 200);
        assert.equal(savedResponse.headers.get('cache-control'), 'no-store');
        assert.deepEqual(await savedResponse.json(), { ok: true, preferences: chosen, preferencesAvailable: true });
        assert.deepEqual(rows.get('booster'), chosen);
        assert.equal(rows.has('other'), false, 'query IDs cannot redirect the self update');
        assert.deepEqual((await (await request('booster', undefined, '/me')).json()).preferences, chosen);
        assert.deepEqual((await (await request('other', undefined, '/me')).json()).preferences, empty);
        assert.equal((await request('booster', { ...chosen, userId: 'other' })).status, 400);
        assert.equal((await request('booster', { ...chosen, startedAt: '2000-01-01' })).status, 400);
        assert.equal(state.writes, 1, 'unrecognized writable fields cannot mutate accounts or tenure');
        const accessPreferences = { firstRole: 'Support', secondRole: 'Bottom', championIds: ['Bard', 'Thresh'] };
        assert.equal((await request('access', accessPreferences)).status, 200);
        const singleReadsBeforeDirectory = state.singleReads;
        const directoryResponse = await request('admin', undefined, '/boosters');
        assert.equal(directoryResponse.status, 200);
        assert.equal(directoryResponse.headers.get('cache-control'), 'no-store');
        const directory = await directoryResponse.json();
        assert.equal(directory.preferencesAvailable, true);
        assert.deepEqual(directory.boosters.map(user => [user.id, user.preferences]), [
            ['booster', chosen], ['other', empty], ['access', accessPreferences],
        ]);
        assert.equal(state.batchReads, 1, 'one batch fetch serves every booster');
        assert.equal(state.singleReads, singleReadsBeforeDirectory, 'the directory has no per-booster preference lookups');
        assert.equal(state.writes, 2, 'reading the directory never creates missing preferences');
        assert.equal((await request('booster', empty)).status, 200);
        assert.deepEqual((await (await request('booster', undefined, '/me')).json()).preferences, empty);

        state.error = missing();
        const unavailable = await request('booster', undefined, '/me');
        assert.equal(unavailable.status, 200);
        assert.equal((await unavailable.json()).preferencesAvailable, false);
        const failedSave = await request('booster', chosen);
        assert.equal(failedSave.status, 503);
        assert.match((await failedSave.json()).message, /not available yet/);
        const unavailableDirectoryResponse = await request('admin', undefined, '/boosters');
        assert.equal(unavailableDirectoryResponse.status, 200);
        const unavailableDirectory = await unavailableDirectoryResponse.json();
        assert.equal(unavailableDirectory.preferencesAvailable, false);
        assert.deepEqual(unavailableDirectory.boosters.map(user => user.preferences), [empty, empty, empty]);
        state.error = Object.assign(new Error('unrelated missing table'), { code: 'P2021', meta: { table: 'User' } });
        assert.equal((await request('booster', undefined, '/me')).status, 500);
        assert.equal((await request('booster', chosen)).status, 500);
        assert.equal((await request('admin', undefined, '/boosters')).status, 500, 'unrelated failures cannot masquerade as empty preferences');
        const batchReadsBeforeEmpty = state.batchReads;
        state.emptyDirectory = true;
        const emptyDirectory = await request('admin', undefined, '/boosters');
        assert.equal(emptyDirectory.status, 200);
        assert.deepEqual((await emptyDirectory.json()).boosters, []);
        assert.equal(state.batchReads, batchReadsBeforeEmpty, 'empty directories do not issue preference queries');
        assert.equal(state.writes, 3);
    } finally {
        if (server) await new Promise(resolve => server.close(resolve));
        for (const [path, value] of saved) { if (value) require.cache[path] = value; else delete require.cache[path]; }
    }
});
