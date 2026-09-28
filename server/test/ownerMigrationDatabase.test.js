const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('owner migration designates only the existing verified admin and enforces DB protections', { skip: process.env.OWNER_DB_TEST !== 'true' }, async () => {
    require('dotenv').config({ quiet: true });
    const { Client } = require('pg');
    const db = new Client({ connectionString: process.env.DATABASE_URL });
    await db.connect();
    try {
        await db.query('BEGIN');
        await db.query('SET LOCAL search_path TO pg_temp');
        await db.query('CREATE TEMP TABLE "User" (id text, email text, username text, role text, "emailVerifiedAt" timestamp, "suspendedAt" timestamp, "updatedAt" timestamp) ON COMMIT DROP');
        await db.query(`INSERT INTO "User" VALUES
            ('owner', 'annguyen270504@gmail.com', 'Starlight', 'ADMIN', now(), null, now()),
            ('other', 'admin@example.test', 'Other', 'ADMIN', now(), null, now()),
            ('unverified', 'annguyen270504@gmail.com', 'Starlight', 'ADMIN', null, null, now()),
            ('customer', 'annguyen270504@gmail.com', 'Starlight', 'CUSTOMER', now(), null, now())`);
        await db.query(fs.readFileSync(path.join(__dirname, '../prisma/migrations/20260928000000_protect_owner/migration.sql'), 'utf8'));
        const { rows } = await db.query('SELECT id FROM "User" WHERE "isOwner"');
        assert.deepEqual(rows, [{ id: 'owner' }]);
        for (const assignment of [`role = 'CUSTOMER'`, '"suspendedAt" = now()']) {
            await db.query('SAVEPOINT protected_update');
            await assert.rejects(db.query(`UPDATE "User" SET ${assignment} WHERE id = 'owner'`), { code: '23514' });
            await db.query('ROLLBACK TO SAVEPOINT protected_update');
        }
        await db.query(`UPDATE "User" SET email = 'changed@example.test', username = 'Renamed' WHERE id = 'owner'`);
        assert.equal((await db.query(`SELECT "isOwner" FROM "User" WHERE id = 'owner'`)).rows[0].isOwner, true);
    } finally { await db.query('ROLLBACK'); await db.end(); }
});
