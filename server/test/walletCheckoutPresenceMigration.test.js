const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

test('checkout presence stores independent view leases and tombstones without a wallet account', async t => {
    const db = new PGlite();
    t.after(() => db.close());
    await db.exec('CREATE TABLE "User" (id TEXT PRIMARY KEY); CREATE TABLE "Order" (id TEXT PRIMARY KEY);');
    await db.exec(fs.readFileSync(path.join(__dirname,
        '../prisma/migrations/20261021040000_wallet_checkout_presence/migration.sql'), 'utf8'));
    await db.exec(`INSERT INTO "User" VALUES ('customer'), ('other'); INSERT INTO "Order" VALUES ('order'), ('other');
        INSERT INTO "WalletCheckoutPresence" (id, "userId", "orderId", "expiresAt", "updatedAt") VALUES
        ('first-view', 'customer', 'order', CURRENT_TIMESTAMP + INTERVAL '4 minutes', CURRENT_TIMESTAMP),
        ('second-view', 'customer', 'order', CURRENT_TIMESTAMP + INTERVAL '4 minutes', CURRENT_TIMESTAMP);
        UPDATE "WalletCheckoutPresence" SET "closedAt" = CURRENT_TIMESTAMP, "expiresAt" = CURRENT_TIMESTAMP WHERE id = 'first-view';`);
    assert.deepEqual((await db.query('SELECT id, "closedAt" IS NOT NULL AS closed FROM "WalletCheckoutPresence" ORDER BY id')).rows,
        [{ id: 'first-view', closed: true }, { id: 'second-view', closed: false }]);
    await assert.rejects(db.exec(`INSERT INTO "WalletCheckoutPresence" (id, "userId", "orderId", "expiresAt", "updatedAt")
        VALUES ('first-view', 'customer', 'order', CURRENT_TIMESTAMP + INTERVAL '4 minutes', CURRENT_TIMESTAMP)`),
    /WalletCheckoutPresence_pkey/);
    await db.exec(`UPDATE "WalletCheckoutPresence" SET "closedAt" = CURRENT_TIMESTAMP,
        "paymentProtectedUntil" = CURRENT_TIMESTAMP + INTERVAL '4 minutes',
        "expiresAt" = CURRENT_TIMESTAMP + INTERVAL '4 minutes' WHERE id = 'second-view';`);
    assert.equal((await db.query(`SELECT count(*)::int AS count FROM "WalletCheckoutPresence"
        WHERE "expiresAt" > CURRENT_TIMESTAMP AND "paymentProtectedUntil" IS NOT NULL`)).rows[0].count, 1);
    await assert.rejects(db.exec(`INSERT INTO "WalletCheckoutPresence" (id, "userId", "orderId", "expiresAt", "updatedAt")
        VALUES ('unknown-user', 'missing', 'order', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`), /WalletCheckoutPresence_userId_fkey/);
    await assert.rejects(db.exec(`INSERT INTO "WalletCheckoutPresence" (id, "userId", "orderId", "expiresAt", "updatedAt")
        VALUES ('unknown-order', 'customer', 'missing', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`), /WalletCheckoutPresence_orderId_fkey/);
    await db.exec(`INSERT INTO "WalletCheckoutPresence" (id, "userId", "orderId", "expiresAt", "updatedAt")
        VALUES ('other-user-view', 'other', 'other', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
        DELETE FROM "Order" WHERE id = 'order';`);
    assert.deepEqual((await db.query('SELECT id FROM "WalletCheckoutPresence"')).rows, [{ id: 'other-user-view' }]);
    await db.exec(`DELETE FROM "User" WHERE id = 'other';`);
    assert.equal((await db.query('SELECT count(*)::int AS count FROM "WalletCheckoutPresence"')).rows[0].count, 0);
});
