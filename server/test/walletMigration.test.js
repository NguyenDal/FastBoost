const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

test('wallet migration enforces fixed packages, balanced immutable entries and retained financial history in memory', async t => {
    const db = new PGlite();
    t.after(() => db.close());
    await db.exec('CREATE TABLE "User" (id TEXT PRIMARY KEY); CREATE TABLE "Order" (id TEXT PRIMARY KEY);');
    await db.exec(fs.readFileSync(path.join(__dirname, '../prisma/migrations/20261020010000_customer_wallet/migration.sql'), 'utf8'));
    await db.exec(fs.readFileSync(path.join(__dirname, '../prisma/migrations/20261020020000_order_promotion_snapshot/migration.sql'), 'utf8'));
    await db.exec(fs.readFileSync(path.join(__dirname, '../prisma/migrations/20261020030000_customer_order_cashback/migration.sql'), 'utf8'));
    await db.exec(`INSERT INTO "User" VALUES ('customer');
        INSERT INTO "WalletAccount" ("userId", "updatedAt") VALUES ('customer', CURRENT_TIMESTAMP);
        INSERT INTO "WalletTopUp" (id, "userId", "packageId", "amountCents", "bonusPercent", "bonusCents", "clientUrl", "updatedAt")
        VALUES ('topup', 'customer', 'usd-25', 2500, 12, 300, 'http://localhost:5173', CURRENT_TIMESTAMP);`);
    await assert.rejects(db.exec(`UPDATE "WalletTopUp" SET "bonusCents" = 301 WHERE id = 'topup'`), /WalletTopUp_package_check/);
    await assert.rejects(db.exec(`INSERT INTO "WalletEntry" (id, "userId", "key", type, "amountCents", "purchasedCents", "promotionalCents", description, "topUpId")
        VALUES ('bad', 'customer', 'bad', 'TOP_UP', 2801, 2500, 300, 'invalid', 'topup')`), /WalletEntry_amount_check/);
    await db.exec(`INSERT INTO "WalletEntry" (id, "userId", "key", type, "amountCents", "purchasedCents", "promotionalCents", description, "topUpId")
        VALUES ('entry', 'customer', 'topup:topup', 'TOP_UP', 2800, 2500, 300, 'valid', 'topup')`);
    await assert.rejects(db.exec(`UPDATE "WalletEntry" SET description = 'rewritten' WHERE id = 'entry'`), /immutable/);
    await assert.rejects(db.exec(`DELETE FROM "WalletEntry" WHERE id = 'entry'`), /immutable/);
    await assert.rejects(db.exec(`DELETE FROM "User" WHERE id = 'customer'`), /WalletAccount_userId_fkey/);
    await db.exec(`INSERT INTO "Order" (id, "walletAmountCents", "walletPurchasedCents", "walletPromotionalCents") VALUES ('order', 2000, 1500, 500)`);
    await assert.rejects(db.exec(`UPDATE "Order" SET "walletAmountCents" = 1 WHERE id = 'order'`), /Order_wallet_amount_check/);
    await assert.rejects(db.exec(`UPDATE "Order" SET "promotionPercent" = 101 WHERE id = 'order'`), /Order_promotion_percent_check/);
    await assert.rejects(db.exec(`UPDATE "Order" SET "cashbackPercent" = 90 WHERE id = 'order'`), /Order_cashback_percent_check/);
    await db.exec(`INSERT INTO "WalletCashbackEntitlement" ("orderId", "userId", "updatedAt") VALUES ('order', 'customer', CURRENT_TIMESTAMP);
        INSERT INTO "WalletEntry" (id, "userId", "key", type, "amountCents", "purchasedCents", "promotionalCents", description, "orderId")
        VALUES ('cashback', 'customer', 'cashback:order:1', 'CASHBACK', 100, 0, 100, 'reward', 'order');
        DELETE FROM "Order" WHERE id = 'order';`);
    assert.equal((await db.query('SELECT count(*)::int AS count FROM "WalletCashbackEntitlement"')).rows[0].count, 1);
    assert.equal((await db.query('SELECT count(*)::int AS count FROM "WalletEntry"')).rows[0].count, 2);
});
