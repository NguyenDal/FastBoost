const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { signSessionToken } = require('../src/utils/sessionToken');
const { adminOnly } = require('../src/middleware/authMiddleware');
const { createManagementAudit } = require('../src/middleware/managementAudit');
const { createActivityLogRouter, filters } = require('../src/routes/activityLogRoutes');
const { routeFor, safe, visibleActions, labelFor, materialChange } = require('../src/utils/managementAudit');
const { withAuditedSocketMessage } = require('../src/utils/auditedSocketMessage');

const actors = {
    owner: { id: 'owner', username: 'Owner', role: 'ADMIN', isOwner: true },
    admin: { id: 'admin', username: 'Manager', role: 'ADMIN', isOwner: false },
    customer: { id: 'customer', username: 'Customer', role: 'CUSTOMER', isOwner: false },
    booster: { id: 'booster', username: 'Booster', role: 'PROVIDER', isOwner: false },
    suspended: { id: 'suspended', role: 'ADMIN', isOwner: true, suspendedAt: new Date() },
    downgraded: { id: 'downgraded', role: 'CUSTOMER', isOwner: true },
};
function project(value, select) {
    return value && Object.fromEntries(Object.entries(select).map(([key, selection]) => [key, selection === true ? value[key] : Array.isArray(value[key]) ? value[key].map(item => project(item, selection.select)) : project(value[key], selection.select)]));
}
function matches(row, where = {}) {
    return Object.entries(where).every(([key, value]) => {
        if (key === 'OR') return value.some(condition => matches(row, condition));
        if (value && typeof value === 'object') {
            if ('contains' in value) return String(row[key] || '').toLowerCase().includes(value.contains.toLowerCase());
            if ('not' in value) return row[key] !== value.not;
            if ('in' in value) return value.in.includes(row[key]);
            return (!value.gte || row[key] >= value.gte) && (!value.lt || row[key] < value.lt);
        }
        return row[key] === value;
    });
}
function fixture() {
    const entries = [];
    const target = { id: 'target', username: 'Teammate', role: 'CUSTOMER', isOwner: false, passwordHash: 'SECRET-HASH', email: 'PRIVATE-EMAIL' };
    const state = { entries, target, changes: 0, beginFails: false, endFails: false };
    const db = {
        user: {
            findUnique: async ({ where, select }) => project(where.id === 'target' ? target : actors[where.id], select),
            findMany: async ({ where, select }) => [target, ...Object.values(actors)]
                .filter(user => matches(user, where)).map(user => project(user, select)),
        },
        boosterContract: { findUnique: async ({ select }) => project({ id: 'contract', title: 'Team agreement', status: 'sent', signerEmail: 'PRIVATE-EMAIL', envelopeId: 'SECRET-ENVELOPE' }, select) },
        supportThread: { findUnique: async ({ select }) => project({ id: 'thread', customerId: 'customer', privateField: 'HIDDEN' }, select) },
        conversation: { findUnique: async ({ select }) => project({ id: 'conversation', orderId: 'order' }, select) },
        managementAuditLog: {
            create: async ({ data }) => {
                if (state.beginFails) throw Object.assign(new Error('db unavailable'), { code: 'OFFLINE' });
                const row = { id: String(entries.length + 1), createdAt: new Date(), outcome: 'STARTED', ...structuredClone(data) };
                entries.push(row); return structuredClone(row);
            },
            update: async ({ where, data }) => {
                if (state.endFails) throw Object.assign(new Error('db unavailable'), { code: 'OFFLINE' });
                Object.assign(entries.find(row => row.id === where.id), structuredClone(data));
            },
            count: async ({ where }) => entries.filter(row => matches(row, where)).length,
            findUnique: async () => ({ createdAt: new Date('2026-10-12T00:00:00Z') }),
            findMany: async ({ where, select, distinct, take, skip = 0 }) => {
                let rows = entries.filter(row => matches(row, where)).slice().reverse();
                if (distinct) rows = rows.filter((row, i) => rows.findIndex(other => other.actorId === row.actorId) === i);
                return rows.slice(skip, take ? skip + take : undefined).map(row => select ? project(row, select) : row);
            },
        },
        $transaction: async fn => fn(db),
        $queryRaw: async () => {
            const seen = new Set();
            return entries.slice().reverse().filter(row => {
                if (!row.actorId || row.outcome !== 'SUCCEEDED' || !visibleActions.includes(row.action) || seen.has(row.actorId)) return false;
                seen.add(row.actorId); return true;
            }).map(({ actorId, actorName }) => ({ actorId, actorName }));
        },
    };
    return { db, state };
}
async function serve(t, app) {
    const previous = process.env.JWT_SECRET;
    process.env.JWT_SECRET = 'audit-test-secret';
    const server = await new Promise(resolve => { const value = app.listen(0, '127.0.0.1', () => resolve(value)); });
    t.after(async () => { await new Promise(resolve => server.close(resolve)); if (previous === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = previous; });
    return (path, actor = 'owner', method = 'GET', body) => fetch(`http://127.0.0.1:${server.address().port}${path}`, {
        method, headers: { 'Content-Type': 'application/json', ...(actor ? { Authorization: `Bearer ${signSessionToken({ ...actors[actor], role: 'ADMIN', isOwner: true })}` } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
    });
}

test('only material admin changes enter the owner feed; failures and no-ops remain internal', async t => {
    const { db, state } = fixture();
    const app = express(); app.use(express.json()); app.use('/api', createManagementAudit(db));
    app.patch('/api/admin/users/target/role', adminOnly, (req, res) => {
        assert.equal(state.entries.at(-1).outcome, 'STARTED', 'the log exists before any mutation');
        if (req.body.role === 'INVALID') return res.status(400).json({ message: 'PRIVATE-ERROR' });
        state.target.role = req.body.role; state.changes++;
        res.json({ user: state.target, token: 'SECRET-TOKEN' });
    });
    app.post('/api/support/threads/thread/messages', (req, res) => {
        req.body = { content: 'PRIVATE-CHAT', password: 'SECRET-PASSWORD', clientId: 'untrusted' };
        res.status(201).json({ message: { id: 'message', content: 'PRIVATE-CHAT', attachmentName: 'PRIVATE-FILENAME', attachmentKey: 'PRIVATE-KEY' } });
    });
    app.get('/api/operations/contracts/contract/document', (req, res) => res.type('pdf').send(Buffer.from('PRIVATE-PDF')));
    app.post('/api/operations/earnings/export', (req, res) => res.json({ ok: true }));
    const request = await serve(t, app);
    assert.equal((await request('/api/admin/users/target/role', 'admin', 'PATCH', { role: 'PROVIDER', password: 'SECRET-PASSWORD', token: 'SECRET-TOKEN' })).status, 200);
    const log = state.entries[0];
    assert.equal(log.actorId, 'admin'); assert.equal(log.actorIsOwner, false, 'JWT owner claims do not determine actor ownership');
    assert.equal(log.before.role, 'CUSTOMER'); assert.equal(log.after.role, 'PROVIDER');
    assert.deepEqual(log.requested, { role: 'PROVIDER' }); assert.equal(log.outcome, 'SUCCEEDED'); assert.equal(log.statusCode, 200);
    assert.ok(log.finishedAt);
    assert.equal((await request('/api/admin/users/target/role', 'admin', 'PATCH', { role: 'INVALID' })).status, 400);
    assert.equal(state.entries[1].outcome, 'FAILED'); assert.equal(state.entries[1].after.role, 'PROVIDER');
    assert.equal((await request('/api/admin/users/target/role', 'admin', 'PATCH', { role: 'PROVIDER' })).status, 200);
    assert.equal(state.entries[2].outcome, 'NO_CHANGE', 'unchanged saves are not owner activity');
    assert.equal((await request('/api/support/threads/thread/messages', 'owner', 'POST', { content: 'PRIVATE-CHAT' })).status, 201);
    assert.equal(await (await request('/api/operations/contracts/contract/document')).text(), 'PRIVATE-PDF');
    assert.equal((await request('/api/operations/earnings/export', 'admin', 'POST', { exportType: 'boosters', rowCount: 3, password: 'SECRET' })).status, 200);
    assert.equal(state.entries.length, 3, 'routine chat, document download and export are omitted');
    assert.doesNotMatch(JSON.stringify(state.entries), /SECRET|PRIVATE|HIDDEN/);
    const priorChanges = state.changes;
    const oldError = console.error; console.error = () => {}; t.after(() => { console.error = oldError; });
    state.beginFails = true;
    assert.equal((await request('/api/admin/users/target/role', 'owner', 'PATCH', { role: 'ADMIN' })).status, 503);
    assert.equal(state.changes, priorChanges, 'logging failure blocks the mutation');
    state.beginFails = false; state.endFails = true;
    assert.equal((await request('/api/admin/users/target/role', 'owner', 'PATCH', { role: 'ADMIN' })).status, 200);
    assert.equal(state.entries.at(-1).outcome, 'STARTED', 'a failed final write remains unconfirmed, never disappears');
    assert.equal(state.target.role, 'ADMIN', 'never imply that completed work was rolled back');
    state.endFails = false;
    for (const actor of ['suspended', 'downgraded']) assert.equal((await request('/api/admin/users/target/role', actor, 'PATCH', { role: 'CUSTOMER' })).status, actor === 'suspended' ? 401 : 403);
    assert.equal(state.target.role, 'ADMIN');
});

test('log list and access are owner-only using current database permissions, with bounded filtering and pagination', async t => {
    const { db, state } = fixture();
    for (let i = 0; i < 23; i++) state.entries.push({ id: `log-${i}`, actorId: i % 2 ? 'admin' : 'owner', actorName: i % 2 ? 'Manager' : 'Owner', category: 'accounts', action: 'account.role', outcome: i === 0 ? 'FAILED' : 'SUCCEEDED', targetLabel: `Teammate ${i}`, targetId: `user-${i}`, createdAt: new Date('2026-10-12T12:00:00Z') });
    state.entries.push({ id: 'management-audit-enabled', actorId: null, actorName: 'System', category: 'system', action: 'logging.enabled', outcome: 'SUCCEEDED', createdAt: new Date('2026-10-12T00:00:00Z') });
    state.entries.push({ id: 'old-signing-view', actorId: 'admin', actorName: 'Manager', category: 'boosters', action: 'contract.signing-view', outcome: 'SUCCEEDED', createdAt: new Date('2026-10-12T00:00:00Z') });
    const app = express(); app.use('/api/admin/activity-logs', createActivityLogRouter(db));
    const request = await serve(t, app);
    for (const actor of ['admin', 'customer', 'booster', 'suspended', 'downgraded']) {
        assert.equal((await request('/api/admin/activity-logs/access', actor)).status, actor === 'suspended' ? 401 : 403);
        assert.equal((await request('/api/admin/activity-logs', actor)).status, actor === 'suspended' ? 401 : 403);
    }
    assert.equal((await request('/api/admin/activity-logs', null)).status, 401);
    assert.equal((await request('/api/admin/activity-logs/access')).status, 200);
    let response = await request('/api/admin/activity-logs?page=3');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    let data = await response.json(); assert.equal(data.total, 22); assert.equal(data.items.length, 2); assert.equal(data.page, 3); assert.equal(data.actors.length, 2);
    assert.equal(data.items[0].actionLabel, 'Changed account role');
    assert.equal(Object.hasOwn(data, 'recordingSince'), false);
    assert.equal(Object.hasOwn(data.categories, 'system'), false);
    data = await (await request('/api/admin/activity-logs?q=System')).json();
    assert.equal(data.total, 0, 'internal metadata and old routine events are excluded before counting and pagination');
    data = await (await request('/api/admin/activity-logs?actor=admin&q=teammate&category=accounts&from=2026-10-12&to=2026-10-12&page=999')).json();
    assert.equal(data.total, 11); assert.equal(data.page, 2); assert.equal(data.items.length, 1);
    assert.equal((await request('/api/admin/activity-logs?outcome=FAILED')).status, 400);
    for (const query of ['page=-1', 'page=1.5', 'category=constructor', 'outcome=deleted', 'from=2026-02-30', 'from=2026-10-13&to=2026-10-12']) {
        assert.equal((await request(`/api/admin/activity-logs?${query}`)).status, 400, query);
    }
    for (const method of ['POST', 'PATCH', 'DELETE']) assert.equal((await request('/api/admin/activity-logs/log-1', 'owner', method)).status, 404, 'logs have no editing/deletion API');
});

test('search finds legacy activity by usernames resolved from current accounts', async t => {
    const { db, state } = fixture();
    state.entries.push({ id: 'legacy-name', actorId: 'admin', actorName: 'Admin', category: 'accounts',
        action: 'account.role', outcome: 'SUCCEEDED', targetType: 'user', targetId: 'target', targetLabel: 'target',
        createdAt: new Date('2026-10-12T12:00:00Z') });
    const app = express(); app.use('/api/admin/activity-logs', createActivityLogRouter(db));
    const request = await serve(t, app);
    for (const username of ['Manager', 'Teammate']) {
        const data = await (await request(`/api/admin/activity-logs?q=${username}`)).json();
        assert.equal(data.total, 1, username);
        assert.equal(data.items[0].actorName, 'Manager');
        assert.equal(data.items[0].targetLabel, 'Teammate');
    }
    const unmatched = await (await request('/api/admin/activity-logs?q=UnknownName')).json();
    assert.equal(unmatched.total, 0);
});

test('management coverage is limited to material access, pricing, order, agreement and earnings changes', () => {
    for (const [method, path, action] of [
        ['PATCH', '/admin/users/target/role', 'account.role'], ['PATCH', '/admin/users/target/suspension', 'account.suspension'],
        ['PATCH', '/admin/users/target/booster-access', 'account.booster-access'], ['POST', '/services', 'service.create'],
        ['PATCH', '/admin/prices/rules/rule', 'pricing.update'], ['PATCH', '/admin/prices/rules/rule/availability', 'service.availability'],
        ['POST', '/admin/prices/sales', 'sale.create'], ['PATCH', '/admin/prices/sales/sale/disable', 'sale.disable'],
        ['PATCH', '/orders/admin/order/status', 'order.status'], ['POST', '/orders/order/assign/booster', 'order.assign'],
        ['DELETE', '/orders/order/assign/booster', 'order.unassign'], ['PATCH', '/orders/order/provider-complete', 'order.complete'],
        ['POST', '/operations/boosters/booster/contracts', 'contract.create'], ['POST', '/operations/contracts/contract/retry', 'contract.retry'],
        ['POST', '/operations/contracts/contract/prepare', 'contract.prepare'], ['POST', '/operations/contracts/contract/sign', 'contract.sign'],
        ['POST', '/operations/contracts/contract/native-replacement', 'contract.native-replacement'],
        ['POST', '/operations/contributions/order/booster/review', 'contribution.review'], ['POST', '/operations/match-history/order/manual-count', 'matches.manual-count'],
        ['POST', '/operations/match-history/order/match/review', 'match.review'], ['POST', '/operations/match-history/order/confirm', 'matches.confirm'],
        ['POST', '/operations/match-history/order/reopen', 'matches.reopen'],
    ]) assert.equal(routeFor(method, path)?.action, action, path);
    for (const [method, path] of [
        ['GET', '/operations/contracts/contract/signing'], ['POST', '/operations/contracts/contract/signing-view'],
        ['GET', '/operations/contracts/contract/document'], ['POST', '/operations/contracts/contract/sync'],
        ['POST', '/operations/earnings/export'], ['POST', '/support/threads/thread/messages'],
        ['GET', '/support/attachments/attachment'], ['POST', '/chats/conversations/conversation/messages'],
        ['POST', '/chats/conversations/conversation/attachments'], ['GET', '/chats/messages/message/attachment'],
        ['POST', '/assignment-requests/orders/order/boosters/booster'], ['PATCH', '/assignment-requests/request/cancel'],
        ['PATCH', '/assignment-requests/request/accept'], ['PATCH', '/assignment-requests/request/decline'],
        ['PATCH', '/operations/boosters/booster'], ['POST', '/operations/match-history/order/import'],
        ['POST', '/operations/match-history/order/submit'], ['POST', '/operations/contributions/order'],
        ['PATCH', '/orders/order/login-info'], ['DELETE', '/orders/order/provider-leave'],
        ['POST', '/operations/match-history/order/submission-preview'], ['POST', '/payments/webhook'],
    ]) assert.equal(routeFor(method, path), null, path);
    assert.ok(visibleActions.includes('assignment.accept') && visibleActions.includes('order.leave'), 'separate provider events are visible');
    assert.equal(materialChange({ action: 'contract.prepare' }, { nativeDocumentHash: 'same' }, { nativeDocumentHash: 'same', nativePreparedAt: 'later' }), false);
    assert.equal(materialChange({ action: 'contract.prepare' }, { nativeDocumentHash: 'old' }, { nativeDocumentHash: 'new' }), true);
    assert.equal(materialChange({ action: 'contract.retry' }, { status: 'sent' }, { status: 'sent' }), false);
    assert.equal(materialChange({ action: 'contract.retry' }, { status: 'pending' }, { status: 'sent' }), true);
    assert.equal(materialChange({ action: 'pricing.update' }, { config: { first: 1, second: 2 } }, { config: { second: 2, first: 1 } }), false);
    assert.equal(labelFor({ targetType: 'priceRule' }, { service: { title: 'Rank boost' }, pricingType: 'RANK_BASED' }), 'Rank boost · RANK_BASED');
    assert.equal(labelFor({ targetType: 'contract' }, { title: 'Booster Service Agreement', booster: { username: 'Teammate' } }), 'Booster Service Agreement · Teammate');
    assert.deepEqual(safe({ rankPrices: { gold: 10, password: 'secret' }, authorization: 'secret' }), { rankPrices: { gold: 10 } });
    assert.equal(filters({ from: '2026-10-12', to: '2026-10-12' }).where.createdAt.lt.toISOString(), '2026-10-13T00:00:00.000Z');
});

test('live chat rechecks account access without adding routine owner activity', async () => {
    const { db, state } = fixture();
    let sent = 0;
    const send = async () => { sent++; return { id: 'message', content: 'PRIVATE-MESSAGE', sender: { email: 'PRIVATE-EMAIL' } }; };
    await withAuditedSocketMessage(db, { userId: 'admin', role: 'ADMIN' }, 'conversation', send);
    assert.equal(state.entries.length, 0);
    await assert.rejects(withAuditedSocketMessage(db, { userId: 'admin', role: 'ADMIN' }, 'conversation', async () => { throw Object.assign(new Error('Forbidden'), { status: 403 }); }));
    state.beginFails = true;
    await withAuditedSocketMessage(db, { userId: 'admin', role: 'ADMIN' }, 'conversation', send);
    assert.equal(sent, 2, 'chat does not depend on owner audit storage');
    await assert.rejects(withAuditedSocketMessage(db, { userId: 'downgraded', role: 'ADMIN' }, 'conversation', send), /unavailable/);
    await withAuditedSocketMessage(db, { userId: 'customer', role: 'CUSTOMER' }, 'conversation', async () => { sent++; });
    assert.equal(sent, 3);
    assert.equal(state.entries.length, 0);
});
