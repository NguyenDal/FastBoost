const path = require('node:path');
const { readFile } = require('node:fs/promises');
const { Client, types } = require('pg');
const { Prisma } = require('../../src/generated/prisma/client');

function developmentDatabaseUrl() {
    require('dotenv').config({ path: path.join(__dirname, '../../.env'), quiet: true });
    let url;
    try { url = new URL(process.env.DATABASE_URL); }
    catch { throw new Error('Backend read verification requires a valid development DATABASE_URL.'); }
    if (url.hostname !== 'db.prisma.io' || !['postgres:', 'postgresql:'].includes(url.protocol) ||
        process.env.NODE_ENV === 'production') {
        throw new Error('Backend read verification is restricted to the db.prisma.io development database.');
    }
    return process.env.DATABASE_URL;
}

// All identifiers used by the production read helpers resolve to synthetic,
// connection-local tables. No public schema is on the transaction search path.
async function withBackendReadFixture(run) {
    const client = new Client({
        connectionString: developmentDatabaseUrl(),
        connectionTimeoutMillis: 15000,
        types: { getTypeParser(oid, format) {
            // Prisma treats PostgreSQL timestamp-without-time-zone values as UTC.
            if (oid === 1114 && (!format || format === 'text')) return value => new Date(`${value}Z`);
            return types.getTypeParser(oid, format);
        } },
    });
    try {
        try { await client.connect(); }
        catch { throw new Error('Could not connect to the development database for backend read verification.'); }
        await client.query('BEGIN');
        try {
            await client.query('SET LOCAL search_path = pg_temp, pg_catalog');
            await client.query("SET LOCAL statement_timeout = '30s'");
            await client.query(`
                CREATE TEMP TABLE "User" (
                    id text PRIMARY KEY, username text NOT NULL
                ) ON COMMIT DROP;
                CREATE TEMP TABLE "Service" (
                    id text PRIMARY KEY, title text NOT NULL
                ) ON COMMIT DROP;
                CREATE TEMP TABLE "Order" (
                    id text PRIMARY KEY, "orderNumber" text NOT NULL,
                    "customerId" text NOT NULL, "serviceId" text NOT NULL,
                    status text NOT NULL, "paymentStatus" text NOT NULL,
                    "boostType" text NOT NULL, "totalPrice" double precision NOT NULL DEFAULT 0,
                    "updatedAt" timestamp(3) NOT NULL
                ) ON COMMIT DROP;
                CREATE TEMP TABLE "RewardHistory" (
                    id text PRIMARY KEY, "userId" text NOT NULL, type text NOT NULL,
                    title text NOT NULL, description text, "goldAmount" integer NOT NULL,
                    "createdAt" timestamp(3) NOT NULL
                ) ON COMMIT DROP;
                CREATE TEMP TABLE "SupportMessage" (
                    id text PRIMARY KEY, "threadId" text NOT NULL, "senderId" text NOT NULL,
                    "createdAt" timestamp(3) NOT NULL
                ) ON COMMIT DROP;
                CREATE TEMP TABLE "ManagementAuditLog" (
                    id text PRIMARY KEY, "actorId" text, "actorName" text NOT NULL,
                    action text NOT NULL, outcome text NOT NULL,
                    "createdAt" timestamp(3) NOT NULL
                ) ON COMMIT DROP
            `);
            const db = { async $queryRaw(query, ...values) {
                const sql = Array.isArray(query) ? Prisma.sql(query, ...values) : query;
                const result = await client.query(sql.text, sql.values.map(value =>
                    value instanceof Date ? value.toISOString() : value));
                return result.rows;
            } };
            const applyReadIndexes = async () => {
                const migration = await readFile(path.join(__dirname,
                    '../../prisma/migrations/20261016000000_backend_read_indexes/migration.sql'), 'utf8');
                await client.query(migration);
            };
            return await run({ client, db, applyReadIndexes });
        } finally {
            // This also drops the synthetic tables and any indexes built on them.
            await client.query('ROLLBACK');
        }
    } finally {
        await client.end();
    }
}

module.exports = { developmentDatabaseUrl, withBackendReadFixture };
