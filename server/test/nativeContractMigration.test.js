const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');

const timestamp = '2026-10-22T06:00:00.000Z';
const pdf = Buffer.from('%PDF-native-test-document');
const pdfHash = createHash('sha256').update(pdf).digest('hex');
const snapshot = { version: 'FB-BSA-2.1', values: { AgreementId: 'native' } };
const docHash = 'a'.repeat(64);
const jsonColumns = new Set(['nativeSnapshot', 'signature']);

function insert(db, table, values) {
    const keys = Object.keys(values);
    return db.query(`INSERT INTO "${table}" (${keys.map(key => `"${key}"`).join(', ')}) VALUES (${keys.map((_, index) => `$${index + 1}`).join(', ')})`,
        keys.map(key => jsonColumns.has(key) && values[key] !== null ? JSON.stringify(values[key]) : values[key]));
}

test('native contract migration preserves existing envelopes and enforces stored evidence constraints in PostgreSQL', async t => {
    // No filesystem data directory or connection string: every record lives in disposable RAM.
    const db = new PGlite();
    t.after(() => db.close());
    await db.exec(`CREATE TYPE "NotificationType" AS ENUM ('BASE');
        CREATE TABLE "User" (id TEXT PRIMARY KEY);
        CREATE TABLE "Order" (id TEXT PRIMARY KEY);
        INSERT INTO "User" VALUES ('owner'), ('booster');`);
    for (const migration of ['20260930000000_booster_contracts', '20260930010000_contract_countersignature']) {
        await db.exec(fs.readFileSync(path.join(__dirname, '../prisma/migrations', migration, 'migration.sql'), 'utf8'));
    }
    const legacy = {
        id: 'original-demo', boosterId: 'booster', issuedById: 'owner', title: 'Historical agreement',
        templateId: 'historical-remote-template', accountId: 'historical-account', environment: 'demo',
        envelopeId: 'historical-envelope', signerName: 'Original Booster', signerEmail: 'original@example.test',
        companySignerName: 'Original Owner', companySignerEmail: 'owner@example.test', startsAt: timestamp,
        companySignedAt: timestamp, boosterSignedAt: timestamp, signedAt: timestamp, status: 'completed',
    };
    await insert(db, 'BoosterContract', legacy);
    const before = (await db.query('SELECT * FROM "BoosterContract" WHERE id = $1', [legacy.id])).rows[0];
    await db.exec(fs.readFileSync(path.join(__dirname, '../prisma/migrations/20261022010000_native_contract_signing/migration.sql'), 'utf8'));

    const nativeValues = (extra = {}) => ({
        id: 'native', boosterId: 'booster', issuedById: 'owner', title: 'Booster Service Agreement',
        templateId: 'FB-BSA-2.1', accountId: 'fastboost', environment: 'production', signerName: 'Test Booster',
        signerEmail: 'booster@example.test', companySignerName: 'Test Owner', companySignerEmail: 'owner@example.test',
        startsAt: timestamp, signingProvider: 'FASTBOOST', nativeCompanySignerId: 'owner', nativeSnapshot: snapshot, ...extra,
    });
    const preparedValues = (extra = {}) => nativeValues({ nativeDocumentHash: docHash, nativePreparedAt: timestamp,
        nativePdf: pdf, nativePdfHash: pdfHash, ...extra });
    const signatureValues = (extra = {}) => ({
        id: 'company-signature', contractId: 'native', role: 'COMPANY', actorId: 'owner', actorEmail: 'owner@example.test',
        legalName: 'Test Owner', initials: 'TO', consentText: 'I consent to signing this exact agreement electronically.',
        signature: { type: 'typed' }, documentHash: docHash, requestId: 'first-request', requestHash: 'b'.repeat(64), ...extra,
    });

    await t.test('all historical fields survive and existing envelopes default to their original provider', async () => {
        const after = (await db.query('SELECT * FROM "BoosterContract" WHERE id = $1', [legacy.id])).rows[0];
        assert.deepEqual(Object.fromEntries(Object.keys(before).map(key => [key, after[key]])), before);
        assert.equal(after.signingProvider, 'DOCUSIGN');
        for (const key of ['nativeCompanySignerId', 'nativeSnapshot', 'nativeDocumentHash', 'nativePreparedAt', 'nativePdf', 'nativePdfHash', 'nativeCompletedAt', 'replacesContractId']) assert.equal(after[key], null, key);
    });

    await t.test('native identities, snapshot objects, prepared artifacts and digest formats cannot be omitted or corrupted', async () => {
        await assert.rejects(insert(db, 'BoosterContract', nativeValues({ signingProvider: 'UNRECOGNIZED' })), /BoosterContract_signingProvider_check/);
        for (const extra of [{ nativeCompanySignerId: null }, { nativeSnapshot: null }, { nativeSnapshot: [] }, { nativeSnapshot: 'snapshot-string' }]) {
            await assert.rejects(insert(db, 'BoosterContract', nativeValues(extra)), /BoosterContract_native_identity_check/);
        }
        for (const extra of [{ nativeDocumentHash: 'not-a-digest' }, { nativePdfHash: 'A'.repeat(64) }]) {
            await assert.rejects(insert(db, 'BoosterContract', nativeValues(extra)), /BoosterContract_native_hash_check/);
        }
        for (const extra of [{ nativeDocumentHash: null }, { nativePdf: null }, { nativePdf: Buffer.from('%PDF-') }, { nativePdfHash: null }]) {
            await assert.rejects(insert(db, 'BoosterContract', preparedValues(extra)), /BoosterContract_native_prepared_check/);
        }
        await insert(db, 'BoosterContract', preparedValues());
        const saved = (await db.query('SELECT "nativeSnapshot", "nativeDocumentHash", "nativePdf", "nativePdfHash" FROM "BoosterContract" WHERE id = $1', ['native'])).rows[0];
        assert.deepEqual(saved.nativeSnapshot, snapshot);
        assert.deepEqual(Buffer.from(saved.nativePdf), pdf);
        assert.equal(saved.nativeDocumentHash, docHash);
        assert.equal(saved.nativePdfHash, pdfHash);
    });

    await t.test('native completion requires prepared bytes and both party timestamps with one completion instant', async () => {
        for (const extra of [
            { id: 'incomplete', companySignedAt: timestamp },
            { id: 'incomplete', boosterSignedAt: timestamp },
            { id: 'incomplete', signedAt: timestamp },
            { id: 'incomplete', nativeCompletedAt: timestamp },
        ]) await assert.rejects(insert(db, 'BoosterContract', nativeValues(extra)), /BoosterContract_native_completion_check/);
        for (const extra of [
            { boosterSignedAt: timestamp },
            { signedAt: timestamp, companySignedAt: timestamp, boosterSignedAt: timestamp },
            { signedAt: timestamp, nativeCompletedAt: timestamp, boosterSignedAt: timestamp },
            { signedAt: timestamp, nativeCompletedAt: '2026-10-22T06:00:01.000Z', companySignedAt: timestamp, boosterSignedAt: timestamp },
        ]) await assert.rejects(insert(db, 'BoosterContract', preparedValues({ id: 'incomplete', ...extra })), /BoosterContract_native_completion_check/);
        await assert.rejects(db.query('UPDATE "BoosterContract" SET "nativeCompletedAt" = $1 WHERE id = $2', [timestamp, legacy.id]), /BoosterContract_native_completion_check/);
        await db.query(`UPDATE "BoosterContract" SET "companySignedAt" = $1, "boosterSignedAt" = $1,
            "signedAt" = $1, "nativeCompletedAt" = $1, status = 'completed' WHERE id = 'native'`, [timestamp]);
        const completed = (await db.query('SELECT status, "signedAt" = "nativeCompletedAt" AS same_instant FROM "BoosterContract" WHERE id = $1', ['native'])).rows[0];
        assert.deepEqual(completed, { status: 'completed', same_instant: true });
    });

    await t.test('signature evidence requires a real contract, supported role, names, consent, object payload and bounded audit details', async () => {
        await assert.rejects(insert(db, 'NativeContractSignature', signatureValues({ contractId: 'missing' })), /NativeContractSignature_contractId_fkey/);
        await assert.rejects(insert(db, 'NativeContractSignature', signatureValues({ role: 'OTHER' })), /NativeContractSignature_role_check/);
        for (const extra of [{ documentHash: 'bad' }, { requestHash: 'bad' }]) await assert.rejects(insert(db, 'NativeContractSignature', signatureValues(extra)), /NativeContractSignature_hash_check/);
        for (const extra of [{ legalName: ' ' }, { initials: '' }, { initials: 'x'.repeat(17) }]) await assert.rejects(insert(db, 'NativeContractSignature', signatureValues(extra)), /NativeContractSignature_name_check/);
        for (const extra of [{ actorId: '' }, { actorEmail: '' }, { consentText: '' }]) await assert.rejects(insert(db, 'NativeContractSignature', signatureValues(extra)), /NativeContractSignature_consent_check/);
        for (const signature of [[], 'signature-string']) await assert.rejects(insert(db, 'NativeContractSignature', signatureValues({ signature })), /NativeContractSignature_payload_check/);
        for (const extra of [{ clientIp: 'x'.repeat(129) }, { userAgent: 'x'.repeat(501) }]) await assert.rejects(insert(db, 'NativeContractSignature', signatureValues(extra)), /NativeContractSignature_audit_length_check/);
        await insert(db, 'NativeContractSignature', signatureValues({ clientIp: '192.0.2.12', userAgent: 'Test browser' }));
    });

    await t.test('each party signs once and each signing request belongs to one evidence record', async () => {
        await assert.rejects(insert(db, 'NativeContractSignature', signatureValues({ id: 'duplicate-role', requestId: 'different-request' })), /NativeContractSignature_contractId_role_key/);
        await assert.rejects(insert(db, 'NativeContractSignature', signatureValues({ id: 'duplicate-request', role: 'BOOSTER' })), /NativeContractSignature_contractId_requestId_key/);
        await insert(db, 'NativeContractSignature', signatureValues({ id: 'booster-signature', role: 'BOOSTER', actorId: 'booster', actorEmail: 'booster@example.test', legalName: 'Test Booster', initials: 'TB', requestId: 'second-request' }));
        assert.equal((await db.query('SELECT count(*)::int AS count FROM "NativeContractSignature" WHERE "contractId" = $1', ['native'])).rows[0].count, 2);
    });

    await t.test('one explicit replacement and retained signature foreign keys protect historical records', async () => {
        await insert(db, 'BoosterContract', nativeValues({ id: 'replacement', replacesContractId: legacy.id }));
        await assert.rejects(insert(db, 'BoosterContract', nativeValues({ id: 'other-replacement', replacesContractId: legacy.id })), /BoosterContract_replacesContractId_key/);
        await assert.rejects(db.query('DELETE FROM "BoosterContract" WHERE id = $1', ['native']), /NativeContractSignature_contractId_fkey/);
        assert.equal((await db.query('SELECT count(*)::int AS count FROM "NativeContractSignature"')).rows[0].count, 2);
        assert.equal((await db.query('SELECT "envelopeId" FROM "BoosterContract" WHERE id = $1', [legacy.id])).rows[0].envelopeId, 'historical-envelope');
    });
    t.diagnostic('Actual migration SQL ran in disposable in-memory PostgreSQL WASM. No hosted database or external signing service was contacted.');
});
