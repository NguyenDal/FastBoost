const test = require('node:test');
const assert = require('node:assert/strict');

function project(value, select) {
    if (value == null) return value;
    return Object.fromEntries(Object.entries(select).map(([key, selection]) => [key,
        selection === true ? value[key] : project(value[key], selection.select)]));
}

function fixture(t) {
    const booster = (id, role = 'PROVIDER') => ({ id, role, username: `Sample-${id}`, email: `${id}@example.test`,
        profile: { displayName: `Sample ${id}`, profileImageUrl: `https://assets.example.test/${id}.png`, country: 'Private profile field' } });
    const state = {
        order: { id: 'synthetic-order', customerId: 'customer', status: 'IN_PROGRESS', paymentStatus: 'PAID', amountCents: 10000, currency: 'usd',
            assignments: ['first', 'second'].map(id => ({ id: `assignment-${id}`, boosterId: id, booster: booster(id, id === 'second' ? 'ADMIN' : 'PROVIDER') })) },
        ratings: [{ stars: 5, recipients: ['first'] }, { stars: 3, recipients: ['first', 'second'] }, { stars: 1, recipients: ['unrelated'] }],
        aggregates: [], orderQueries: [], decryptions: 0, aggregateError: null,
    };
    const db = {
        order: { findUnique: async query => {
            state.orderQueries.push(query);
            if (!state.order) return null;
            const order = structuredClone(state.order);
            order.assignments = order.assignments.map(assignment => ({ ...assignment,
                booster: project(assignment.booster, query.include.assignments.include.booster.select) }));
            return order;
        } },
        orderRating: { aggregate: async query => {
            state.aggregates.push(query);
            if (state.aggregateError) throw state.aggregateError;
            assert.deepEqual(query._avg, { stars: true });
            assert.deepEqual(query._count, { _all: true });
            const rows = state.ratings.filter(row => row.recipients.includes(query.where.recipients.some.boosterId));
            return { _avg: { stars: rows.length ? rows.reduce((sum, row) => sum + row.stars, 0) / rows.length : null }, _count: { _all: rows.length } };
        } },
    };
    const replacements = new Map([
        [require.resolve('../src/prisma'), db],
        [require.resolve('../src/utils/stripeClient'), {}],
        [require.resolve('../src/config/env'), { env: { awsRegion: 'ca-central-1' } }],
        [require.resolve('../src/utils/orderPasswordCrypto'), {
            stripEncryptedPasswordFields: order => ({ ...order }), hasEncryptedPasswordFields: () => false,
            decryptOrderPassword: async () => { state.decryptions++; return null; },
        }],
    ]);
    const controllerPath = require.resolve('../src/controllers/orderController');
    const saved = new Map([[controllerPath, require.cache[controllerPath]]]);
    for (const [path, exports] of replacements) {
        saved.set(path, require.cache[path]);
        require.cache[path] = { id: path, filename: path, loaded: true, exports };
    }
    delete require.cache[controllerPath];
    const { getOrderById } = require(controllerPath);
    t.mock.method(console, 'error', () => {});
    t.after(() => {
        for (const [path, previous] of saved) {
            if (previous) require.cache[path] = previous;
            else delete require.cache[path];
        }
    });
    return { state, async invoke(user = { id: 'customer', role: 'CUSTOMER' }) {
        const response = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
        await getOrderById({ user, params: { id: 'synthetic-order' } }, response);
        return response;
    } };
}

test('authorized order details expose saved booster avatars and the same live review aggregate as profiles', async t => {
    const f = fixture(t);
    for (const user of [{ id: 'customer', role: 'CUSTOMER' }, { id: 'first', role: 'PROVIDER' }, { id: 'admin', role: 'ADMIN' }]) {
        const response = await f.invoke(user);
        assert.equal(response.code, 200);
        const [first, second] = response.body.order.assignments.map(assignment => assignment.booster);
        assert.deepEqual(first.rating, { average: 4, count: 2, available: true });
        assert.deepEqual(second.rating, { average: 3, count: 1, available: true }, 'assigned admin boosters use the same saved review data');
        assert.deepEqual(first.profile, { displayName: 'Sample first', profileImageUrl: 'https://assets.example.test/first.png' });
        assert.equal(first.profile.country, undefined, 'no extra profile fields are exposed');
        assert.equal(response.body.order.priceSummary.totalCents, 10000, 'existing saved receipt remains intact');
    }
    f.state.ratings.push({ stars: 1, recipients: ['first'] });
    const refreshed = await f.invoke();
    assert.deepEqual(refreshed.body.order.assignments[0].booster.rating, { average: 3, count: 3, available: true }, 'each response reflects newly saved reviews');
    assert.ok(f.state.aggregates.every(query => ['first', 'second'].includes(query.where.recipients.some.boosterId)));
});

test('unreviewed boosters return a truthful zero count and absent avatar stays absent', async t => {
    const f = fixture(t);
    f.state.ratings = [];
    f.state.order.assignments[0].booster.profile = null;
    const response = await f.invoke();
    assert.equal(response.code, 200);
    for (const assignment of response.body.order.assignments) assert.deepEqual(assignment.booster.rating, { average: null, count: 0, available: true });
    assert.equal(response.body.order.assignments[0].booster.profile, null);
    assert.doesNotMatch(JSON.stringify(response.body), /657|ui-avatars/);
});

test('unavailable review storage never invents reviews or prevents authorized order details loading', async t => {
    const f = fixture(t);
    f.state.aggregateError = Object.assign(new Error('Missing rating table'), { code: 'P2021', meta: { table: 'public.OrderRating' } });
    const unavailable = await f.invoke();
    assert.equal(unavailable.code, 200);
    assert.deepEqual(unavailable.body.order.assignments[0].booster.rating, { average: null, count: 0, available: false });
    assert.equal(console.error.mock.calls.length, 0, 'known missing-table state is handled by the canonical rating utility');
    f.state.aggregateError = Object.assign(new Error('Synthetic connection failure'), { code: 'P1001' });
    const failed = await f.invoke();
    assert.equal(failed.code, 200);
    assert.equal(failed.body.order.id, 'synthetic-order');
    assert.equal(failed.body.order.priceSummary.totalCents, 10000);
    for (const assignment of failed.body.order.assignments) assert.deepEqual(assignment.booster.rating, { average: null, count: 0, available: false });
    assert.equal(console.error.mock.calls.length, 2, 'unexpected aggregate failures are logged instead of silently treated as zero reviews');
});

test('order authorization runs before review reads and missing/unassigned orders do not gain access', async t => {
    const f = fixture(t);
    for (const user of [{ id: 'other', role: 'CUSTOMER' }, { id: 'unassigned', role: 'PROVIDER' }]) {
        const response = await f.invoke(user);
        assert.equal(response.code, 403);
        assert.equal(response.body.order, undefined);
    }
    assert.equal((await f.invoke({ role: 'ADMIN' })).code, 401);
    assert.equal(f.state.aggregates.length, 0);
    assert.equal(f.state.decryptions, 0);
    f.state.order = null;
    assert.equal((await f.invoke()).code, 404);
    assert.equal(f.state.aggregates.length, 0);
});

test('only distinct current assignment boosters are summarized', async t => {
    const f = fixture(t);
    f.state.order.assignments.push(structuredClone(f.state.order.assignments[0]));
    assert.equal((await f.invoke()).code, 200);
    assert.deepEqual(f.state.aggregates.map(query => query.where.recipients.some.boosterId).sort(), ['first', 'second']);
    f.state.order.assignments = [];
    f.state.aggregates = [];
    assert.equal((await f.invoke()).code, 200);
    assert.equal(f.state.aggregates.length, 0);
});

test('order and avatar projections use actual generated Prisma fields without contacting a database', async t => {
    const f = fixture(t);
    await f.invoke();
    const { Prisma } = require('../src/generated/prisma/client');
    const models = new Map(Prisma.dmmf.datamodel.models.map(model => [model.name, model]));
    function check(modelName, fields) {
        const model = models.get(modelName);
        assert.ok(model);
        for (const [name, selection] of Object.entries(fields)) {
            const field = model.fields.find(candidate => candidate.name === name);
            assert.ok(field, `Unknown ${modelName}.${name}`);
            if (selection !== true) {
                assert.equal(field.kind, 'object');
                check(field.type, selection.select || selection.include);
            }
        }
    }
    const include = f.state.orderQueries[0].include;
    check('Order', include);
    assert.equal(include.assignments.include.booster.select.profile.select.profileImageUrl, true);
});
