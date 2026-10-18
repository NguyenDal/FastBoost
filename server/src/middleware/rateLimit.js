// Process-local safety net. Keep keys bounded and never trust forwarded headers:
// req.ip follows Express's explicitly configured proxy policy.
function createWindowLimiter({ limit, windowMs, maxKeys = 10000, now = Date.now }) {
    const buckets = new Map();
    return {
        consume(key) {
            const time = now();
            for (const [entry, bucket] of buckets) {
                if (bucket.expires <= time) buckets.delete(entry);
            }
            const identity = String(key || 'unknown').slice(0, 512);
            let bucket = buckets.get(identity);
            if (!bucket) {
                // Reject additional identities at capacity; evicting live keys
                // would let an attacker reset their budget by rotating inputs.
                if (buckets.size >= maxKeys) return { allowed: false, retryAfter: Math.ceil(windowMs / 1000) };
                bucket = { count: 0, expires: time + windowMs };
                buckets.set(identity, bucket);
            }
            if (bucket.count >= limit) return { allowed: false, retryAfter: Math.max(1, Math.ceil((bucket.expires - time) / 1000)) };
            bucket.count++;
            return { allowed: true, retryAfter: 0 };
        },
    };
}

let nextCleanupAt = 0;
async function cleanupExpiredBuckets(db) {
    if (Date.now() < nextCleanupAt) return;
    nextCleanupAt = Date.now() + 60000;
    try {
        // A separate statement avoids holding unrelated cleanup locks while
        // claiming a budget. Never wait on a row another request is renewing.
        await db.$executeRaw`WITH candidates AS (
            SELECT "key" FROM "RateLimitBucket" WHERE "expiresAt" < clock_timestamp() - interval '1 hour'
            ORDER BY "expiresAt" LIMIT 1000 FOR UPDATE SKIP LOCKED
        ) DELETE FROM "RateLimitBucket" AS bucket USING candidates
        WHERE bucket."key" = candidates."key" AND bucket."expiresAt" < clock_timestamp() - interval '1 hour'`;
    } catch { /* Retention maintenance cannot undo a successful budget claim. */ }
}

function createDatabaseLimiter({ db, limit, windowMs, scope, secret = process.env.JWT_SECRET }) {
    const crypto = require('node:crypto');
    return {
        async consume(identity) {
            const digest = crypto.createHmac('sha256', secret).update(String(scope)).update('\0').update(String(identity).slice(0, 512)).digest('hex');
            // ON CONFLICT serializes concurrent attempts across all API instances.
            // Count stops growing at the limit and the DB clock owns expiry.
            const rows = await db.$queryRaw`INSERT INTO "RateLimitBucket" ("key", "count", "expiresAt")
                VALUES (${digest}, 1, clock_timestamp() + ${windowMs} * interval '1 millisecond')
                ON CONFLICT ("key") DO UPDATE SET
                    "count" = CASE WHEN "RateLimitBucket"."expiresAt" <= clock_timestamp() THEN 1 ELSE "RateLimitBucket"."count" + 1 END,
                    "expiresAt" = CASE WHEN "RateLimitBucket"."expiresAt" <= clock_timestamp() THEN clock_timestamp() + ${windowMs} * interval '1 millisecond' ELSE "RateLimitBucket"."expiresAt" END
                WHERE "RateLimitBucket"."expiresAt" <= clock_timestamp() OR "RateLimitBucket"."count" < ${limit}
                RETURNING "count"`;
            await cleanupExpiredBuckets(db);
            return { allowed: rows.length === 1, retryAfter: rows.length ? 0 : Math.ceil(windowMs / 1000) };
        },
    };
}

function createRateLimit({ limit, windowMs, key, message = 'Too many requests. Please try again later.' }) {
    const limiter = createWindowLimiter({ limit, windowMs });
    return async (req, res, next) => {
        const identity = key ? key(req) : req.ip || req.socket?.remoteAddress || 'unknown';
        let result;
        try {
            if (process.env.NODE_ENV === 'production') {
                const scope = `${req.method}:${req.baseUrl || ''}:${req.route?.path || req.path}:${key ? 'account' : 'source'}`;
                result = await createDatabaseLimiter({ db: require('../prisma'), limit, windowMs, scope }).consume(identity);
            } else result = limiter.consume(identity);
        } catch {
            // Missing migrations/storage must never silently disable auth budgets.
            return res.status(503).json({ ok: false, message: 'Request protection is temporarily unavailable. Please try again shortly.' });
        }
        if (result.allowed) return next();
        res.setHeader('Retry-After', String(result.retryAfter));
        return res.status(429).json({ ok: false, message });
    };
}

module.exports = { createWindowLimiter, createDatabaseLimiter, createRateLimit };
