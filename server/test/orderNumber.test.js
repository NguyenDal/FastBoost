const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

test('database order numbers backfill, resist collisions, stay immutable and reserve deleted suffixes', {skip: process.env.RUN_ORDER_NUMBER_DB_TEST !== '1'}, async () => {
    require('dotenv').config({quiet: true});
    const {Client} = require('pg');
    const db = new Client({connectionString: process.env.DATABASE_URL});
    await db.connect();
    // Every test object lives in a separate, rolled-back schema, never public.
    const schema = `order_number_test_${randomUUID().replaceAll('-', '')}`;
    try {
        await db.query('BEGIN');
        await db.query(`CREATE SCHEMA "${schema}"`);
        await db.query(`SET LOCAL search_path TO "${schema}", pg_catalog`);
        await db.query('CREATE TABLE "Order" (id TEXT PRIMARY KEY, "boostType" TEXT NOT NULL)');
        await db.query('INSERT INTO "Order" VALUES ($1,$2)', ['old', 'Rank Boost']);
        const migration = fs.readFileSync(path.join(__dirname, '../prisma/migrations/20260922180000_public_order_numbers/migration.sql'), 'utf8').replace(/^BEGIN;/, '').replace(/COMMIT;\s*$/, '');
        await db.query(migration);
        const cases = [['Rank Boost','LOL-RNK'],['Placement Boost','LOL-PLC'],['Win Boost','LOL-WIN'],['Pro Duo','LOL-DUO'],['TFT Rank Boost','TFT-RNK'],['TFT Win Boost','TFT-WIN']];
        for (const [type,prefix] of cases) {
            const {rows:[row]} = await db.query('INSERT INTO "Order" (id,"boostType") VALUES ($1,$2) RETURNING "orderNumber"', [type,type]);
            assert.match(row.orderNumber, new RegExp(`^${prefix}-[A-HJ-NP-Z2-9]{5}$`));
        }
        await db.query(`INSERT INTO "Order" (id,"boostType") SELECT 'bulk-' || n, 'Rank Boost' FROM generate_series(1,2000) n`);
        const {rows:[counts]} = await db.query('SELECT count(*)::int AS total, count(DISTINCT right("orderNumber",5))::int AS unique FROM "Order"');
        assert.equal(counts.total, counts.unique);
        const {rows:[old]} = await db.query('SELECT "orderNumber" FROM "Order" WHERE id=$1', ['old']);
        assert.match(old.orderNumber, /^LOL-RNK-/);
        await db.query('UPDATE "Order" SET "boostType"=$1 WHERE id=$2', ['Win Boost','old']);
        assert.equal((await db.query('SELECT "orderNumber" FROM "Order" WHERE id=$1',['old'])).rows[0].orderNumber, old.orderNumber);
        await db.query('SAVEPOINT immutable');
        await assert.rejects(db.query('UPDATE "Order" SET "orderNumber"=$1 WHERE id=$2',['LOL-RNK-AAAAA','old']), /immutable/);
        await db.query('ROLLBACK TO SAVEPOINT immutable');
        await db.query('DELETE FROM "Order" WHERE id=$1',['old']);
        assert.equal((await db.query('SELECT 1 FROM "OrderNumberReservation" WHERE suffix=$1',[old.orderNumber.slice(-5)])).rowCount, 1);
        // Force one collision, then a new random candidate. ON CONFLICT retries.
        await db.query('INSERT INTO "OrderNumberReservation" VALUES ($1) ON CONFLICT DO NOTHING',['AAAAA']);
        await db.query('CREATE SEQUENCE collision_attempt');
        await db.query(`CREATE FUNCTION gen_random_uuid() RETURNS uuid LANGUAGE sql AS $$ SELECT CASE WHEN nextval('collision_attempt')=1 THEN '00000000-0000-4000-8000-000000000000'::uuid ELSE pg_catalog.gen_random_uuid() END $$`);
        // Recompile to resolve gen_random_uuid against this schema's test stub.
        const allocator = migration.match(/CREATE FUNCTION fastboost_allocate_order_number[\s\S]*?\n\$\$;/)[0];
        await db.query(allocator.replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION'));
        const {rows:[collision]} = await db.query('INSERT INTO "Order" (id,"boostType") VALUES ($1,$2) RETURNING "orderNumber"',['collision','Rank Boost']);
        assert.notEqual(collision.orderNumber.slice(-5), 'AAAAA');
        assert.ok(Number((await db.query('SELECT last_value FROM collision_attempt')).rows[0].last_value) >= 2);
    } finally {
        await db.query('ROLLBACK');
        await db.end();
    }
});
