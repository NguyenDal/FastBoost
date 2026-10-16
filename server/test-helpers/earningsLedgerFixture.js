const assert = require('node:assert/strict');

function attachEarningsLedger(db) {
    const state = { entries: [], balances: [], failEntry: false };
    db.boosterEarningsLedgerState = { findUnique: async () => ({ id: 'global', activatedAt: new Date('2026-01-01T00:00:00Z') }) };
    db.boosterEarningsEntry = {
        create: async ({ data }) => {
            if (state.failEntry) throw new Error('Synthetic ledger failure');
            const row = { id: `entry-${state.entries.length}`, ...structuredClone(data) };
            state.entries.push(row); return row;
        },
        findFirst: async ({ where }) => [...state.entries].reverse().find(row => row.orderId === where.orderId) || null,
    };
    db.boosterEarningsBalance = {
        findMany: async ({ where }) => structuredClone(state.balances.filter(row => row.orderId === where.orderId)),
        upsert: async ({ where, create, update }) => {
            const key = where.orderId_boosterId_currency;
            let row = state.balances.find(row => row.orderId === key.orderId && row.boosterId === key.boosterId && row.currency === key.currency);
            if (row) Object.assign(row, structuredClone(update));
            else { row = structuredClone(create); state.balances.push(row); }
            assert.ok(row.amountCents >= 0); return row;
        },
    };
    return state;
}

module.exports = { attachEarningsLedger };
