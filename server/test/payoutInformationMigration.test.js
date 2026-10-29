const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

test('payout migration enforces singleton ownership, state/evidence checks and review separation in PostgreSQL', async t => {
    const db = new PGlite(); t.after(() => db.close());
    await db.exec(`CREATE TYPE "NotificationType" AS ENUM ('BOOSTER_CONTRACT');
        CREATE TABLE "User" (id TEXT PRIMARY KEY);
        INSERT INTO "User" VALUES ('admin'), ('provider');`);
    await db.exec(fs.readFileSync(path.join(__dirname, '../prisma/migrations/20261029020000_payout_information/migration.sql'), 'utf8'));
    const insert = (id, boosterId, country) => db.query('INSERT INTO "PayoutInformation" (id, "boosterId", "issuedById", country) VALUES ($1,$2,$3,$4)', [id, boosterId, 'admin', country]);
    await insert('request', 'provider', 'US');
    await assert.rejects(insert('duplicate', 'provider', 'VN'), /PayoutInformation_boosterId_key/);
    await assert.rejects(insert('missing-user', 'missing', 'US'), /PayoutInformation_boosterId_fkey/);
    await assert.rejects(db.query('UPDATE "PayoutInformation" SET country=$1 WHERE id=$2', ['CA', 'request']), /PayoutInformation_country_currency_check/);
    await assert.rejects(db.query('UPDATE "PayoutInformation" SET status=$1 WHERE id=$2', ['SUBMITTED', 'request']), /PayoutInformation_details_check/);
    const submit = revision => db.query(`UPDATE "PayoutInformation" SET status='SUBMITTED', revision=1, "detailsRevision"=$1,
        currency='USD', "accountLast4"='4567', "encryptedDetails"='{"version":1}', "submittedAt"=NOW(), "confirmedAt"=NOW() WHERE id='request'`, [revision]);
    await assert.rejects(submit(null), /PayoutInformation_details_check/, 'NULL must not bypass SQL CHECK');
    await assert.rejects(submit(2), /PayoutInformation_details_check/, 'payload revision cannot be ahead of request revision');
    await submit(1);
    await assert.rejects(db.exec(`UPDATE "PayoutInformation" SET status='VERIFIED', "reviewedAt"=NOW(), "reviewedById"='provider' WHERE id='request'`), /PayoutInformation_review_check/);
    await assert.rejects(db.exec(`UPDATE "PayoutInformation" SET status='CHANGES_REQUESTED', "reviewedAt"=NOW(), "reviewedById"='admin', "correctionReason"=NULL WHERE id='request'`), /PayoutInformation_review_check/);
    await db.exec(`UPDATE "PayoutInformation" SET status='VERIFIED', revision=2, "reviewedAt"=NOW(), "reviewedById"='admin' WHERE id='request'`);
    assert.equal((await db.query('SELECT status FROM "PayoutInformation" WHERE id=$1', ['request'])).rows[0].status, 'VERIFIED');
    await assert.rejects(db.exec(`UPDATE "PayoutInformation" SET "accountLast4"='123456789' WHERE id='request'`), /PayoutInformation_last4_check/);
    await assert.rejects(db.exec(`DELETE FROM "User" WHERE id='provider'`), /PayoutInformation_boosterId_fkey/);
    await assert.rejects(db.exec(`UPDATE "PayoutInformation" SET currency='VND' WHERE id='request'`), /PayoutInformation_country_currency_check/);
    const columns = (await db.query(`SELECT column_name FROM information_schema.columns WHERE table_name='PayoutInformation'`)).rows.map(row => row.column_name);
    assert.equal(columns.some(name => ['accountNumber', 'routingNumber', 'bankName', 'legalName'].includes(name)), false);
    const notifications = (await db.query(`SELECT enumlabel FROM pg_enum WHERE enumtypid='"NotificationType"'::regtype`)).rows.map(row => row.enumlabel);
    assert.ok(notifications.includes('BOOSTER_PAYOUT_INFORMATION'));
    t.diagnostic('Ran only in disposable in-memory PostgreSQL; no real bank details or external database writes.');
});
