const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

test('contribution submissions, revision approvals, contract ownership and current-role checks', async () => {
    const paths = ['../src/prisma', '../src/middleware/authMiddleware', '../src/utils/docusign', '../src/routes/operationsRoutes', '../src/routes/contractRoutes', '../src/utils/contractStatus'].map(p => require.resolve(p));
    const saved = paths.map(p => [p, require.cache[p]]);
    let submission, suspended = false, assigned = true, signingRole;
    const contract = { id: 'contract', boosterId: 'booster', envelopeId: 'envelope', status: 'sent', companySignerEmail: 'owner@example.test' };
    const db = { user: { findUnique: async ({ where }) => ({ id: where.id, email: `${where.id}@example.test`, role: ['admin', 'owner'].includes(where.id) ? 'ADMIN' : 'PROVIDER', suspendedAt: suspended ? new Date() : null }) },
        orderAssignment: { findUnique: async () => assigned ? { orderId: 'order', order: { paymentStatus: 'PAID', status: 'COMPLETED' } } : null },
        boosterContribution: {
            upsert: async ({ create, update }) => { submission = submission ? { ...submission, ...update, revision: submission.revision + 1 } : { ...create, revision: 1 }; },
            findUnique: async () => submission,
            updateMany: async ({ where, data }) => {
                if (where.revision !== submission.revision || submission.reviewedAt) return { count: 0 };
                submission = { ...submission, ...data }; return { count: 1 };
            },
        },
        boosterContract: { findUnique: async () => contract, update: async () => contract },
    };
    let server;
    try {
        require.cache[paths[0]] = { exports: db };
        require.cache[paths[1]] = { exports: { protect: (req, res, next) => { if (!req.headers.authorization) return res.sendStatus(401); req.user = { userId: req.headers.authorization }; next(); } } };
        require.cache[paths[2]] = { exports: { readiness: () => ({ configured: false }), signingView: async (value, company) => { signingRole = company; return { url: 'https://demo.docusign.net/signing/test' }; } } };
        paths.slice(3).forEach(p => delete require.cache[p]);
        const app = express(); app.use(express.json()); app.use(require(paths[3]));
        server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
        const request = (path, who, body) => fetch(`http://127.0.0.1:${server.address().port}${path}`, { method: body ? 'POST' : 'GET', headers: { Authorization: who, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
        assert.equal((await request('/contributions/order', 'booster', { matches: 9 })).status, 200);
        assert.equal(submission.submittedMatches, 9);
        assert.equal((await request('/contributions/order/booster/review', 'booster', { revision: 1, decision: 'approve' })).status, 403);
        assert.equal((await request('/contributions/order/booster/review', 'admin', { revision: 1, decision: 'approve' })).status, 200);
        assert.equal(submission.approvedMatches, 9);
        await request('/contributions/order', 'booster', { matches: 10 });
        assert.equal(submission.approvedMatches, null);
        assert.equal((await request('/contributions/order/booster/review', 'admin', { revision: 1, decision: 'approve' })).status, 409);
        assert.equal((await request('/contributions/order', 'booster', { matches: -1 })).status, 400);
        assigned = false;
        assert.equal((await request('/contributions/order', 'foreign', { matches: 100 })).status, 403);
        assert.equal((await request('/contracts/contract', 'foreign')).status, 404);
        assert.equal((await request('/contracts/contract', 'booster')).status, 200);
        assert.equal((await request('/contracts/contract/signing-view', 'admin', {})).status, 404);
        assert.equal((await request('/contracts/contract/signing-view', 'booster', {})).status, 409);
        assert.equal((await request('/contracts/contract/signing-view', 'owner', {})).status, 200);
        assert.equal(signingRole, true);
        contract.companySignedAt = new Date();
        assert.equal((await request('/contracts/contract/signing-view', 'owner', {})).status, 409);
        assert.equal((await request('/contracts/contract/signing-view', 'booster', {})).status, 200);
        assert.equal(signingRole, false);
        contract.boosterSignedAt = new Date();
        assert.equal((await request('/contracts/contract/signing-view', 'booster', {})).status, 409);
        assert.equal((await request('/docusign/configuration', 'booster')).status, 403);
        suspended = true;
        assert.equal((await request('/contracts/contract', 'booster')).status, 403);
    } finally {
        if (server) await new Promise(resolve => server.close(resolve));
        for (const [path, value] of saved) { if (value) require.cache[path] = value; else delete require.cache[path]; }
    }
});
