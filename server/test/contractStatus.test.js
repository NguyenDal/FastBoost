const test = require('node:test');
const assert = require('node:assert/strict');
const docusign = require('../src/utils/docusign');
const { syncContract } = require('../src/utils/contractStatus');

test('company signature unlocks booster signing; tenure starts only after verified completion', async () => {
    const original = docusign.getStatus;
    let current = { id: 'contract', envelopeId: 'envelope', boosterId: 'booster', companySignerEmail: 'owner@example.test', startsAt: new Date('2026-09-01'), signedAt: null };
    const notices = [], profiles = [];
    const db = { $transaction: async fn => fn({
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
