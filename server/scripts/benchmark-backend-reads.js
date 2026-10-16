// Synthetic application benchmark only. Never imports Prisma or connects to a DB.
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const { boosterEarnings, EARNINGS_BATCH_SIZE } = require('../src/utils/boosterEarnings');
const { buildEarningsReport } = require('../src/utils/earningsReport');

const TARGET = 'benchmark-booster';
const DATE = new Date('2026-01-01T00:00:00.000Z');

function option(name, fallback, min, max) {
    const argument = process.argv.slice(2).find(value => value.startsWith(`--${name}=`));
    const value = argument ? Number(argument.slice(name.length + 3)) : fallback;
    assert.ok(Number.isSafeInteger(value) && value >= min && value <= max,
        `--${name} must be an integer from ${min} to ${max}`);
    return value;
}

function fixtures(count) {
    const identity = id => ({ id, username: id, profile: { displayName: `Synthetic ${id}` } });
    return Array.from({ length: count }, (_, i) => {
        // Each 100-order group gives the target one order. Alternate the group's
        // target order between legacy contributions and imported match history.
        const group = Math.floor(i / 100);
        const primary = i % 100 === 0 ? TARGET : `booster-${i % 80}`;
        const peer = `peer-${i % 31}`;
        const matchHistoryEnabled = (group + i) % 2 === 0;
        const pending = group % 7 === 0;
        const match = (boosterId, status = 'APPROVED', queueId = 420) => ({
            game: 'LOL', status, boosterId, booster: boosterId ? identity(boosterId) : null,
            details: { queueId, championName: 'Synthetic champion', gameDuration: 1800, kills: 5, deaths: 2, assists: 9 },
        });
        const contribution = (boosterId, matches, approvedMatches = matches) => ({
            id: `contribution-${i}-${boosterId}`, orderId: `order-${i}`, boosterId,
            submittedMatches: matches, approvedMatches, submittedAt: DATE,
            reviewedAt: approvedMatches === null ? null : DATE, revision: 1,
            reviewedBy: 'synthetic-admin', reviewNote: null, booster: identity(boosterId),
        });
        return {
            id: String(i).padStart(8, '0'), orderNumber: 10000 + i,
            boostType: 'Rank Boost', queueType: 'Solo/Duo',
            amountCents: group % 19 === 0 ? null : group % 23 === 0 ? 0 : 10001 + i % 5000,
            goldDiscountCents: group % 3 === 0 ? 300 : 0,
            currency: ['usd', 'cad', 'eur'][group % 3], paidAt: DATE, updatedAt: DATE,
            matchHistoryEnabled, matchHistoryConfirmedAt: group % 11 === 0 ? null : DATE,
            assignments: [peer, ...(group % 5 === 0 ? [] : [primary])]
                .map(boosterId => ({ boosterId, booster: identity(boosterId) })),
            contributions: matchHistoryEnabled ? [] : [contribution(primary, 2), contribution(peer, 1, pending ? null : 1)],
            matches: matchHistoryEnabled ? [
                match(primary), match(primary), match(peer, pending ? 'PENDING' : 'APPROVED'),
                match(peer, 'PENDING', 440), match(peer, 'REJECTED'), match(null, 'PENDING'),
            ] : [],
        };
    });
}

function matchesWhere(row, where = {}) {
    return Object.entries(where).every(([key, condition]) => {
        if (condition && typeof condition === 'object') {
            if ('not' in condition && row[key] === condition.not) return false;
            if ('in' in condition && !condition.in.includes(row[key])) return false;
            return true;
        }
        return row[key] === condition;
    });
}

function project(row, select) {
    return Object.fromEntries(Object.entries(select).map(([key, selection]) => [key,
        selection === true ? row[key] : row[key].filter(child => matchesWhere(child, selection.where))
            .map(child => project(child, selection.select)),
    ]));
}

const relationRows = rows => rows.reduce((sum, order) => sum +
    ['assignments', 'contributions', 'matches'].reduce((total, key) => total + order[key].length, 0), 0);

function memoryAdapter(orders) {
    const scoped = orders.filter(order => ['assignments', 'contributions', 'matches']
        .some(key => order[key].some(record => record.boosterId === TARGET)));
    const cache = new Map();
    let stats;
    const reset = () => { stats = { queries: 0, orderRows: 0, relationRows: 0, maxOrdersPerRead: 0 }; };
    reset();
    const db = { order: { findMany: async query => {
        assert.equal(query.where.paymentStatus, 'PAID');
        assert.equal(query.where.status, 'COMPLETED');
        assert.deepEqual(query.orderBy, { id: 'asc' });
        assert.ok(query.take > 0 && query.take <= EARNINGS_BATCH_SIZE);
        assert.equal(query.skip, undefined);
        if (query.where.OR) assert.deepEqual(query.where.OR, [
            { assignments: { some: { boosterId: TARGET } } },
            { contributions: { some: { boosterId: TARGET } } },
            { matches: { some: { boosterId: TARGET } } },
        ]);
        const key = JSON.stringify(query);
        if (!cache.has(key)) {
            const source = query.where.OR ? scoped : orders;
            const page = source.filter(order => !query.where.id || order.id > query.where.id.gt)
                .slice(0, query.take).map(order => project(order, query.select));
            cache.set(key, { page, relations: relationRows(page) });
        }
        // Warmup populates these results before timings. Database filtering,
        // projections, sorting, transfers and network latency are NOT timed.
        const { page, relations } = cache.get(key);
        stats.queries++;
        stats.orderRows += page.length;
        stats.relationRows += relations;
        stats.maxOrdersPerRead = Math.max(stats.maxOrdersPerRead, page.length);
        return page;
    } } };
    return { db, reset, stats: () => ({ ...stats }), relevant: scoped.length };
}

function timing(samples) {
    const sorted = [...samples].sort((a, b) => a - b);
    const median = sorted.length % 2 ? sorted[(sorted.length - 1) / 2]
        : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
    return { medianMs: Number(median.toFixed(3)), minMs: Number(sorted[0].toFixed(3)),
        maxMs: Number(sorted[sorted.length - 1].toFixed(3)) };
}

async function main() {
    const count = option('orders', 20000, 10000, 200000);
    const rounds = option('rounds', 7, 3, 100);
    assert.equal(count % 100, 0, '--orders must be a multiple of 100 for exactly 1% relevance');
    for (const argument of process.argv.slice(2)) {
        assert.match(argument, /^--(?:orders|rounds)=\d+$/, `Unknown option: ${argument}`);
    }
    const orders = fixtures(count);
    const adapter = memoryAdapter(orders);
    const expected = buildEarningsReport(orders).boosters[TARGET] || {};
    assert.ok(Object.keys(expected).length > 0, 'fixture must include confirmed earnings');
    const oldPath = () => buildEarningsReport(orders).boosters[TARGET] || {};
    const newPath = async () => (await boosterEarnings(adapter.db, TARGET))[TARGET] || {};
    for (let i = 0; i < 2; i++) {
        assert.deepEqual(oldPath(), expected);
        assert.deepEqual(await newPath(), expected);
    }
    const samples = { old: [], new: [] };
    const run = async path => {
        const start = performance.now();
        const actual = path === 'old' ? oldPath() : await newPath();
        samples[path].push(performance.now() - start);
        assert.deepEqual(actual, expected, `${path} earnings must match on every iteration`);
    };
    for (let i = 0; i < rounds; i++) {
        // Alternate the order to reduce a consistent first/second-run bias.
        for (const path of i % 2 ? ['new', 'old'] : ['old', 'new']) await run(path);
    }
    adapter.reset();
    assert.deepEqual(await newPath(), expected);
    const current = adapter.stats();
    assert.equal(adapter.relevant, count / 100);
    assert.equal(current.orderRows, adapter.relevant, 'unrelated orders must not be transferred');
    assert.ok(current.maxOrdersPerRead <= EARNINGS_BATCH_SIZE, 'order batches must remain bounded');
    assert.equal(current.queries, Math.floor(adapter.relevant / EARNINGS_BATCH_SIZE) + 1);
    const previous = { queries: 1, orderRows: count, relationRows: relationRows(orders), maxOrdersPerRead: count };
    console.log(JSON.stringify({
        benchmark: 'Synthetic /operations/me earnings application processing',
        node: process.version, siteOrders: count, relevantOrders: adapter.relevant, relevancePercent: 1,
        rounds, warmupRounds: 2, equivalentEarnings: expected,
        timings: { previousFullReport: timing(samples.old), scopedSummary: timing(samples.new) },
        modeledQueryResults: { previousFullReport: previous, scopedSummary: current },
        orderRowsReductionPercent: 100 * (1 - current.orderRows / previous.orderRows),
        limits: [
            'Deterministic in-memory fixtures; no database connection or writes.',
            'Timings exclude database execution, network, projection and fixture construction.',
            'Modeled query counts are application findMany calls, not PostgreSQL statement counts.',
            'Row counts describe fixture query results, not measured network bytes or heap usage.',
            'At most 100 orders per batch; nested matches and JSON sizes are not bounded by this limit.',
            'Production latency, database query plans and concurrent-write consistency require separate measurement.',
        ],
    }, null, 2));
}

main().catch(error => { console.error(error); process.exitCode = 1; });
