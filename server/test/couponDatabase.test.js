const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

test('database consumes only on payment, enforces per-account uniqueness and releases on cancellation', { skip: process.env.RUN_COUPON_DB_TEST !== '1' }, async()=>{
    require('dotenv').config({quiet:true});
    const {Client}=require('pg');
    const db=new Client({connectionString:process.env.DATABASE_URL});
    await db.connect();
    const schema='coupon_test_'+randomUUID().replaceAll('-','');
    try {
        await db.query('BEGIN');
        await db.query(`CREATE SCHEMA "${schema}"`);
        await db.query(`SET LOCAL search_path TO "${schema}", pg_catalog`);
        await db.query('CREATE TABLE "User" (id TEXT PRIMARY KEY); CREATE TABLE "ServiceSale" (id TEXT PRIMARY KEY); CREATE TABLE "Order" (id TEXT PRIMARY KEY, "customerId" TEXT, status TEXT DEFAULT \'PENDING\', "paymentStatus" TEXT DEFAULT \'PENDING\');');
        await db.query(fs.readFileSync(path.join(__dirname,'../prisma/migrations/20260922220000_checkout_coupon_redemption/migration.sql'),'utf8'));
        await db.query(`INSERT INTO "User" VALUES ('a'),('b'); INSERT INTO "ServiceSale" VALUES ('sale'); INSERT INTO "Order" (id,"customerId","couponSaleId") VALUES ('first','a','sale'),('second','a','sale'),('third','b','sale');`);
        await db.query(`INSERT INTO "CouponUse" (id,"accountId","saleId","orderId") VALUES ('claim-a','a','sale','first'),('claim-b','b','sale','third')`);
        assert.equal((await db.query('SELECT "usedAt" FROM "CouponUse" WHERE id=\'claim-a\'')).rows[0].usedAt,null);
        await db.query('SAVEPOINT duplicate');
        await assert.rejects(db.query(`INSERT INTO "CouponUse" (id,"accountId","saleId","orderId") VALUES ('duplicate','a','sale','second')`), {code:'23505'});
        await db.query('ROLLBACK TO SAVEPOINT duplicate');
        await db.query(`UPDATE "Order" SET "paymentStatus"='PAID' WHERE id='first'`);
        const paidTime=(await db.query('SELECT "usedAt" FROM "CouponUse" WHERE id=\'claim-a\'')).rows[0].usedAt;
        assert.ok(paidTime instanceof Date);
        await db.query(`UPDATE "Order" SET "paymentStatus"='PAID' WHERE id='first'`);
        assert.equal((await db.query('SELECT "usedAt" FROM "CouponUse" WHERE id=\'claim-a\'')).rows[0].usedAt.getTime(),paidTime.getTime());
        await db.query('SAVEPOINT missing');
        await assert.rejects(db.query(`UPDATE "Order" SET "paymentStatus"='PAID' WHERE id='second'`),/claim is missing/);
        await db.query('ROLLBACK TO SAVEPOINT missing');
        await db.query(`UPDATE "Order" SET status='CANCELLED' WHERE id='first'`);
        assert.equal((await db.query('SELECT 1 FROM "CouponUse" WHERE id=\'claim-a\'')).rowCount,0);
        await db.query(`INSERT INTO "CouponUse" (id,"accountId","saleId","orderId") VALUES ('reused','a','sale','second')`);
        await db.query(`UPDATE "Order" SET "paymentStatus"='PAID' WHERE id='second'`);
        assert.ok((await db.query('SELECT "usedAt" FROM "CouponUse" WHERE id=\'reused\'')).rows[0].usedAt);
        await db.query(`UPDATE "Order" SET "paymentStatus"='CANCELLED' WHERE id='third'`);
        assert.equal((await db.query('SELECT 1 FROM "CouponUse" WHERE id=\'claim-b\'')).rowCount,0);
        await db.query(`DELETE FROM "Order" WHERE id='second'`);
        assert.equal((await db.query('SELECT 1 FROM "CouponUse"')).rowCount,0);
    } finally { await db.query('ROLLBACK'); await db.end(); }
});
