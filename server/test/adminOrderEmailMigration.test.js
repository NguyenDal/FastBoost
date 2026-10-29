const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

test('admin order email migration enforces recipient deduplication and references without changing orders', async t => {
    const db = new PGlite(); t.after(() => db.close());
    await db.exec(`CREATE TABLE "User" (id TEXT PRIMARY KEY); CREATE TABLE "Order" (id TEXT PRIMARY KEY, status TEXT);
        INSERT INTO "User" VALUES ('admin-a'), ('admin-b'); INSERT INTO "Order" VALUES ('order-1', 'PENDING');`);
    await db.exec(fs.readFileSync(path.join(__dirname, '../prisma/migrations/20261029030000_admin_order_email/migration.sql'), 'utf8'));
    const insert = (id, adminId, orderId = 'order-1') => db.query(`INSERT INTO "AdminOrderEmail" (id,"orderId","adminId",payload) VALUES ($1,$2,$3,'{}')`, [id, orderId, adminId]);
    await insert('first', 'admin-a'); await insert('second', 'admin-b');
    await assert.rejects(insert('duplicate', 'admin-a'), /AdminOrderEmail_orderId_adminId_key/);
    await assert.rejects(insert('unknown-admin', 'missing'), /AdminOrderEmail_adminId_fkey/);
    await assert.rejects(insert('unknown-order', 'admin-a', 'missing'), /AdminOrderEmail_orderId_fkey/);
    await assert.rejects(db.exec(`UPDATE "AdminOrderEmail" SET attempts=-1`), /AdminOrderEmail_attempts_check/);
    assert.deepEqual((await db.query('SELECT * FROM "Order"')).rows, [{ id: 'order-1', status: 'PENDING' }]);
    const rows = (await db.query('SELECT attempts,"sentAt","skippedAt" FROM "AdminOrderEmail"')).rows;
    assert.deepEqual(rows, [{ attempts: 0, sentAt: null, skippedAt: null }, { attempts: 0, sentAt: null, skippedAt: null }]);
    await db.exec(`DELETE FROM "User" WHERE id='admin-a'`);
    assert.equal((await db.query('SELECT count(*) FROM "AdminOrderEmail"')).rows[0].count, 1);
    t.diagnostic('Disposable in-memory PostgreSQL only; no SMTP or external database access.');
});
