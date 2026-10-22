const test = require('node:test');
const assert = require('node:assert/strict');
const docusign = require('../src/utils/docusign');
const { syncContract } = require('../src/utils/contractStatus');

test('company signature unlocks booster signing; tenure starts only after verified completion', async () => {
    const original = docusign.getStatus;
    let current = { id: 'contract', envelopeId: 'envelope', boosterId: 'booster', companySignerEmail: 'owner@example.test', startsAt: new Date('2026-09-01'), signedAt: null };
    const notices = [], profiles = [];
    const db = { $transaction: async fn => fn({
        $queryRawUnsafe: async () => [],
        boosterContract: {
            findUnique: async () => ({ ...current }),
            update: async ({ data }) => (current = { ...current, ...data }),
        },
        notification: { updateMany: async args => { notices.push(args); } },
        boosterProfile: {
            upsert: async args => { profiles.push(args); },
            updateMany: async args => { profiles.push(args); },
        },
    }) };
    try {
        docusign.getStatus = async () => ({ status: 'sent', companySignedAt: new Date('2026-09-30T11:00:00Z') });
        const partial = await syncContract(db, current);
        assert.equal(partial.signedAt, null);
        assert.equal(profiles.length, 0);
        assert.deepEqual(notices[0].data, { title: 'Contract ready to sign', read: false });
        const stale = { ...partial };
        const signedAt = new Date('2026-09-30T12:00:00Z');
        docusign.getStatus = async () => ({ status: 'completed', signedAt, boosterSignedAt: signedAt, signedName: 'Test Booster' });
        await syncContract(db, current);
        assert.equal(current.signedAt, signedAt);
        assert.equal(profiles[0].create.startedAt.toISOString(), signedAt.toISOString());
        assert.deepEqual(profiles[0].update, {}, 'do not replace an established tenure start');
        assert.ok(notices.some(n => n.where.id === 'contract-company-contract' && n.data.read));
        docusign.getStatus = async () => ({ status: 'sent' });
        await syncContract(db, stale);
        assert.equal(current.status, 'completed', 'delayed webhook cannot erase completion');
        assert.equal(profiles.length, 2);
    } finally { docusign.getStatus = original; }
});

test('a delayed DocuSign completion locks and rechecks a sandbox replacement before recording tenure', async () => {
    const original = docusign.getStatus;
    const current = { id: 'legacy', envelopeId: 'demo-envelope', boosterId: 'booster', startsAt: new Date('2026-10-01'), status: 'sent' };
    const events = [];
    let releaseReplacement;
    const replacement = new Promise(resolve => { releaseReplacement = resolve; });
    const tx = {
        $queryRawUnsafe: async (sql, id) => { assert.match(sql, /FOR UPDATE/); assert.equal(id, 'legacy'); events.push('lock'); await replacement; },
        boosterContract: { findUnique: async () => { events.push('read'); return { ...current }; }, update: async () => { throw new Error('retired agreement must not update'); } },
        boosterProfile: { upsert: async () => { throw new Error('retired agreement must not grant tenure'); } },
    };
    try {
        docusign.getStatus = async () => ({ status: 'completed', signedAt: new Date(), companySignedAt: new Date(), boosterSignedAt: new Date() });
        const result = syncContract({ $transaction: fn => fn(tx) }, { ...current });
        await new Promise(resolve => setImmediate(resolve));
        assert.deepEqual(events, ['lock'], 'the transaction waits for replacement before reading state');
        Object.assign(current, { revokedAt: new Date(), status: 'replaced' });
        releaseReplacement();
        assert.equal((await result).status, 'replaced');
        assert.deepEqual(events, ['lock', 'read']);
    } finally { releaseReplacement(); docusign.getStatus = original; }
});

test('archiving blocks a delayed DocuSign completion without changing the saved status or granting tenure', async () => {
    const original = docusign.getStatus;
    const current = { id: 'archived', envelopeId: 'demo-envelope', boosterId: 'booster', startsAt: new Date('2026-10-01'), status: 'sent' };
    const stale = { ...current };
    let externalReads = 0, releaseArchive;
    const archive = new Promise(resolve => { releaseArchive = resolve; });
    const tx = {
        $queryRawUnsafe: async () => archive,
        boosterContract: { findUnique: async () => ({ ...current }), update: async () => { throw new Error('archive cannot change signing state'); } },
        boosterProfile: { upsert: async () => { throw new Error('archive cannot grant tenure'); } },
    };
    try {
        docusign.getStatus = async () => { externalReads++; return { status: 'completed', signedAt: new Date(), boosterSignedAt: new Date() }; };
        const pending = syncContract({ $transaction: fn => fn(tx) }, stale);
        await new Promise(resolve => setImmediate(resolve));
        current.archivedAt = new Date();
        releaseArchive();
        assert.deepEqual(await pending, current);
        assert.equal(current.status, 'sent');
        assert.equal(current.signedAt, undefined);
        assert.deepEqual(await syncContract({}, current), current);
        assert.equal(externalReads, 1, 'an already archived agreement never reads the external provider');
    } finally { releaseArchive(); docusign.getStatus = original; }
});
