const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
test('database reserves only active coupon codes and preserves historical codes',{skip:process.env.RUN_COUPON_DB_TEST!=='1'},async()=>{
 require('dotenv').config({quiet:true});
 const db=new(require('pg').Client)({connectionString:process.env.DATABASE_URL});await db.connect();
 try {
  await db.query('BEGIN');
  const schema='reuse_test_'+randomUUID().replaceAll('-','');
  await db.query(`CREATE SCHEMA "${schema}"`);await db.query(`SET LOCAL search_path TO "${schema}", pg_catalog`);
  await db.query('CREATE TABLE "ServiceSale" (id TEXT PRIMARY KEY,"couponCode" TEXT,active BOOLEAN); CREATE UNIQUE INDEX "ServiceSale_couponCode_key" ON "ServiceSale"("couponCode");');
  const sql=fs.readFileSync(path.join(__dirname,'../prisma/migrations/20260923030000_reusable_coupon_codes/migration.sql'),'utf8').replace(/^BEGIN;\s*|^COMMIT;\s*/gm,'');
  await db.query(sql);
  await db.query(`INSERT INTO "ServiceSale" VALUES ('old','REUSE20',false),('new','REUSE20',true)`);
  await db.query('SAVEPOINT duplicate');
  await assert.rejects(db.query(`INSERT INTO "ServiceSale" VALUES ('duplicate','REUSE20',true)`),{code:'23505'});
  await db.query('ROLLBACK TO SAVEPOINT duplicate');
  assert.equal((await db.query(`SELECT * FROM "ServiceSale" WHERE "couponCode"='REUSE20'`)).rowCount,2);
  await db.query('SAVEPOINT reactivate');
  await assert.rejects(db.query(`UPDATE "ServiceSale" SET active=true WHERE id='old'`),{code:'23505'});
  await db.query('ROLLBACK TO SAVEPOINT reactivate');
 }finally {await db.query('ROLLBACK');await db.end();}
});
