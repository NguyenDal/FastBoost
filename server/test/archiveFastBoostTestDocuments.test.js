const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');

const targetBooster = 'cmuf2qbv300043qm5zepdvyxb';
const targetIds = [
    '55d7c09e-de14-45de-96e3-b207eff86510',
    'b02a2e30-d47d-40ed-8c35-026e1e578640', '8114cb5e-9188-48d3-868d-e765c911880f',
    'f96573c9-c41b-4cac-9be0-d97607436f1a', '2012c599-0810-4d28-b11f-88a3e25e9b93',
];
const migrationName = '20261030010000_archive_fastboost_test_documents';
const migration = name => fs.readFileSync(path.join(__dirname, '../prisma/migrations', name, 'migration.sql'), 'utf8');
const timestamp = '2026-10-30T02:00:00.000Z';
const pdf = Buffer.from('%PDF-original-test-agreement-evidence');
const pdfHash = createHash('sha256').update(pdf).digest('hex');
const rows = async (db, table) => (await db.query(`SELECT * FROM "${table}" ORDER BY 1`)).rows;
const immutableContract = ({ archivedAt, ...record }) => record;

async function fixture(t, { account = true } = {}) {
    // With no data directory, PGlite is disposable PostgreSQL in memory. This
    // test never reads DATABASE_URL or imports the application/email worker.
    const db = new PGlite();
    t.after(() => db.close());
    await db.exec(`CREATE TYPE "NotificationType" AS ENUM ('BASE');
        CREATE TABLE "User" (id TEXT PRIMARY KEY, email TEXT UNIQUE, username TEXT UNIQUE);
        CREATE TABLE "Order" (id TEXT PRIMARY KEY);
        INSERT INTO "User" VALUES ('owner', 'owner@example.test', 'Owner'), ('other', 'other@example.test', 'Other');
        CREATE TABLE "Notification" (id TEXT PRIMARY KEY, "userId" TEXT NOT NULL REFERENCES "User"(id),
            type "NotificationType" NOT NULL, title TEXT NOT NULL, message TEXT NOT NULL, data JSONB,
            read BOOLEAN NOT NULL DEFAULT FALSE, active BOOLEAN NOT NULL DEFAULT TRUE, "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE "ManagementAuditLog" (id TEXT PRIMARY KEY, "targetId" TEXT, data JSONB);
        CREATE TABLE "BoosterEarningsEntry" (id TEXT PRIMARY KEY, "boosterId" TEXT, "amountCents" INTEGER);`);
    if (account) await db.query('INSERT INTO "User" VALUES ($1, $2, $3)', [targetBooster, 'support@fastboost.gg', 'FastBoost']);
    for (const name of ['20260930000000_booster_contracts', '20260930010000_contract_countersignature',
        '20261022010000_native_contract_signing', '20261022020000_archive_contracts',
        '20261025010000_native_contract_emails', '20261029010000_native_signature_optional_initials',
        '20261029020000_payout_information']) await db.exec(migration(name));
    async function contract(id, boosterId, completed = false) {
        await db.query(`INSERT INTO "BoosterContract" (id, "boosterId", "issuedById", title, "templateId", "accountId", environment,
            "signerName", "signerEmail", "companySignerName", "companySignerEmail", "startsAt", "createdAt", status,
            "signingProvider", "nativeCompanySignerId", "nativeSnapshot", "nativeDocumentHash", "nativePreparedAt", "nativePdf", "nativePdfHash",
            "companySignedAt", "boosterSignedAt", "signedAt", "nativeCompletedAt")
            VALUES ($1, $2, 'owner', 'Booster Service Agreement', 'FB-BSA-2.4', 'fastboost', 'production',
            'Synthetic Booster', $3, 'Synthetic Owner', 'owner@example.test', $4, $4, $5,
            'FASTBOOST', 'owner', $6, $7, $4, $8, $9, $10, $10, $10, $10)`,
        [id, boosterId, boosterId === targetBooster ? 'support@fastboost.gg' : 'other@example.test', timestamp,
            completed ? 'completed' : 'pending', JSON.stringify({ version: 'FB-BSA-2.4', values: { AgreementId: id, WorkLocation: 'Vietnam' } }),
            'a'.repeat(64), pdf, pdfHash, completed ? timestamp : null]);
    }
    if (account) {
        for (const [index, id] of targetIds.entries()) await contract(id, targetBooster, index === 0);
        await contract('new-document-for-fastboost', targetBooster);
        await db.query('INSERT INTO "BoosterProfile" VALUES ($1,$2)', [targetBooster, '2020-01-01T00:00:00.000Z']);
        await db.query(`INSERT INTO "PayoutInformation" (id,"boosterId","issuedById",country) VALUES ('future-payout',$1,'owner','VN')`, [targetBooster]);
        await db.query('INSERT INTO "BoosterEarningsEntry" VALUES ($1,$2,12345)', ['earnings-preserved', targetBooster]);
        for (const role of ['COMPANY', 'BOOSTER']) await db.query(`INSERT INTO "NativeContractSignature" (id,"contractId",role,"actorId","actorEmail",
            "legalName",initials,"consentText",signature,"documentHash","requestId","requestHash","signedAt","clientIp","userAgent")
            VALUES ($1,$2,$3,$4,$5,'Synthetic Signer','','Accepted exact test wording','{"type":"typed","style":1}',$6,$7,$8,$9,'192.0.2.1','Synthetic browser')`,
        [`signature-${role}`, targetIds[0], role, role === 'COMPANY' ? 'owner' : targetBooster,
            role === 'COMPANY' ? 'owner@example.test' : 'support@fastboost.gg', 'a'.repeat(64), `request-${role}`, 'b'.repeat(64), timestamp]);
        await db.query(`INSERT INTO "ManagementAuditLog" VALUES ('audit-preserved',$1,'{"action":"test-signing"}')`, [targetIds[0]]);
    }
    await contract('other-booster-document', 'other');
    return { db, contract };
}

async function email(db, id, contractId, values = {}) {
    await db.query(`INSERT INTO "NativeContractEmail" (id,"contractId",event,"recipientRole",attempts,"nextAttemptAt","sentAt","skippedAt",claim,"lastError")
        VALUES ($1,$2,$3,'BOOSTER',2,$4,$5,$6,$7,$8)`,
    [id, contractId, values.event || 'COMPLETED', values.nextAttemptAt || timestamp,
        values.sentAt || null, values.skippedAt || null, values.claim || null, values.lastError || null]);
}

async function notification(db, id, targetPath, type = 'BOOSTER_CONTRACT', userId = targetBooster) {
    await db.query(`INSERT INTO "Notification" (id,"userId",type,title,message,data)
        VALUES ($1,$2,$3,'Synthetic notice','Synthetic message',$4)`, [id, userId, type, JSON.stringify({ targetPath })]);
}

test('deployment cleanup hides only the captured FastBoost agreements and keeps all evidence and unrelated records', async t => {
    const { db } = await fixture(t);
    for (const id of targetIds) {
        await notification(db, `contract-${id}`, `/provider/contracts/${id}`);
        await notification(db, `contract-company-${id}`, `/provider/contracts/${id}`, 'BOOSTER_CONTRACT', 'owner');
    }
    await notification(db, 'contract-new-document-for-fastboost', '/provider/contracts/new-document-for-fastboost');
    await notification(db, 'unrelated-notification', '/provider/contracts/other-booster-document', 'BOOSTER_CONTRACT', 'other');
    await notification(db, 'other-notification-type', `/provider/contracts/${targetIds[0]}`, 'BASE');
    await email(db, 'pending-completion', targetIds[0]);
    await email(db, 'pending-invitation', targetIds[1], { event: 'COMPANY_SIGNED' });
    await email(db, 'sent-history', targetIds[0], { sentAt: timestamp });
    await email(db, 'previously-skipped', targetIds[2], { skippedAt: timestamp, lastError: 'EVENT_SUPERSEDED' });
    await email(db, 'other-outbox', 'other-booster-document');
    await email(db, 'new-outbox', 'new-document-for-fastboost');
    const beforeContracts = await rows(db, 'BoosterContract'), beforeEmails = await rows(db, 'NativeContractEmail');
    const beforeNotifications = await rows(db, 'Notification');
    const untouched = ['User', 'NativeContractSignature', 'BoosterProfile', 'PayoutInformation', 'BoosterEarningsEntry', 'ManagementAuditLog'];
    const beforeUntouched = await Promise.all(untouched.map(table => rows(db, table)));
    await db.exec(migration(migrationName));
    const afterContracts = await rows(db, 'BoosterContract');
    assert.deepEqual(afterContracts.map(immutableContract), beforeContracts.map(immutableContract), 'signed PDFs, hashes, snapshots and all agreement fields survive');
    assert.deepEqual(afterContracts.filter(row => row.archivedAt).map(row => row.id).sort(), [...targetIds].sort());
    assert.deepEqual(afterContracts.filter(row => !row.archivedAt).map(row => row.id).sort(), ['new-document-for-fastboost', 'other-booster-document']);
    for (const [index, table] of untouched.entries()) assert.deepEqual(await rows(db, table), beforeUntouched[index], `${table} remains unchanged`);
    const afterEmails = await rows(db, 'NativeContractEmail');
    for (const row of afterEmails) {
        const before = beforeEmails.find(item => item.id === row.id);
        if (['pending-completion', 'pending-invitation'].includes(row.id)) {
            assert.ok(row.skippedAt instanceof Date);
            assert.equal(row.sentAt, null); assert.equal(row.claim, null);
            assert.match(row.lastError, /TEST|CLEANUP|ARCHIV/i);
            assert.deepEqual({ ...row, skippedAt: before.skippedAt, claim: before.claim, lastError: before.lastError }, before);
        } else assert.deepEqual(row, before, 'sent/skipped and unrelated outbox history stays unchanged');
    }
    const expectedNotificationIds = targetIds.flatMap(id => [`contract-${id}`, `contract-company-${id}`]);
    const afterNotifications = await rows(db, 'Notification');
    for (const row of afterNotifications) {
        const before = beforeNotifications.find(item => item.id === row.id);
        if (expectedNotificationIds.includes(row.id)) {
            assert.equal(row.active, false);
            assert.deepEqual({ ...row, active: before.active }, before, 'notification read state and content remain unchanged');
        } else assert.deepEqual(row, before, 'other notification IDs/types stay unchanged');
    }
    const after = { contracts: afterContracts, emails: afterEmails, notifications: afterNotifications };
    await db.exec(migration(migrationName));
    assert.deepEqual({ contracts: await rows(db, 'BoosterContract'), emails: await rows(db, 'NativeContractEmail'), notifications: await rows(db, 'Notification') }, after,
        'rerunning the cleanup never changes archive timestamps, history or scope');
});

test('deployment cleanup is a no-op when the captured FastBoost account is absent', async t => {
    const { db } = await fixture(t, { account: false });
    const before = await rows(db, 'BoosterContract');
    await db.exec(migration(migrationName));
    assert.deepEqual(await rows(db, 'BoosterContract'), before);
});

test('identity, signing-provider and envelope guards preserve mismatched captured IDs', async t => {
    const { db } = await fixture(t);
    await db.query('UPDATE "BoosterContract" SET "boosterId"=$1 WHERE id=$2', ['other', targetIds[0]]);
    await db.query('UPDATE "BoosterContract" SET "signingProvider"=$1 WHERE id=$2', ['DOCUSIGN', targetIds[1]]);
    await db.query('UPDATE "BoosterContract" SET "envelopeId"=$1 WHERE id=$2', ['external-envelope', targetIds[2]]);
    await notification(db, `contract-${targetIds[3]}`, `/provider/contracts/${targetIds[3]}`, 'BASE');
    const before = await rows(db, 'BoosterContract'), notices = await rows(db, 'Notification');
    await db.exec(migration(migrationName));
    const after = await rows(db, 'BoosterContract');
    assert.deepEqual(after.map(immutableContract), before.map(immutableContract));
    assert.deepEqual(after.filter(row => row.archivedAt).map(row => row.id).sort(), targetIds.slice(3).sort());
    assert.deepEqual(await rows(db, 'Notification'), notices, 'a matching notification ID with another type is untouched');
});

test('an account with the same ID but a different email is untouched', async t => {
    const { db } = await fixture(t);
    await db.query('UPDATE "User" SET email=$1 WHERE id=$2', ['different@example.test', targetBooster]);
    const before = await rows(db, 'BoosterContract');
    await db.exec(migration(migrationName));
    assert.deepEqual(await rows(db, 'BoosterContract'), before);
});

test('any claimed target email fails closed with no partial cleanup, even after its retry time', async t => {
    const { db } = await fixture(t);
    await email(db, 'claimed-email', targetIds[0], { claim: 'active-worker', nextAttemptAt: new Date(Date.now() + 4 * 60_000).toISOString() });
    const beforeContracts = await rows(db, 'BoosterContract'), beforeEmails = await rows(db, 'NativeContractEmail');
    await assert.rejects(db.exec(migration(migrationName)), /claim|deliver|email|flight/i);
    await db.exec('ROLLBACK');
    assert.deepEqual(await rows(db, 'BoosterContract'), beforeContracts);
    assert.deepEqual(await rows(db, 'NativeContractEmail'), beforeEmails);
    await db.query('UPDATE "NativeContractEmail" SET "nextAttemptAt"=$1 WHERE id=$2', [new Date(Date.now() - 6 * 60_000).toISOString(), 'claimed-email']);
    await assert.rejects(db.exec(migration(migrationName)), /claim|deliver|email|flight/i);
    await db.exec('ROLLBACK');
    assert.deepEqual(await rows(db, 'BoosterContract'), beforeContracts);
    assert.equal((await rows(db, 'NativeContractEmail'))[0].claim, 'active-worker');
    await db.query('UPDATE "NativeContractEmail" SET claim=NULL WHERE id=$1', ['claimed-email']);
    await db.exec(migration(migrationName));
    const [outbox] = await rows(db, 'NativeContractEmail');
    assert.ok(outbox.skippedAt instanceof Date); assert.equal(outbox.claim, null); assert.equal(outbox.sentAt, null);
    assert.equal((await rows(db, 'BoosterContract')).filter(row => row.archivedAt).length, targetIds.length);
});
