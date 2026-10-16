const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

async function fixture(t) {
    let contribution = { orderId: 'order', boosterId: 'provider', submittedMatches: 4, approvedMatches: 4, revision: 1, reviewedAt: new Date() };
    const state = { events: [], failSync: false };
    const db = {
        user: { findUnique: async ({ where }) => ({ id: where.id, role: where.id === 'admin' ? 'ADMIN' : 'PROVIDER' }) },
        orderAssignment: { findUnique: async () => { state.events.push('assignment-read'); return { orderId: 'order', order: { paymentStatus: 'PAID', status: 'COMPLETED', contributions: [contribution] } }; } },
        boosterContribution: {
            findUnique: async () => { state.events.push('contribution-read'); return { ...contribution }; },
            upsert: async ({ update }) => { state.events.push('resubmit'); contribution = { ...contribution, ...update, revision: contribution.revision + 1 }; },
            updateMany: async ({ where, data }) => {
                state.events.push('review');
                if (where.revision !== contribution.revision || contribution.reviewedAt !== null) return { count: 0 };
                contribution = { ...contribution, ...data }; return { count: 1 };
            },
        },
        $transaction: async callback => {
            const previous = structuredClone(contribution);
            state.events.push('transaction');
            try { return await callback(db); } catch (error) { contribution = previous; throw error; }
        },
    };
    const paths = ['../src/prisma', '../src/middleware/authMiddleware', '../src/routes/operationsRoutes', '../src/routes/contractRoutes', '../src/routes/matchHistoryRoutes', '../src/routes/providerAgreementRoutes', '../src/utils/boosterEarningsLedger'].map(path => require.resolve(path));
    const previous = paths.map(path => [path, require.cache[path]]);
    require.cache[paths[0]] = { exports: db };
    require.cache[paths[1]] = { exports: { protect: (req, res, next) => { req.user = { id: req.headers.authorization }; next(); } } };
    for (const path of paths.slice(3, 6)) require.cache[path] = { exports: express.Router() };
    require.cache[paths[6]] = { exports: { withEarningsLedgerMutation: async (tx, orderId, mutation) => {
        assert.equal(tx, db); assert.equal(orderId, 'order');
        state.events.push('ledger-lock');
        const result = await mutation();
        state.events.push('ledger-sync');
        if (state.failSync) throw new Error('Simulated ledger sync failure');
        return result;
    } } };
    delete require.cache[paths[2]];
    const app = express(); app.use(express.json()); app.use(require(paths[2]));
    const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
    t.after(async () => { await new Promise(resolve => server.close(resolve)); for (const [path, value] of previous) { if (value) require.cache[path] = value; else delete require.cache[path]; } });
    const request = (path, actor, body) => fetch(`http://127.0.0.1:${server.address().port}${path}`, { method: 'POST', headers: { Authorization: actor, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { request, state, contribution: () => contribution };
}

test('resubmission and review synchronize earnings in the same transaction after taking the ledger lock', async t => {
    const f = await fixture(t);
    assert.equal((await f.request('/contributions/order', 'provider', { matches: 6 })).status, 200);
    assert.deepEqual(f.state.events, ['transaction', 'ledger-lock', 'assignment-read', 'resubmit', 'ledger-sync']);
    assert.equal(f.contribution().approvedMatches, null);
    assert.equal(f.contribution().revision, 2);
    f.state.events.length = 0;
    assert.equal((await f.request('/contributions/order/provider/review', 'admin', { revision: 2, decision: 'approve' })).status, 200);
    assert.deepEqual(f.state.events, ['transaction', 'ledger-lock', 'contribution-read', 'review', 'ledger-sync']);
    assert.equal(f.contribution().approvedMatches, 6);
    f.state.events.length = 0;
    assert.equal((await f.request('/contributions/order/provider/review', 'admin', { revision: 1, decision: 'approve' })).status, 409);
    assert.ok(!f.state.events.includes('ledger-sync'), 'stale reviews never post a ledger entry');
    assert.equal(f.contribution().approvedMatches, 6);
});

test('a ledger failure rolls contribution changes back rather than losing an earnings adjustment', async t => {
    const f = await fixture(t);
    const original = structuredClone(f.contribution());
    f.state.failSync = true;
    assert.equal((await f.request('/contributions/order', 'provider', { matches: 9 })).status, 500);
    assert.deepEqual(f.contribution(), original);
    f.state.failSync = false;
    assert.equal((await f.request('/contributions/order', 'provider', { matches: 9 })).status, 200);
    assert.equal(f.contribution().submittedMatches, 9);
    assert.equal(f.contribution().revision, 2, 'retry increments once after the failed transaction rolled back');
});
