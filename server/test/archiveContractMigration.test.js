const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');

const migrations = path.join(__dirname, '../prisma/migrations');
const readMigration = name => fs.readFileSync(path.join(migrations, name, 'migration.sql'), 'utf8');

test('archive migration adds visibility metadata without archiving or changing any agreement evidence', async t => {
    // A new PGlite without a data directory is disposable RAM, never the configured application database.
    const db = new PGlite();
    t.after(() => db.close());
    await db.exec(`CREATE TYPE "NotificationType" AS ENUM ('BASE');
        CREATE TABLE "User" (id TEXT PRIMARY KEY);
        CREATE TABLE "Order" (id TEXT PRIMARY KEY);
        INSERT INTO "User" VALUES ('owner'), ('booster');`);
    for (const migration of ['20260930000000_booster_contracts', '20260930010000_contract_countersignature']) await db.exec(readMigration(migration));
    const nativeSql = readMigration('20261022010000_native_contract_signing');
    assert.equal(createHash('sha256').update(nativeSql).digest('hex'), 'ae4ed79009adab1e8fd523aa738ac401796cf021cdaf106202e243ad111477c5', 'the previously verified native-signing migration stays unchanged');
    await db.exec(nativeSql);
    const timestamp = '2026-10-22T06:00:00.000Z';
    const pdf = Buffer.from('%PDF-retained-signed-contract');
    const hash = createHash('sha256').update(pdf).digest('hex');
    await db.query(`INSERT INTO "BoosterContract" (id, "boosterId", "issuedById", title, "templateId", "accountId", environment,
        "envelopeId", "signerName", "signerEmail", "companySignerName", "companySignerEmail", "startsAt", status,
        "companySignedAt", "boosterSignedAt", "signedAt") VALUES
        ('legacy', 'booster', 'owner', 'Original signed envelope', 'remote-template', 'sandbox-account', 'demo',
        'original-envelope', 'Test Booster', 'booster@example.test', 'Test Owner', 'owner@example.test', $1, 'completed', $1, $1, $1)`, [timestamp]);
    await db.query(`INSERT INTO "BoosterContract" (id, "boosterId", "issuedById", title, "templateId", "accountId", environment,
        "signerName", "signerEmail", "companySignerName", "companySignerEmail", "startsAt", status, "signingProvider",
        "nativeCompanySignerId", "nativeSnapshot", "nativeDocumentHash", "nativePreparedAt", "nativePdf", "nativePdfHash",
        "companySignedAt", "boosterSignedAt", "signedAt", "nativeCompletedAt") VALUES
        ('native', 'booster', 'owner', 'Signed website agreement', 'FB-BSA-2.1', 'fastboost', 'production',
        'Test Booster', 'booster@example.test', 'Test Owner', 'owner@example.test', $1, 'completed', 'FASTBOOST',
        'owner', $2, $3, $1, $4, $5, $1, $1, $1, $1)`, [timestamp, JSON.stringify({ version: 'FB-BSA-2.1', values: { AgreementId: 'native', PaymentMethod: 'Retained transfer rule' } }), 'a'.repeat(64), pdf, hash]);
    for (const [id, role, actorId, legalName] of [['company-evidence', 'COMPANY', 'owner', 'Test Owner'], ['booster-evidence', 'BOOSTER', 'booster', 'Test Booster']]) {
        await db.query(`INSERT INTO "NativeContractSignature" (id, "contractId", role, "actorId", "actorEmail", "legalName", initials,
            "consentText", signature, "documentHash", "requestId", "requestHash", "signedAt", "clientIp", "userAgent")
            VALUES ($1, 'native', $2, $3, $4, $5, 'TS', 'I consent to this exact agreement.', '{"type":"typed"}', $6, $7, $8, $9, '192.0.2.12', 'Retained browser')`,
        [id, role, actorId, `${actorId}@example.test`, legalName, 'a'.repeat(64), `request-${id}`, 'b'.repeat(64), timestamp]);
    }
    await db.query('INSERT INTO "BoosterProfile" ("userId", "startedAt") VALUES ($1, $2)', ['booster', '2020-01-01T00:00:00.000Z']);
    const agreementsBefore = (await db.query('SELECT * FROM "BoosterContract" ORDER BY id')).rows;
    const evidenceBefore = (await db.query('SELECT * FROM "NativeContractSignature" ORDER BY id')).rows;
    const tenureBefore = (await db.query('SELECT * FROM "BoosterProfile"')).rows;
    const archiveSql = readMigration('20261022020000_archive_contracts');
    assert.doesNotMatch(archiveSql.replace(/--[^\r\n]*/g, ''), /\b(?:UPDATE|DELETE|TRUNCATE|DROP)\b/i, 'schema activation performs no archival or destructive data mutation');
    await db.exec(archiveSql);

    await t.test('all existing agreements start unarchived with every original field preserved', async () => {
        const after = (await db.query('SELECT * FROM "BoosterContract" ORDER BY id')).rows;
        assert.equal(after.length, agreementsBefore.length);
        after.forEach((agreement, index) => {
            assert.equal(agreement.archivedAt, null);
            const { archivedAt, ...oldFields } = agreement;
            assert.deepEqual(oldFields, agreementsBefore[index]);
        });
        assert.deepEqual((await db.query('SELECT * FROM "NativeContractSignature" ORDER BY id')).rows, evidenceBefore);
        assert.deepEqual((await db.query('SELECT * FROM "BoosterProfile"')).rows, tenureBefore);
    });

    await t.test('an explicit archive changes only visibility and retains complete signed PDFs, evidence and tenure', async () => {
        await db.query('UPDATE "BoosterContract" SET "archivedAt" = $1 WHERE id = $2', ['2026-10-22T07:00:00.000Z', 'native']);
        assert.deepEqual((await db.query('SELECT id FROM "BoosterContract" WHERE "archivedAt" IS NULL ORDER BY id')).rows, [{ id: 'legacy' }]);
        const archived = (await db.query('SELECT * FROM "BoosterContract" WHERE "archivedAt" IS NOT NULL')).rows;
        assert.equal(archived.length, 1);
        assert.equal(archived[0].id, 'native');
        const { archivedAt, ...oldFields } = archived[0];
        assert.ok(archivedAt instanceof Date);
        assert.deepEqual(oldFields, agreementsBefore.find(agreement => agreement.id === 'native'));
        assert.deepEqual(Buffer.from(archived[0].nativePdf), pdf);
        assert.equal(archived[0].nativePdfHash, hash);
        assert.deepEqual((await db.query('SELECT * FROM "NativeContractSignature" ORDER BY id')).rows, evidenceBefore);
        assert.deepEqual((await db.query('SELECT * FROM "BoosterProfile"')).rows, tenureBefore);
        await assert.rejects(db.query('DELETE FROM "BoosterContract" WHERE id = $1', ['native']), /NativeContractSignature_contractId_fkey/);
    });

    await t.test('new agreements remain active unless explicitly archived', async () => {
        await db.query(`INSERT INTO "BoosterContract" (id, "boosterId", "issuedById", title, "templateId", "accountId", environment,
            "signerName", "signerEmail", "startsAt") VALUES
            ('new', 'booster', 'owner', 'New agreement', 'legacy-template', 'account', 'demo', 'Test Booster', 'booster@example.test', $1)`, [timestamp]);
        const created = (await db.query('SELECT "archivedAt" FROM "BoosterContract" WHERE id = $1', ['new'])).rows[0];
        assert.equal(created.archivedAt, null);
        assert.deepEqual((await db.query('SELECT id FROM "BoosterContract" WHERE "archivedAt" IS NULL ORDER BY id')).rows, [{ id: 'legacy' }, { id: 'new' }]);
    });
    t.diagnostic('Archive DDL and explicit archival behavior verified only in disposable PostgreSQL WASM memory. No hosted data was archived.');
});
