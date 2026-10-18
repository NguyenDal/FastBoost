const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { signSessionToken } = require('../src/utils/sessionToken');
const { ratingRecipientIds, boosterRating, missingRatingTable } = require('../src/utils/orderRatings');

// Loading the route must never initialize or contact the configured database.
const dbPath = require.resolve('../src/prisma');
const previousDb = require.cache[dbPath];
require.cache[dbPath] = { exports: {} };
const { createOrderRatingRouter } = require('../src/routes/orderRatingRoutes');
if (previousDb) require.cache[dbPath] = previousDb; else delete require.cache[dbPath];
const previousSecret = process.env.JWT_SECRET;
process.env.JWT_SECRET = 'isolated-order-rating-test-secret';
test.after(() => { if (previousSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = previousSecret; });

function select(row, fields) {
    if (row == null) return null;
    return Object.fromEntries(Object.entries(fields).filter(([, value]) => value).map(([key, value]) => {
        let result = row[key];
        if (value !== true && Array.isArray(result)) {
            if (value.where?.approvedMatches) result = result.filter(entry => entry.approvedMatches > value.where.approvedMatches.gt);
            result = result.map(entry => select(entry, value.select));
        } else if (value !== true) result = select(result, value.select);
        return [key, result];
    }));
}

function fixture(overrides = {}) {
    const state = {
        users: [ { id: 'customer', role: 'CUSTOMER', suspendedAt: null },
            { id: 'other', role: 'CUSTOMER', suspendedAt: null },
            { id: 'booster', role: 'PROVIDER', suspendedAt: null },
            { id: 'admin', role: 'ADMIN', suspendedAt: null } ],
        orders: [{ id: 'order', customerId: 'customer', status: 'COMPLETED', paymentStatus: 'PAID',
            boostType: 'Rank Boost', queueType: 'Solo/Duo', matchHistoryEnabled: false,
            assignments: [{ boosterId: 'booster' }], contributions: [], ...overrides }],
        matches: [], ratings: [], locks: [], groupReads: 0, creates: 0,
    };
    let transactionTail = Promise.resolve();
    const db = {
        user: { findUnique: async ({ where, select: fields }) => select(state.users.find(row => row.id === where.id), fields) },
        order: { findUnique: async ({ where, select: fields }) => {
            const order = state.orders.find(row => row.id === where.id);
            return order ? select({ ...order, rating: state.ratings.find(row => row.orderId === order.id) || null }, fields) : null;
        } },
        orderMatch: { groupBy: async ({ by, where }) => {
            assert.deepEqual(by, ['boosterId']);
            state.groupReads++;
            const matches = state.matches.filter(row => row.orderId === where.orderId &&
                (!where.status || row.status === where.status) && (!where.game || row.game === where.game) &&
                (!where.boosterId || row.boosterId !== where.boosterId.not) &&
                (!where.details || row.details?.[where.details.path[0]] === where.details.equals));
            return [...new Set(matches.map(row => row.boosterId))].map(boosterId => ({ boosterId }));
        } },
        orderRating: {
            create: async ({ data, select: fields }) => {
                if (state.ratings.some(row => row.orderId === data.orderId)) throw Object.assign(new Error('duplicate'), { code: 'P2002' });
                const row = { ...data, recipients: data.recipients.create.map(value => ({ ...value })), createdAt: new Date('2026-10-16T12:00:00.000Z') };
                state.creates++;
                state.ratings.push(row);
                return select(row, fields);
            },
            aggregate: async query => {
                assert.deepEqual(query._avg, { stars: true });
                assert.deepEqual(query._count, { _all: true });
                const rows = state.ratings.filter(row => row.recipients.some(recipient => recipient.boosterId === query.where.recipients.some.boosterId));
                return { _avg: { stars: rows.length ? rows.reduce((sum, row) => sum + row.stars, 0) / rows.length : null }, _count: { _all: rows.length } };
            },
        },
        $queryRaw: async (strings, id) => {
            const sql = strings.join('?');
            assert.match(sql, /^SELECT id FROM "(?:User|Order)" WHERE id = \? FOR UPDATE$/);
            state.locks.push([sql.includes('"User"') ? 'User' : 'Order', id]);
            if (state.beforeLock) await state.beforeLock(sql, id);
            return [{ id }];
        },
        $transaction: callback => {
            const run = transactionTail.then(async () => {
                const saved = structuredClone(state.ratings);
                try { return await callback(db); } catch (error) { state.ratings = saved; throw error; }
            });
            transactionTail = run.catch(() => {});
            return run;
        },
    };
    return { db, state };
}

async function serve(t, overrides) {
    const f = fixture(overrides);
    const app = express(); app.use(express.json()); app.use('/orders', createOrderRatingRouter(f.db));
    const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    t.after(() => new Promise(resolve => server.close(resolve)));
    f.request = async ({ actor = 'customer', role = 'CUSTOMER', body, orderId = 'order', token } = {}) => {
        const response = await fetch(`http://127.0.0.1:${server.address().port}/orders/${orderId}/rating`, {
            method: body === undefined ? 'GET' : 'POST',
            headers: { ...(actor ? { Authorization: `Bearer ${token || signSessionToken({ ...(f.state.users.find(user => user.id === actor) || {}), id: actor, role })}` } : {}),
                ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        return { status: response.status, cache: response.headers.get('cache-control'), body: await response.json() };
    };
    return f;
}

test('paid completed owner sees eligibility, submits once, and gets only the public review fields', async t => {
    const { request, state } = await serve(t);
    assert.deepEqual(await request(), { status: 200, cache: 'no-store', body: { ok: true, rating: null, eligible: true } });
    const submitted = await request({ body: { stars: 5, customerId: 'other', boosterId: 'admin', orderId: 'other' } });
    assert.equal(submitted.status, 201);
    assert.deepEqual(submitted.body, { ok: true, rating: { stars: 5, createdAt: '2026-10-16T12:00:00.000Z' } });
    assert.equal(state.ratings[0].customerId, 'customer');
    assert.deepEqual(state.ratings[0].recipients, [{ boosterId: 'booster' }]);
    assert.deepEqual(state.locks, [['User', 'customer'], ['Order', 'order']]);
    assert.deepEqual((await request()).body, { ...submitted.body, eligible: false });
    assert.equal((await request({ body: { stars: 1 } })).status, 409);
    assert.equal(state.creates, 1);
    assert.equal(state.ratings[0].stars, 5);
});

test('authentication, current account status and exact ownership protect both methods; admins have no override', async t => {
    const { request, state } = await serve(t);
    for (const body of [undefined, { stars: 4 }]) {
        assert.equal((await request({ actor: null, body })).status, 401);
        assert.equal((await request({ token: 'invalid', body })).status, 401);
        assert.equal((await request({ actor: 'deleted-user', body })).status, 401);
        assert.equal((await request({ actor: 'other', body })).status, 404);
        assert.equal((await request({ actor: 'admin', role: 'ADMIN', body })).status, 404);
        assert.equal((await request({ actor: 'booster', role: 'PROVIDER', body })).status, 404);
        assert.equal((await request({ orderId: 'missing', body })).status, 404);
        state.users[0].suspendedAt = new Date();
        assert.equal((await request({ body })).status, 401);
        state.users[0].suspendedAt = null;
    }
    assert.equal(state.creates, 0);
});

test('an active owner can review personal purchases regardless of current or stale JWT role', async t => {
    const { request, state } = await serve(t);
    for (const role of ['CUSTOMER', 'PROVIDER', 'ADMIN']) {
        state.users[0].role = role;
        assert.equal((await request({ role: role === 'ADMIN' ? 'CUSTOMER' : 'ADMIN' })).body.eligible, true);
    }
    assert.equal((await request({ role: 'CUSTOMER', body: { stars: 4 } })).status, 201);
});

test('unpaid and non-completed orders cannot be reviewed even with an assignment', async t => {
    const { request, state } = await serve(t);
    for (const [status, paymentStatus] of [['COMPLETED', 'UNPAID'], ['PENDING', 'PAID'], ['IN_PROGRESS', 'PAID'], ['CANCELLED', 'PAID']]) {
        Object.assign(state.orders[0], { status, paymentStatus });
        assert.equal((await request()).body.eligible, false);
        assert.equal((await request({ body: { stars: 5 } })).status, 409);
    }
    assert.equal(state.creates, 0);
});

test('only integer stars from one through five are accepted', async t => {
    const { request, state } = await serve(t);
    for (const stars of [0, 6, -1, 1.5, '5', null, true, [], {}, 1e100]) {
        assert.equal((await request({ body: { stars } })).status, 400, JSON.stringify(stars));
    }
    assert.equal((await request({ body: {} })).status, 400);
    assert.equal(state.creates, 0);
    for (const stars of [1, 2, 3, 4, 5]) {
        state.orders.push({ ...state.orders[0], id: `order${stars}` });
        assert.equal((await request({ orderId: `order${stars}`, body: { stars } })).status, 201);
    }
});

test('concurrent submissions create one immutable rating', async t => {
    const { request, state } = await serve(t);
    const results = await Promise.all([request({ body: { stars: 5 } }), request({ body: { stars: 1 } })]);
    assert.deepEqual(results.map(result => result.status).sort(), [201, 409]);
    assert.equal(state.ratings.length, 1);
    assert.equal(state.creates, 1);
    assert.equal(state.ratings[0].stars, results.find(result => result.status === 201).body.rating.stars);
});

test('database unique conflicts map to 409 without leaking database details', async t => {
    const { request, db } = await serve(t);
    db.orderRating.create = async () => { throw Object.assign(new Error('private database details'), { code: 'P2002' }); };
    const result = await request({ body: { stars: 5 } });
    assert.equal(result.status, 409);
    assert.doesNotMatch(JSON.stringify(result.body), /private/);
});

test('author and order state are rechecked after locks, before writing', async t => {
    const { request, state } = await serve(t);
    state.beforeLock = async sql => { if (sql.includes('"User"')) state.users[0].suspendedAt = new Date(); };
    assert.equal((await request({ body: { stars: 5 } })).status, 403);
    state.users[0].suspendedAt = null;
    state.beforeLock = async sql => { if (sql.includes('"Order"')) state.orders[0].status = 'CANCELLED'; };
    assert.equal((await request({ body: { stars: 5 } })).status, 409);
    assert.equal(state.creates, 0);
});

test('manual contributions are approved, deduplicated, and snapshotted against later assignments', async t => {
    const { request, state, db } = await serve(t, {
        assignments: [{ boosterId: 'booster' }, { boosterId: 'customer' }],
        contributions: [{ boosterId: 'booster', approvedMatches: 2 }, { boosterId: 'former', approvedMatches: 3 },
            { boosterId: 'pending', approvedMatches: null }, { boosterId: 'zero', approvedMatches: 0 }, { boosterId: 'customer', approvedMatches: 2 }],
    });
    assert.equal((await request({ body: { stars: 3 } })).status, 201);
    assert.deepEqual(state.ratings[0].recipients, [{ boosterId: 'booster' }, { boosterId: 'former' }]);
    state.orders[0].assignments = [{ boosterId: 'new-booster' }];
    state.orders[0].contributions = [];
    for (const id of ['booster', 'former']) assert.deepEqual(await boosterRating(db, id), { average: 3, count: 1, available: true });
    for (const id of ['new-booster', 'customer', 'zero', 'pending']) assert.deepEqual(await boosterRating(db, id), { average: null, count: 0, available: true });
    assert.equal(state.groupReads, 0);
});

test('match recipients require approved claimed matches in the correct game and queue', async t => {
    const { request, state } = await serve(t, { matchHistoryEnabled: true, contributions: [{ boosterId: 'stale-manual', approvedMatches: 9 }] });
    const base = { orderId: 'order', game: 'LOL', status: 'APPROVED', details: { queueId: 420 } };
    state.matches = [ { ...base, boosterId: 'former' }, { ...base, boosterId: 'former' }, { ...base, boosterId: 'booster' },
        { ...base, boosterId: 'pending', status: 'PENDING' }, { ...base, boosterId: 'rejected', status: 'REJECTED' },
        { ...base, boosterId: 'wrong-queue', details: { queueId: 440 } }, { ...base, boosterId: 'wrong-game', game: 'TFT' },
        { ...base, boosterId: 'other-order', orderId: 'other' }, { ...base, boosterId: null }, { ...base, boosterId: 'customer' } ];
    assert.equal((await request({ body: { stars: 4 } })).status, 201);
    assert.deepEqual(state.ratings[0].recipients, [{ boosterId: 'booster' }, { boosterId: 'former' }]);
    assert.equal(state.groupReads, 1);
});

test('legacy TFT queues use ranked TFT scope and unsupported scopes cannot import unrelated credit', async () => {
    const { db, state } = fixture({ matchHistoryEnabled: true, boostType: 'TFT Rank Boost' });
    state.matches = [{ orderId: 'order', game: 'TFT', boosterId: 'tft', status: 'APPROVED', details: { queueId: 1100 } },
        { orderId: 'order', game: 'LOL', boosterId: 'lol', status: 'APPROVED', details: { queueId: 420 } },
        { orderId: 'order', game: 'TFT', boosterId: 'double-up', status: 'APPROVED', details: { queueId: 1160 } }];
    assert.deepEqual(await ratingRecipientIds(db, state.orders[0]), ['booster', 'tft']);
    state.orders[0].boostType = 'unknown';
    assert.deepEqual(await ratingRecipientIds(db, state.orders[0]), ['booster']);
    assert.equal(state.groupReads, 1);
});

test('no recipients or self-only recipients cannot produce a review', async t => {
    const { request, state } = await serve(t, { assignments: [] });
    for (const assignments of [[], [{ boosterId: 'customer' }]]) {
        state.orders[0].assignments = assignments;
        assert.equal((await request()).body.eligible, false);
        assert.equal((await request({ body: { stars: 5 } })).status, 409);
    }
    assert.equal(state.creates, 0);
});

test('aggregate averages one review per order, including shared recipient snapshots', async () => {
    const { db, state } = fixture();
    state.ratings = [{ orderId: 'one', stars: 5, recipients: [{ boosterId: 'booster' }, { boosterId: 'other' }] },
        { orderId: 'two', stars: 3, recipients: [{ boosterId: 'booster' }] },
        { orderId: 'unrelated', stars: 1, recipients: [{ boosterId: 'other' }] }];
    assert.deepEqual(await boosterRating(db, 'booster'), { average: 4, count: 2, available: true });
    assert.deepEqual(await boosterRating(db, 'other'), { average: 3, count: 2, available: true });
    assert.deepEqual(await boosterRating(db, 'unknown'), { average: null, count: 0, available: true });
});

test('missing rating schema has a narrow rollout fallback; unrelated failures propagate', async () => {
    const missing = [ { code: 'P2021', meta: { table: 'public.OrderRating' } },
        { code: 'P2021', meta: { table: '"public"."OrderRatingRecipient"' } },
        { code: '42P01', message: 'relation "public.OrderRatingRecipient" does not exist' },
        { code: 'P2021', meta: { driverAdapterError: { cause: { kind: 'TableDoesNotExist', table: 'public.OrderRating' } } } } ];
    for (const error of missing) {
        assert.equal(missingRatingTable(error), true);
        assert.deepEqual(await boosterRating({ orderRating: { aggregate: async () => { throw error; } } }, 'booster'), { average: null, count: 0, available: false });
    }
    for (const error of [{ code: 'P2021', meta: { table: 'public.User', modelName: 'OrderRating' } },
        { code: '42P01', message: 'relation "OrderRatingSecret" does not exist' },
        { code: 'P1001', message: 'OrderRating database connection failed' },
        { code: 'P2022', meta: { table: 'public.OrderRating' } }]) {
        assert.equal(missingRatingTable(error), false);
        await assert.rejects(boosterRating({ orderRating: { aggregate: async () => { throw error; } } }, 'booster'), thrown => thrown === error);
    }
});

test('rating API returns controlled 503 for missing rating tables and 500 for other database failures', async t => {
    const { request, db } = await serve(t);
    db.order.findUnique = async () => { throw Object.assign(new Error('private schema'), { code: 'P2021', meta: { table: 'public.OrderRating' } }); };
    for (const body of [undefined, { stars: 5 }]) {
        const result = await request({ body });
        assert.equal(result.status, 503);
        assert.doesNotMatch(JSON.stringify(result.body), /private/);
    }
    db.order.findUnique = async () => { throw Object.assign(new Error('private schema'), { code: 'P2021', meta: { table: 'public.User' } }); };
    assert.equal((await request()).status, 500);
});
