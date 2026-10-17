const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { boosterRating, boosterRatings } = require('../src/utils/orderRatings');

const emptyRating = { average: null, count: 0, available: true };
const unavailableRating = { ...emptyRating, available: false };
const missingRatingTable = () => Object.assign(new Error('relation "OrderRatingRecipient" does not exist'), {
    code: 'P2010', meta: { code: '42P01', message: 'relation "OrderRatingRecipient" does not exist' },
});

function ratingFixture() {
    const state = { batchQueries: [], singleReads: 0, error: null,
        reviews: [
            { orderId: 'shared-order', stars: 5, recipients: ['provider', 'admin-booster'] },
            { orderId: 'former-order', stars: 3, recipients: ['provider'] },
            { orderId: 'another-order', stars: 1, recipients: ['admin-booster'] },
            { orderId: 'private-order', stars: 2, recipients: ['unrelated'] },
        ] };
    const stats = id => {
        const values = state.reviews.filter(review => review.recipients.includes(id)).map(review => review.stars);
        return { average: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null, count: values.length };
    };
    const db = {
        $queryRaw: async query => {
            state.batchQueries.push(query);
            if (state.error) throw state.error;
            assert.match(query.sql, /FROM "OrderRatingRecipient" AS recipient/);
            assert.match(query.sql, /JOIN "OrderRating" AS rating ON rating\."orderId" = recipient\."orderId"/);
            assert.match(query.sql, /AVG\(rating\.stars\)::double precision AS average/);
            assert.match(query.sql, /COUNT\(\*\)::integer AS count/);
            assert.match(query.sql, /GROUP BY recipient\."boosterId"/);
            assert.doesNotMatch(query.sql, /OrderAssignment|JOIN "Order"|paymentStatus|status|customerId/);
            return [...query.values].reverse().filter(id => stats(id).count).map(id => ({ boosterId: id, ...stats(id) }));
        },
        orderRating: { aggregate: async ({ where }) => {
            state.singleReads++;
            const value = stats(where.recipients.some.boosterId);
            return { _avg: { stars: value.average }, _count: { _all: value.count } };
        } },
    };
    return { db, state };
}

test('one batch matches profile aggregates, keeps snapshot attribution and returns unrated boosters explicitly', async () => {
    const { db, state } = ratingFixture();
    const ids = ['provider', 'admin-booster', 'unrated', 'provider'];
    const ratings = await boosterRatings(db, ids);
    assert.equal(state.batchQueries.length, 1);
    assert.deepEqual(state.batchQueries[0].values, ['provider', 'admin-booster', 'unrated']);
    assert.deepEqual([...ratings.keys()], ['provider', 'admin-booster', 'unrated']);
    assert.deepEqual(ratings.get('provider'), { average: 4, count: 2, available: true });
    assert.deepEqual(ratings.get('admin-booster'), { average: 3, count: 2, available: true });
    assert.deepEqual(ratings.get('unrated'), emptyRating);
    assert.equal(ratings.has('unrelated'), false);
    assert.equal(state.singleReads, 0, 'no per-booster aggregation');
    for (const id of ratings.keys()) assert.deepEqual(ratings.get(id), await boosterRating(db, id));
    // Assignment changes and later reopening/cancellation never move reviews to
    // a different recipient. Creation eligibility is tested in orderRatings.test.
    state.reviews[1].currentAssignments = ['replacement'];
    state.reviews[1].currentOrderStatus = 'CANCELLED';
    const after = await boosterRatings(db, ['provider', 'replacement']);
    assert.deepEqual(after.get('provider'), ratings.get('provider'));
    assert.deepEqual(after.get('replacement'), emptyRating);
});

test('empty lists avoid SQL and IDs remain bound parameters', async () => {
    const { db, state } = ratingFixture();
    assert.deepEqual([...await boosterRatings(db, [])], []);
    assert.equal(state.batchQueries.length, 0);
    const specialId = "provider'); DROP TABLE User; --";
    await boosterRatings(db, [specialId, specialId]);
    assert.deepEqual(state.batchQueries[0].values, [specialId]);
    assert.equal(state.batchQueries[0].sql.includes(specialId), false);
});

test('missing rating tables report unavailable while unrelated database failures propagate', async () => {
    const { db, state } = ratingFixture();
    for (const error of [missingRatingTable(), { code: 'P2021', meta: { table: 'public.OrderRating' } }]) {
        state.error = error;
        assert.deepEqual([...await boosterRatings(db, ['provider', 'unrated'])], [
            ['provider', unavailableRating], ['unrated', unavailableRating],
        ]);
    }
    for (const error of [{ code: 'P1001' }, { code: 'P2021', meta: { table: 'public.User' } }]) {
        state.error = error;
        await assert.rejects(boosterRatings(db, ['provider']), thrown => thrown === error);
    }
});

test('admin directory includes each real rating in one query and preserves permissions and other row data', async t => {
    const paths = ['../src/prisma', '../src/middleware/authMiddleware', '../src/routes/operationsRoutes',
        '../src/routes/contractRoutes', '../src/routes/matchHistoryRoutes', '../src/routes/providerAgreementRoutes',
        '../src/utils/boosterEarnings'].map(value => require.resolve(value));
    const saved = paths.map(value => [value, require.cache[value]]);
    t.after(() => { for (const [modulePath, original] of saved) {
        if (original) require.cache[modulePath] = original; else delete require.cache[modulePath];
    } });
    const { db, state } = ratingFixture();
    const users = {
        admin: { id: 'admin', role: 'ADMIN' }, provider: { id: 'provider', role: 'PROVIDER', username: 'Provider', boosterProfile: { startedAt: '2026-01-01' }, boosterContracts: [] },
        'admin-booster': { id: 'admin-booster', role: 'ADMIN', hasBoosterAccess: true, username: 'FastBoost', boosterContracts: [] },
        unrated: { id: 'unrated', role: 'PROVIDER', username: 'NewBooster', boosterContracts: [] },
        customer: { id: 'customer', role: 'CUSTOMER' }, suspended: { id: 'suspended', role: 'ADMIN', suspendedAt: new Date() },
    };
    state.listReads = 0;
    state.emptyDirectory = false;
    db.user = {
        findUnique: async ({ where }) => users[where.id] || null,
        findMany: async ({ where }) => {
            state.listReads++;
            assert.deepEqual(where, { OR: [{ role: 'PROVIDER' }, { hasBoosterAccess: true }] });
            return state.emptyDirectory ? [] : [users.provider, users['admin-booster'], users.unrated];
        },
    };
    db.boosterPreferences = { findMany: async () => [{ userId: 'provider', firstRole: 'Top', secondRole: 'Middle', championIds: ['Darius'] }] };
    require.cache[paths[0]] = { exports: db };
    require.cache[paths[1]] = { exports: { protect: (req, res, next) => {
        if (!req.headers.authorization) return res.sendStatus(401);
        req.user = { userId: req.headers.authorization, role: 'ADMIN' }; next();
    } } };
    for (const modulePath of paths.slice(3, 6)) require.cache[modulePath] = { exports: express.Router() };
    require.cache[paths[6]] = { exports: { boosterEarnings: async () => ({ provider: { USD: 7000 } }) } };
    delete require.cache[paths[2]];
    const app = express(); app.use(require(paths[2]));
    const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
    t.after(() => new Promise(resolve => server.close(resolve)));
    const request = actor => fetch(`http://127.0.0.1:${server.address().port}/boosters`, { headers: actor ? { Authorization: actor } : {} });
    assert.equal((await request()).status, 401);
    for (const actor of ['provider', 'customer', 'suspended', 'missing']) assert.equal((await request(actor)).status, 403);
    assert.equal(state.listReads, 0);
    assert.equal(state.batchQueries.length, 0);
    const response = await request('admin');
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const body = await response.json();
    assert.deepEqual(body.boosters.map(user => [user.id, user.rating]), [
        ['provider', { average: 4, count: 2, available: true }],
        ['admin-booster', { average: 3, count: 2, available: true }],
        ['unrated', emptyRating],
    ]);
    assert.equal(body.boosters[0].boosterProfile.startedAt, '2026-01-01');
    assert.deepEqual(body.boosters[0].preferences, { firstRole: 'Top', secondRole: 'Middle', championIds: ['Darius'] });
    assert.deepEqual(body.boosters[0].earnings, { USD: 7000 });
    assert.equal(state.batchQueries.length, 1);
    assert.equal(state.singleReads, 0);
    state.error = missingRatingTable();
    const unavailable = await request('admin');
    assert.equal(unavailable.status, 200);
    assert.ok((await unavailable.json()).boosters.every(user => user.rating.available === false));
    state.error = { code: 'P1001' };
    assert.equal((await request('admin')).status, 500, 'connectivity failure is not represented as no reviews');
    state.emptyDirectory = true;
    const readsBefore = state.batchQueries.length;
    const empty = await request('admin');
    assert.equal(empty.status, 200);
    assert.deepEqual((await empty.json()).boosters, []);
    assert.equal(state.batchQueries.length, readsBefore);
});
