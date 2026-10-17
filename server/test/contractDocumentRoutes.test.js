const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

test('document creation rejects unavailable types, fixes agreement identity and preserves retry snapshots', async () => {
    const paths = ['../src/prisma', '../src/utils/docusign', '../src/routes/contractRoutes'].map(value => require.resolve(value));
    const saved = paths.map(path => [path, require.cache[path]]);
    const records = new Map();
    const sent = [];
    let dbCalls = 0, configCalls = 0, suspended = false;
    const db = {
        user: {
            findFirst: async () => { dbCalls++; return { id: 'owner' }; },
            findUnique: async ({ where }) => {
                dbCalls++;
                return { id: where.id, role: 'PROVIDER', username: 'SavedUsername', email: 'saved@example.test', suspendedAt: suspended ? new Date() : null };
            },
        },
        boosterContract: {
            findUnique: async ({ where }) => { dbCalls++; return records.get(where.id) || null; },
            upsert: async ({ where, create }) => {
                dbCalls++;
                if (!records.has(where.id)) records.set(where.id, { ...create, status: 'pending' });
                return records.get(where.id);
            },
            updateMany: async () => { dbCalls++; return { count: 1 }; },
            update: async ({ where, data }) => {
                dbCalls++;
                const updated = { ...records.get(where.id), ...data };
                records.set(where.id, updated);
                return updated;
            },
        },
        notification: { upsert: async () => { dbCalls++; } },
    };
    db.$transaction = fn => fn(db);
    let server;
    const payload = {
        requestId: 'd9af842e-b36c-4eb0-87b9-ecc9e8ad3701', documentType: 'BOOSTER_SERVICE_AGREEMENT',
        startsAt: '2026-10-17', signerName: 'Test Booster',
    };
    try {
        require.cache[paths[0]] = { exports: db };
        require.cache[paths[1]] = { exports: {
            AGREEMENT_VERSION: 'FB-BSA-2.0',
            configuration: () => { configCalls++; return { templateId: 'old-remote-template', accountId: 'account', environment: 'demo' }; },
            companySigner: () => ({ name: 'Company Signer', email: 'owner@example.test' }),
            sendContract: async contract => { sent.push(contract); return `envelope-${contract.id}`; },
        } };
        delete require.cache[paths[2]];
        const app = express();
        app.use(express.json());
        app.use((req, res, next) => { req.actor = { id: req.headers['x-actor'] || 'admin', role: req.headers['x-role'] || 'ADMIN' }; next(); });
        app.use(require(paths[2]));
        app.use((error, req, res, next) => res.status(error.status || 500).json({ message: error.message }));
        server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
        const request = (body, headers = {}) => fetch(`http://127.0.0.1:${server.address().port}/boosters/booster/contracts`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
        });

        const unavailable = await request({ ...payload, documentType: 'PAYOUT_INFORMATION', effectiveAt: '2026-10-17' });
        assert.equal(unavailable.status, 409);
        assert.match((await unavailable.json()).message, /not available yet/);
        for (const documentType of ['OTHER', '', null, {}, 1]) {
            assert.equal((await request({ ...payload, documentType })).status, 400);
        }
        assert.equal((await request({ ...payload, startsAt: '2026-02-30' })).status, 400);
        assert.equal((await request(payload, { 'x-role': 'PROVIDER' })).status, 403);
        assert.equal(dbCalls, 0, 'invalid or unavailable documents never access the database');
        assert.equal(configCalls, 0, 'invalid or unavailable documents never initialize DocuSign');

        const response = await request({ ...payload, title: 'Injected document title', providerUsername: 'InjectedUsername' });
        assert.equal(response.status, 201);
        assert.deepEqual(await response.json(), { ok: true, id: payload.requestId });
        assert.equal(sent.length, 1);
        assert.equal(sent[0].title, 'Booster Service Agreement');
        assert.equal(sent[0].templateId, 'FB-BSA-2.0');
        assert.equal(sent[0].providerUsername, 'SavedUsername');
        assert.equal(sent[0].signerEmail, 'saved@example.test');
        assert.equal(sent[0].companySignerEmail, 'owner@example.test');
        assert.equal(sent[0].startsAt.toISOString(), '2026-10-17T00:00:00.000Z');

        assert.equal((await request(payload)).status, 201);
        assert.equal(sent.length, 1, 'duplicate request returns its existing envelope');
        assert.equal(configCalls, 1, 'saved requests do not replace their configuration snapshot');
        for (const body of [{ ...payload, signerName: 'Other Person' }, { ...payload, startsAt: '2026-10-18' }]) {
            assert.equal((await request(body)).status, 409);
        }
        assert.equal((await request(payload, { 'x-actor': 'different-admin' })).status, 409);
        assert.equal(sent.length, 1);

        const legacyId = 'd9af842e-b36c-4eb0-87b9-ecc9e8ad3702';
        records.set(legacyId, {
            ...sent[0], id: legacyId, title: 'Historical agreement title', templateId: 'historical-remote-template',
            companySignerName: 'Original Owner', companySignerEmail: 'original@example.test', envelopeId: null,
        });
        const { documentType, ...legacyPayload } = payload;
        assert.equal((await request({ ...legacyPayload, requestId: legacyId, title: 'Historical agreement title' })).status, 201);
        assert.equal(sent[1].templateId, 'historical-remote-template');
        assert.equal(sent[1].companySignerEmail, 'original@example.test');
        assert.equal(sent[1].title, 'Historical agreement title');
        assert.equal(configCalls, 1);
        assert.equal((await request({ ...legacyPayload, requestId: legacyId, title: 'Changed title' })).status, 409);

        const nextId = 'd9af842e-b36c-4eb0-87b9-ecc9e8ad3703';
        assert.equal((await request({ ...legacyPayload, requestId: nextId, title: 'Legacy free-form title' })).status, 201);
        assert.equal(sent[2].title, 'Booster Service Agreement', 'old clients also create the current canonical agreement');
        assert.equal(sent[2].templateId, 'FB-BSA-2.0');
        suspended = true;
        assert.equal((await request({ ...payload, requestId: 'd9af842e-b36c-4eb0-87b9-ecc9e8ad3704' })).status, 404);
    } finally {
        if (server) await new Promise(resolve => server.close(resolve));
        for (const [path, value] of saved) { if (value) require.cache[path] = value; else delete require.cache[path]; }
    }
});
