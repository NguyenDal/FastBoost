const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createHash } = require('node:crypto');

test('document creation defaults to website signing, rejects unavailable types and preserves legacy retry snapshots', async () => {
    const paths = ['../src/prisma', '../src/utils/docusign', '../src/routes/contractRoutes', '../src/utils/nativeContractSigning'].map(value => require.resolve(value));
    const saved = paths.map(path => [path, require.cache[path]]);
    const records = new Map();
    const sent = [];
    const issued = [];
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
        require.cache[paths[3]] = { exports: {
            PROVIDER: 'FASTBOOST',
            createContract: async (client, input) => {
                configCalls++;
                const booster = await client.user.findUnique({ where: { id: input.boosterId } });
                if (booster.suspendedAt) throw Object.assign(new Error('Active booster not found.'), { status: 404 });
                const record = { id: input.requestId, boosterId: input.boosterId, issuedById: input.issuedById,
                    title: 'Booster Service Agreement', signerName: input.signerName, signerEmail: booster.email,
                    providerUsername: booster.username, templateId: 'FB-BSA-2.1', signingProvider: 'FASTBOOST',
                    startsAt: new Date(input.startsAt), companySignerName: 'Company Signer', companySignerEmail: 'owner@example.test', status: 'sent' };
                issued.push(record); records.set(record.id, record); return record;
            },
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
        assert.equal(sent.length, 0, 'a new agreement never calls DocuSign');
        assert.equal(issued.length, 1);
        assert.equal(issued[0].title, 'Booster Service Agreement');
        assert.equal(issued[0].templateId, 'FB-BSA-2.1');
        assert.equal(issued[0].providerUsername, 'SavedUsername');
        assert.equal(issued[0].signerEmail, 'saved@example.test');
        assert.equal(issued[0].companySignerEmail, 'owner@example.test');
        assert.equal(issued[0].startsAt.toISOString(), '2026-10-17T00:00:00.000Z');

        assert.equal((await request(payload)).status, 201);
        assert.equal(issued.length, 1, 'duplicate request returns its existing website agreement');
        assert.equal(sent.length, 0);
        assert.equal(configCalls, 1, 'saved requests do not replace their configuration snapshot');
        for (const body of [{ ...payload, signerName: 'Other Person' }, { ...payload, startsAt: '2026-10-18' }]) {
            assert.equal((await request(body)).status, 409);
        }
        assert.equal((await request(payload, { 'x-actor': 'different-admin' })).status, 409);
        assert.equal(sent.length, 0);

        const legacyId = 'd9af842e-b36c-4eb0-87b9-ecc9e8ad3702';
        records.set(legacyId, {
            ...issued[0], id: legacyId, title: 'Historical agreement title', templateId: 'historical-remote-template', signingProvider: 'DOCUSIGN',
            companySignerName: 'Original Owner', companySignerEmail: 'original@example.test', envelopeId: null,
        });
        const { documentType, ...legacyPayload } = payload;
        assert.equal((await request({ ...legacyPayload, requestId: legacyId, title: 'Historical agreement title' })).status, 201);
        assert.equal(sent[0].templateId, 'historical-remote-template');
        assert.equal(sent[0].companySignerEmail, 'original@example.test');
        assert.equal(sent[0].title, 'Historical agreement title');
        assert.equal(configCalls, 1);
        assert.equal((await request({ ...legacyPayload, requestId: legacyId, title: 'Changed title' })).status, 409);

        const nextId = 'd9af842e-b36c-4eb0-87b9-ecc9e8ad3703';
        assert.equal((await request({ ...legacyPayload, requestId: nextId, title: 'Legacy free-form title' })).status, 201);
        assert.equal(issued[1].title, 'Booster Service Agreement', 'old clients also create the current canonical website agreement');
        assert.equal(issued[1].templateId, 'FB-BSA-2.1');
        assert.equal(sent.length, 1, 'only the explicit historical retry uses DocuSign');
        suspended = true;
        assert.equal((await request({ ...payload, requestId: 'd9af842e-b36c-4eb0-87b9-ecc9e8ad3704' })).status, 404);
    } finally {
        if (server) await new Promise(resolve => server.close(resolve));
        for (const [path, value] of saved) { if (value) require.cache[path] = value; else delete require.cache[path]; }
    }
});

test('native downloads render verified display copies while retaining authorization and original-version guards', async t => {
    const paths = ['../src/prisma', '../src/utils/docusign', '../src/routes/contractRoutes', '../src/utils/nativeContractSigning'].map(value => require.resolve(value));
    const saved = paths.map(path => [path, require.cache[path]]);
    const agreement = require('../src/utils/nativeAgreement');
    const originalRenderer = agreement.renderPresentationPdf;
    const originalPdf = Buffer.from('%PDF-1.7\noriginal retained signed document');
    const displayPdf = Buffer.from('%PDF-1.7\nmodern display copy');
    const snapshot = { version: 'FB-BSA-2.1', values: { WorkLocation: 'Original location' }, documentBase64: 'saved original base', fields: [] };
    const record = {
        id: 'contract', boosterId: 'booster', signingProvider: 'FASTBOOST', companySignerEmail: 'owner@example.test',
        nativeSnapshot: snapshot, nativeDocumentHash: agreement.snapshotHash(snapshot), nativePreparedAt: new Date('2026-10-24T00:00:00Z'),
        nativePdf: originalPdf, nativePdfHash: createHash('sha256').update(originalPdf).digest('hex'),
        companySignedAt: new Date('2026-10-24T01:00:00Z'), boosterSignedAt: new Date('2026-10-24T02:00:00Z'),
        signedAt: new Date('2026-10-24T02:00:00Z'), nativeCompletedAt: new Date('2026-10-24T02:00:00Z'),
    };
    const signatures = ['COMPANY', 'BOOSTER'].map(role => ({ contractId: record.id, role, documentHash: record.nativeDocumentHash,
        signedAt: role === 'COMPANY' ? record.companySignedAt : record.boosterSignedAt, legalName: `${role} signer`, signature: { type: 'typed' } }));
    let returnedSignatures = signatures, verificationCalls = 0, signatureReads = 0, renderCalls = 0, legacyCalls = 0, staleUnsigned = false, server;
    const db = {
        boosterContract: { findUnique: async ({ where }) => where.id === record.id ? record : null },
        nativeContractSignature: { findMany: async query => {
            signatureReads++;
            assert.deepEqual(query, { where: { contractId: record.id }, orderBy: [{ signedAt: 'asc' }, { role: 'asc' }] });
            return returnedSignatures;
        } },
    };
    try {
        agreement.renderPresentationPdf = async (savedSnapshot, savedSignatures, options) => {
            renderCalls++;
            assert.deepEqual(savedSnapshot, snapshot);
            assert.deepEqual(savedSignatures, signatures);
            assert.equal(options.completed, true);
            return displayPdf;
        };
        require.cache[paths[0]] = { exports: db };
        require.cache[paths[1]] = { exports: { document: async () => { legacyCalls++; return Buffer.from('%PDF-legacy'); } } };
        require.cache[paths[3]] = { exports: { PROVIDER: 'FASTBOOST', document: contract => {
            verificationCalls++;
            if (staleUnsigned) throw Object.assign(new Error('FastBoost must submit the current agreement before its PDF is available.'), { status: 409 });
            assert.equal(contract.nativePdf, originalPdf);
            return originalPdf;
        } } };
        delete require.cache[paths[2]];
        const app = express();
        app.use((req, res, next) => { req.actor = { id: req.headers['x-actor'] || 'booster', role: req.headers['x-role'] || 'PROVIDER' }; next(); });
        app.use(require(paths[2]));
        app.use((error, req, res, next) => res.status(error.status || 500).json({ message: error.message }));
        server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
        const request = headers => fetch(`http://127.0.0.1:${server.address().port}/contracts/contract/document`, { headers });

        assert.equal((await request({ 'x-actor': 'foreign' })).status, 404);
        assert.equal(verificationCalls, 0);
        const downloaded = await request();
        assert.equal(downloaded.status, 200);
        assert.match(downloaded.headers.get('content-type'), /application\/pdf/);
        assert.equal(await downloaded.text(), displayPdf.toString());
        assert.equal(verificationCalls, 1);
        assert.equal(signatureReads, 1);
        assert.equal(renderCalls, 1);
        assert.equal(record.nativePdf, originalPdf);
        assert.equal(record.nativeDocumentHash, agreement.snapshotHash(snapshot));

        staleUnsigned = true;
        assert.equal((await request({ 'x-role': 'ADMIN' })).status, 409);
        assert.equal(signatureReads, 1, 'the original unsigned-version check runs before fetching signatures');
        staleUnsigned = false;
        const originalCompanyDate = record.companySignedAt;
        record.companySignedAt = null;
        assert.equal((await request()).status, 403);
        assert.equal(signatureReads, 1, 'boosters cannot download before FastBoost signs');
        record.companySignedAt = originalCompanyDate;

        returnedSignatures = [signatures[0]];
        assert.equal((await request()).status, 503);
        assert.equal(renderCalls, 1, 'inconsistent rows cannot be presented as a completed agreement');
        returnedSignatures = signatures;
        record.archivedAt = new Date('2026-10-25T00:00:00Z');
        assert.equal((await request()).status, 200, 'archived originals remain available as modern display copies');
        assert.equal(record.nativePdf, originalPdf);

        record.signingProvider = 'DOCUSIGN'; record.envelopeId = 'original-envelope';
        const legacy = await request();
        assert.equal(legacy.status, 200);
        assert.equal(await legacy.text(), '%PDF-legacy');
        assert.equal(legacyCalls, 1, 'DocuSign keeps its original document path');
    } finally {
        if (server) await new Promise(resolve => server.close(resolve));
        if (originalRenderer === undefined) delete agreement.renderPresentationPdf; else agreement.renderPresentationPdf = originalRenderer;
        for (const [path, value] of saved) { if (value) require.cache[path] = value; else delete require.cache[path]; }
    }
});
