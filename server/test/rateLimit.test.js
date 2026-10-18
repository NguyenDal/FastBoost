const test = require('node:test');
const assert = require('node:assert/strict');
const { createWindowLimiter, createDatabaseLimiter, createRateLimit } = require('../src/middleware/rateLimit');

test('rate budget separates identities, rejects excess requests, and expires', () => {
    let time = 1000;
    const limiter = createWindowLimiter({ limit: 2, windowMs: 10000, now: () => time });
    assert.equal(limiter.consume('one').allowed, true);
    assert.equal(limiter.consume('one').allowed, true);
    assert.deepEqual(limiter.consume('one'), { allowed: false, retryAfter: 10 });
    assert.equal(limiter.consume('two').allowed, true);
    time += 10000;
    assert.equal(limiter.consume('one').allowed, true);
});

test('rotating inputs cannot evict a live exhausted budget', () => {
    const limiter = createWindowLimiter({ limit: 1, windowMs: 10000, maxKeys: 2 });
    limiter.consume('one'); limiter.consume('two');
    assert.equal(limiter.consume('three').allowed, false);
    assert.equal(limiter.consume('one').allowed, false);
});

test('HTTP throttle ignores untrusted forwarded source and returns Retry-After', async () => {
    const middleware = createRateLimit({ limit: 1, windowMs: 10000 });
    let allowed = 0;
    const req = { ip: 'source', headers: { 'x-forwarded-for': 'spoof-one' } };
    const res = { setHeader(name, value) { this[name] = value; }, status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
    await middleware(req, res, () => allowed++);
    req.headers['x-forwarded-for'] = 'spoof-two';
    await middleware(req, res, () => allowed++);
    assert.equal(allowed, 1);
    assert.equal(res.code, 429);
    assert.equal(res['Retry-After'], '10');
});

test('production store atomically bounds attempts and binds hashed identities as SQL parameters', async () => {
    const calls = [];
    let permitted = true;
    const db = { $queryRaw: async (sql, ...values) => { calls.push({ sql: sql.join('?'), values }); return permitted ? [{ count: 1 }] : []; } };
    const options = { db, limit: 3, windowMs: 60000, scope: 'login', secret: 'offline-only' };
    const first = createDatabaseLimiter(options), second = createDatabaseLimiter(options);
    const identity = "victim'); DROP TABLE User;--@example.test";
    assert.equal((await first.consume(identity)).allowed, true);
    permitted = false;
    assert.equal((await second.consume(identity)).allowed, false);
    assert.equal(calls[0].values[0], calls[1].values[0], 'independent instances share the same budget key');
    assert.match(calls[0].values[0], /^[a-f0-9]{64}$/);
    assert.doesNotMatch(JSON.stringify(calls), /DROP TABLE|@example/);
    assert.match(calls[0].sql, /ON CONFLICT/);
    assert.match(calls[0].sql, /WHERE .*"expiresAt"/);
});
