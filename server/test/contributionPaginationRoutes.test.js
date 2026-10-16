const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

function match(row, where) {
    return Object.entries(where).every(([key, condition]) => {
        if (key === 'OR') return condition.some(clause => match(row, clause));
        if (condition && typeof condition === 'object') {
            if (condition.in) return condition.in.includes(row[key]);
            if (condition.some) return row[key].some(record => match(record, condition.some));
            if (condition.contains !== undefined) return row[key].toLowerCase().includes(condition.contains.toLowerCase());
        }
        return row[key] === condition;
    });
}

async function fixture(t) {
    const accounts = {
        'admin-booster': { id: 'admin-booster', role: 'ADMIN', hasBoosterAccess: true },
        admin: { id: 'admin', role: 'ADMIN', hasBoosterAccess: false },
        provider: { id: 'provider', role: 'PROVIDER' },
        customer: { id: 'customer', role: 'CUSTOMER' },
        suspended: { id: 'suspended', role: 'PROVIDER', suspendedAt: new Date() },
    };
    const member = boosterId => ({ boosterId, booster: { username: boosterId } });
    const base = { boostType: 'Rank Boost', status: 'IN_PROGRESS', paymentStatus: 'PAID', matchHistoryEnabled: true, assignments: [], contributions: [], updatedAt: new Date('2026-10-16T12:00:00Z') };
    const rows = Array.from({ length: 23 }, (_, i) => ({ ...base, id: `own-${String(i + 1).padStart(2, '0')}`, orderNumber: `LOL-RNK-${String(i + 1).padStart(2, '0')}`,
        assignments: [member('admin-booster'), member('provider'), member('other')], contributions: [{ ...member('other'), submittedMatches: 5 }] }));
    rows.push(
        { ...base, id: 'former', orderNumber: 'LOL-FORMER', matchHistoryEnabled: false, status: 'COMPLETED', contributions: [{ ...member('admin-booster'), submittedMatches: 5, approvedMatches: 5 }] },
        { ...base, id: 'tft-count', orderNumber: 'TFT-COUNT', boostType: 'TFT Rank Boost', matchHistoryEnabled: false, assignments: [member('admin-booster')], contributions: [{ ...member('other'), submittedMatches: 3 }] },
        { ...base, id: 'unassigned', orderNumber: 'LOL-UNASSIGNED', customerId: 'admin-booster' },
        { ...base, id: 'other', orderNumber: 'LOL-OTHER', assignments: [member('other')] },
        { ...base, id: 'cancelled', orderNumber: 'LOL-CANCELLED', status: 'CANCELLED', assignments: [member('admin-booster')] },
        { ...base, id: 'unpaid', orderNumber: 'LOL-UNPAID', paymentStatus: 'PENDING', assignments: [member('admin-booster')] },
    );
    const reads = [];
    const db = { user: { findUnique: async ({ where }) => accounts[where.id] || null }, order: {
        count: async query => { reads.push({ kind: 'count', ...query }); return rows.filter(row => match(row, query.where)).length; },
        findMany: async query => {
            reads.push({ kind: 'rows', ...query });
            assert.equal(query.take, 10);
            assert.deepEqual(query.orderBy, [{ updatedAt: 'desc' }, { id: 'desc' }]);
            return rows.filter(row => match(row, query.where)).sort((a, b) => b.updatedAt - a.updatedAt || b.id.localeCompare(a.id)).slice(query.skip, query.skip + query.take).map(row => ({
                id: row.id, orderNumber: row.orderNumber, boostType: row.boostType, status: row.status, matchHistoryEnabled: row.matchHistoryEnabled,
                _count: { contributions: row.contributions.length },
                assignments: row.assignments.filter(value => !query.select.assignments.where || match(value, query.select.assignments.where)),
                contributions: row.contributions.filter(value => !query.select.contributions.where || match(value, query.select.contributions.where)),
            }));
        },
    } };
    const paths = ['../src/prisma', '../src/middleware/authMiddleware', '../src/routes/operationsRoutes', '../src/routes/contractRoutes', '../src/routes/matchHistoryRoutes', '../src/routes/providerAgreementRoutes'].map(path => require.resolve(path));
    const original = paths.map(path => [path, require.cache[path]]);
    require.cache[paths[0]] = { exports: db };
    require.cache[paths[1]] = { exports: { protect: (req, res, next) => {
        if (!req.headers.authorization) return res.sendStatus(401);
        req.user = { userId: req.headers.authorization }; next();
    } } };
    for (const path of paths.slice(3)) require.cache[path] = { exports: express.Router() };
    delete require.cache[paths[2]];
    const app = express(); app.use(require(paths[2]));
    const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
    t.after(async () => {
        await new Promise(resolve => server.close(resolve));
        for (const [path, value] of original) { if (value) require.cache[path] = value; else delete require.cache[path]; }
    });
    const request = (query = '', actor = 'admin-booster') => fetch(`http://127.0.0.1:${server.address().port}/contributions${query}`, { headers: actor ? { Authorization: actor } : {} });
    return { rows, reads, request };
}

test('personal contribution view scopes admin boosters to their own assigned or previously contributed orders', async t => {
    const f = await fixture(t);
    const pages = await Promise.all([1, 2, 3].map(async page => {
        const res = await f.request(`?page=${page}&boosterId=other`);
        assert.equal(res.status, 200);
        assert.equal(res.headers.get('cache-control'), 'no-store');
        return res.json();
    }));
    assert.deepEqual(pages.map(page => page.orders.length), [10, 10, 5]);
    assert.ok(pages.every(page => page.total === 25 && page.pageSize === 10 && page.totalPages === 3));
    const all = pages.flatMap(page => page.orders);
    assert.equal(new Set(all.map(order => order.id)).size, 25, 'tie-breaking pagination has no duplicated orders');
    for (const id of ['other', 'unassigned', 'cancelled', 'unpaid']) assert.ok(!all.some(order => order.id === id), id);
    for (const order of all) {
        assert.ok(order.assignments.every(record => record.boosterId === 'admin-booster'));
        assert.ok(order.contributions.every(record => record.boosterId === 'admin-booster'));
        assert.equal('_count' in order, false);
    }
    assert.ok(all.some(order => order.id === 'former'), 'prior personal submissions remain visible');
    assert.equal(all.find(order => order.id === 'tft-count').matchHistoryEnabled, false, 'other submissions still preserve the original TFT count workflow');
    for (const query of f.reads) assert.deepEqual(query.where.OR, [{ assignments: { some: { boosterId: 'admin-booster' } } }, { contributions: { some: { boosterId: 'admin-booster' } } }]);
});

test('server search, page clamping and fixed page size operate on the scoped set', async t => {
    const f = await fixture(t);
    const searched = await (await f.request('?q=%20lol-rnk-1%20&page=2&pageSize=500')).json();
    assert.equal(searched.total, 10);
    assert.equal(searched.orders.length, 10);
    assert.equal(searched.page, 1);
    assert.equal(searched.pageSize, 10);
    assert.ok(searched.orders.every(order => order.orderNumber.startsWith('LOL-RNK-1')));
    const hidden = await (await f.request('?q=UNASSIGNED')).json();
    assert.deepEqual([hidden.total, hidden.page, hidden.totalPages, hidden.orders.length], [0, 1, 1, 0]);
    const last = await (await f.request('?page=999')).json();
    assert.equal(last.page, 3);
    assert.equal(last.orders.length, 5);
    for (const query of ['?page=0', '?page=-1', '?page=1.5', '?page=1e2', '?page=1&page=2', '?scope=unknown', '?scope=all&scope=mine', '?q=a&q=b', `?q=${'a'.repeat(101)}`]) {
        assert.equal((await f.request(query)).status, 400, query);
    }
});

test('team-wide reviews require explicit admin scope; personal access still requires booster eligibility', async t => {
    const f = await fixture(t);
    for (const [query, actor, status] of [
        ['', null, 401], ['', 'customer', 403], ['', 'suspended', 403], ['', 'admin', 403],
        ['?scope=all', 'provider', 403], ['?scope=all', 'customer', 403], ['?scope=all', 'suspended', 403],
    ]) assert.equal((await f.request(query, actor)).status, status, `${actor} ${query}`);
    assert.equal(f.reads.length, 0, 'authorization failures do not read contribution data');
    const team = await (await f.request('?scope=all&q=UNASSIGNED', 'admin')).json();
    assert.equal(team.total, 1);
    assert.equal(team.orders[0].id, 'unassigned');
    const provider = await (await f.request('', 'provider')).json();
    assert.equal(provider.total, 23);
    assert.ok(provider.orders.every(order => order.assignments.every(record => record.boosterId === 'provider') && order.contributions.length === 0));
});
