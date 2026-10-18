const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createDatabaseLimiter } = require('../src/middleware/rateLimit');

let PGlite;
try { ({ PGlite } = require('@electric-sql/pglite')); }
catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; }

test('actual shared limiter migration and parameterized PostgreSQL statements preserve budgets and bounded cleanup',
    { skip: !PGlite && 'Optional embedded PostgreSQL is not installed; no hosted database fallback is allowed.' }, async t => {
        // No data directory or connection string: this engine is disposable RAM.
        const memory = new PGlite();
        t.after(() => memory.close());
        await memory.exec(await fs.readFile(path.join(__dirname, '../prisma/migrations/20261017020000_shared_request_rate_limits/migration.sql'), 'utf8'));
        await memory.exec(`INSERT INTO "RateLimitBucket" ("key", "count", "expiresAt")
            SELECT lpad(to_hex(value), 64, '0'), 1, clock_timestamp() - interval '2 hours'
            FROM generate_series(1, 1002) AS value`);
        await memory.query(`INSERT INTO "RateLimitBucket" ("key", "count", "expiresAt") VALUES
            ($1, 1, clock_timestamp() - interval '30 minutes'), ($2, 1, clock_timestamp() + interval '1 hour')`,
        ['e'.repeat(64), 'f'.repeat(64)]);

        const executed = [];
        const statement = strings => strings.reduce((sql, part, index) => sql + (index ? `$${index}` : '') + part, '');
        const db = {
            $queryRaw: async (strings, ...values) => {
                const sql = statement(strings);
                executed.push({ kind: 'claim', sql, values });
                return (await memory.query(sql, values)).rows;
            },
            $executeRaw: async (strings, ...values) => {
                const sql = statement(strings);
                executed.push({ kind: 'cleanup', sql, values });
                return (await memory.query(sql, values)).affectedRows;
            },
        };
        const options = { db, limit: 3, windowMs: 60000, scope: 'POST:/api/auth:/login:account', secret: 'synthetic-embedded-postgres-secret' };
        const first = createDatabaseLimiter(options), second = createDatabaseLimiter(options);
        const malicious = "victim'); DROP TABLE \"RateLimitBucket\";--@example.test";
        assert.equal((await first.consume(malicious)).allowed, true);
        const initialClaims = executed.filter(entry => entry.kind === 'claim');
        const digest = initialClaims[0].values[0];
        assert.match(digest, /^[a-f0-9]{64}$/);
        assert.doesNotMatch(JSON.stringify(executed), /DROP TABLE|@example/);
        assert.equal((await memory.query('SELECT COUNT(*)::int AS count FROM "RateLimitBucket"')).rows[0].count, 5,
            'one cleanup removes at most 1000 old rows and preserves recent expiry, active and claimed rows');
        assert.equal(executed.filter(entry => entry.kind === 'cleanup').length, 1);
        assert.match(executed.find(entry => entry.kind === 'cleanup').sql, /FOR UPDATE SKIP LOCKED/);
        assert.equal((await memory.query('SELECT COUNT(*)::int AS count FROM "RateLimitBucket" WHERE "key" IN ($1, $2)',
            ['e'.repeat(64), 'f'.repeat(64)])).rows[0].count, 2);

        const attempts = await Promise.all([first, second, first, second].map(limiter => limiter.consume(malicious)));
        assert.equal(attempts.filter(result => result.allowed).length, 2);
        assert.equal((await memory.query('SELECT "count" FROM "RateLimitBucket" WHERE "key" = $1', [digest])).rows[0].count, 3,
            'two limiter instances share one capped PostgreSQL bucket');
        assert.ok(executed.filter(entry => entry.kind === 'claim').every(entry => entry.values[0] === digest));
        assert.equal(executed.filter(entry => entry.kind === 'cleanup').length, 1, 'retention is throttled across limiter instances');

        await memory.query('UPDATE "RateLimitBucket" SET "expiresAt" = clock_timestamp() - interval \'1 second\' WHERE "key" = $1', [digest]);
        assert.equal((await second.consume(malicious)).allowed, true);
        assert.equal((await memory.query('SELECT "count" FROM "RateLimitBucket" WHERE "key" = $1', [digest])).rows[0].count, 1);
        const otherScope = createDatabaseLimiter({ ...options, scope: 'POST:/api/auth:/forgot-password:account' });
        assert.equal((await otherScope.consume(malicious)).allowed, true);
        assert.notEqual(executed.filter(entry => entry.kind === 'claim').at(-1).values[0], digest);
        t.diagnostic('Real PostgreSQL WASM parser/executor exercised; PGlite has one connection, so cross-process lock contention is not simulated.');
    });
