const assert = require('node:assert/strict');

function order(id = 'order', overrides = {}) {
    return { id, orderNumber: `TEST-${id}`, boostType: 'Win Boost', queueType: 'Solo/Duo', status: 'COMPLETED', paymentStatus: 'PAID',
        amountCents: 10001, goldDiscountCents: 2000, currency: 'usd', assignments: [{ boosterId: 'a' }, { boosterId: 'b' }],
        contributions: [{ boosterId: 'a', submittedMatches: 2, approvedMatches: 2 }, { boosterId: 'b', submittedMatches: 1, approvedMatches: 1 }],
        matches: [], matchHistoryEnabled: false, ...overrides };
}

function fixture(initialOrders = []) {
    const state = { activation: null, orders: structuredClone(initialOrders), balances: [], entries: [], serial: 0, locks: 0, failEntry: false, reads: [] };
    const keyMatches = (value, key) => Object.entries(key).every(([name, expected]) => value[name] === expected);
    const db = {
        $queryRaw: async (strings) => { assert.match(strings.join(''), /pg_advisory_xact_lock\(746381923\)/); state.locks++; return []; },
        boosterEarningsLedgerState: {
            findUnique: async () => structuredClone(state.activation),
            create: async ({ data }) => { state.activation = structuredClone(data); return structuredClone(data); },
        },
        order: {
            findUnique: async ({ where }) => structuredClone(state.orders.find(row => row.id === where.id) || null),
            findMany: async ({ where, take }) => state.orders.filter(row => row.status === where.status && row.paymentStatus === where.paymentStatus && (!where.id || row.id > where.id.gt)).sort((a, b) => a.id.localeCompare(b.id)).slice(0, take).map(row => structuredClone(row)),
        },
        boosterEarningsBalance: {
            findMany: async ({ where }) => structuredClone(state.balances.filter(row => row.orderId === where.orderId)),
            create: async ({ data }) => { state.balances.push(structuredClone(data)); return structuredClone(data); },
            upsert: async ({ where, create, update }) => {
                const row = state.balances.find(balance => keyMatches(balance, where.orderId_boosterId_currency));
                if (row) Object.assign(row, update); else state.balances.push(structuredClone(create));
            },
        },
        boosterEarningsEntry: {
            create: async ({ data }) => {
                if (state.failEntry) throw new Error('synthetic ledger write failure');
                const row = { id: String(++state.serial).padStart(8, '0'), ...structuredClone(data) };
                state.entries.push(row); return structuredClone(row);
            },
            findFirst: async ({ where }) => structuredClone(state.entries.filter(row => row.orderId === where.orderId).at(-1) || null),
            groupBy: async ({ where, by }) => {
                assert.deepEqual(by, ['period', 'kind', 'currency']); state.reads.push({ operation: 'groupBy', where });
                const groups = new Map();
                for (const row of state.entries.filter(entry => entry.boosterId === where.boosterId && (!where.currency || entry.currency === where.currency))) {
                    const key = JSON.stringify([row.period, row.kind, row.currency]);
                    const group = groups.get(key) || { period: row.period, kind: row.kind, currency: row.currency, _sum: { amountCents: 0 } };
                    group._sum.amountCents += row.amountCents; groups.set(key, group);
                }
                return [...groups.values()];
            },
            findMany: async ({ where, take, orderBy }) => {
                assert.ok(take <= 250); assert.deepEqual(orderBy, [{ recognizedAt: 'asc' }, { id: 'asc' }]);
                state.reads.push({ operation: 'findMany', where, take });
                return state.entries.filter(row => row.boosterId === where.boosterId && row.period === where.period && row.kind !== 'OPENING' && (!where.currency || row.currency === where.currency) &&
                    (!where.OR || row.recognizedAt > where.OR[0].recognizedAt.gt || (+row.recognizedAt === +where.OR[1].recognizedAt && row.id > where.OR[1].id.gt)))
                    .sort((a, b) => a.recognizedAt - b.recognizedAt || a.id.localeCompare(b.id)).slice(0, take).map(({ boosterId: _boosterId, period: _period, ...row }) => structuredClone(row));
            },
        },
    };
    let tail = Promise.resolve();
    db.$transaction = callback => {
        const run = tail.then(async () => {
            const before = structuredClone(state);
            try { return await callback(db); }
            catch (error) { Object.assign(state, before); throw error; }
        });
        tail = run.catch(() => {}); return run;
    };
    return { db, state };
}

function enable(t) {
    const previous = process.env.BOOSTER_MONTHLY_EARNINGS_ENABLED;
    process.env.BOOSTER_MONTHLY_EARNINGS_ENABLED = 'true';
    t.after(() => { if (previous === undefined) delete process.env.BOOSTER_MONTHLY_EARNINGS_ENABLED; else process.env.BOOSTER_MONTHLY_EARNINGS_ENABLED = previous; });
}

module.exports = { fixture, order, enable };
