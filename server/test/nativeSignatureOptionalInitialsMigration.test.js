const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');

const sql = name => fs.readFileSync(path.join(__dirname, '../prisma/migrations', name, 'migration.sql'), 'utf8');
const hash = value => createHash('sha256').update(value).digest('hex');
function insert(db, table, row) {
    const keys = Object.keys(row);
    return db.query(`INSERT INTO "${table}" (${keys.map(key => `"${key}"`).join(',')}) VALUES (${keys.map((_, index) => `$${index + 1}`).join(',')})`,
        keys.map(key => ['nativeSnapshot', 'signature'].includes(key) ? JSON.stringify(row[key]) : row[key]));
}

test('the forward migration permits typed and drawn name-only signatures without changing historical evidence or other checks', async t => {
    const db = new PGlite();
    t.after(() => db.close());
    await db.exec(`CREATE TYPE "NotificationType" AS ENUM ('BASE');
        CREATE TABLE "User" (id TEXT PRIMARY KEY);
        CREATE TABLE "Order" (id TEXT PRIMARY KEY);
        INSERT INTO "User" VALUES ('owner'), ('provider');`);
    for (const name of ['20260930000000_booster_contracts', '20260930010000_contract_countersignature', '20261022010000_native_contract_signing']) {
        await db.exec(sql(name));
    }
    const timestamp = '2026-10-29T02:00:00.000Z';
    const pdf = Buffer.from('%PDF-synthetic-company-signed-agreement');
    const snapshot = { version: 'FB-BSA-2.4', values: { AgreementId: 'name-only' } };
    const contract = { id: 'name-only', boosterId: 'provider', issuedById: 'owner', title: 'Synthetic agreement',
        templateId: 'FB-BSA-2.4', accountId: 'fastboost', environment: 'production', signerName: 'Test Provider',
        signerEmail: 'provider@example.test', companySignerName: 'Test Owner', companySignerEmail: 'owner@example.test',
        startsAt: timestamp, signingProvider: 'FASTBOOST', nativeCompanySignerId: 'owner', nativeSnapshot: snapshot,
        nativeDocumentHash: hash(JSON.stringify(snapshot)), nativePreparedAt: timestamp, nativePdf: pdf, nativePdfHash: hash(pdf),
        companySignedAt: timestamp };
    await insert(db, 'BoosterContract', contract);
    const company = { id: 'company-signature', contractId: contract.id, role: 'COMPANY', actorId: 'owner', actorEmail: 'owner@example.test',
        legalName: 'Test Owner', initials: 'TO', consentText: 'Historical consent and initials.', signature: { type: 'typed' },
        documentHash: contract.nativeDocumentHash, requestId: 'company-request', requestHash: 'b'.repeat(64), signedAt: timestamp };
    await insert(db, 'NativeContractSignature', company);
    const provider = { ...company, id: 'provider-signature', role: 'BOOSTER', actorId: 'provider', actorEmail: 'provider@example.test',
        legalName: 'Test Provider', initials: '', consentText: 'Explicitly submitted Sign agreement.', requestId: 'provider-request',
        signature: { type: 'drawn', width: 600, height: 180, strokes: [[[12, 80], [100, 40], [220, 110]]] } };
    await assert.rejects(insert(db, 'NativeContractSignature', provider), error => error.code === '23514'
        && /NativeContractSignature_name_check/.test(error.message), 'reproduce the actual old database rejection');
    const before = (await db.query('SELECT * FROM "NativeContractSignature" ORDER BY id')).rows;
    const contractBefore = (await db.query('SELECT * FROM "BoosterContract" ORDER BY id')).rows;
    await db.exec(sql('20261029010000_native_signature_optional_initials'));
    assert.deepEqual((await db.query('SELECT * FROM "NativeContractSignature" ORDER BY id')).rows, before);
    assert.deepEqual((await db.query('SELECT * FROM "BoosterContract" ORDER BY id')).rows, contractBefore);
    await insert(db, 'NativeContractSignature', provider);
    const saved = (await db.query('SELECT initials, signature, "requestId" FROM "NativeContractSignature" WHERE id = $1', [provider.id])).rows[0];
    assert.deepEqual(saved, { initials: '', signature: provider.signature, requestId: provider.requestId });
    await db.query('UPDATE "BoosterContract" SET "boosterSignedAt" = $1, "signedAt" = $1, "nativeCompletedAt" = $1, status = $2 WHERE id = $3',
        [timestamp, 'completed', contract.id]);
    assert.equal((await db.query('SELECT status FROM "BoosterContract" WHERE id = $1', [contract.id])).rows[0].status, 'completed');

    await insert(db, 'BoosterContract', { ...contract, id: 'typed-name-only' });
    const typed = { ...company, id: 'typed-name-only-signature', contractId: 'typed-name-only', initials: '', signature: { type: 'typed', style: 1 } };
    for (const change of [{ legalName: 'X' }, { legalName: 'X'.repeat(101) }, { initials: 'X'.repeat(17) }]) {
        await assert.rejects(insert(db, 'NativeContractSignature', { ...typed, ...change }), /NativeContractSignature_name_check/);
    }
    await assert.rejects(insert(db, 'NativeContractSignature', { ...typed, initials: null }), error => error.code === '23502');
    await assert.rejects(insert(db, 'NativeContractSignature', { ...typed, role: 'OTHER' }), /NativeContractSignature_role_check/);
    await assert.rejects(insert(db, 'NativeContractSignature', { ...typed, requestHash: 'invalid' }), /NativeContractSignature_hash_check/);
    await assert.rejects(insert(db, 'NativeContractSignature', { ...typed, consentText: '' }), /NativeContractSignature_consent_check/);
    await insert(db, 'NativeContractSignature', typed);
    await assert.rejects(insert(db, 'NativeContractSignature', { ...provider, id: 'duplicate', requestId: 'another' }), /NativeContractSignature_contractId_role_key/);
    await assert.rejects(db.query('DELETE FROM "BoosterContract" WHERE id = $1', [contract.id]), /NativeContractSignature_contractId_fkey/);
    t.diagnostic('Actual old and forward migration SQL ran in disposable in-memory PostgreSQL. No development or production database was changed.');
});
