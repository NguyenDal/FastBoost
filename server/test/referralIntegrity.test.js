const test = require('node:test');
const assert = require('node:assert/strict');

function fixture(t, override = {}) {
    const order = { id: 'qualifying-order', customerId: 'friend', status: 'COMPLETED', paymentStatus: 'PAID',
        totalPrice: 45, referralDiscount: 5, customer: { referredById: 'inviter' }, ...override };
    const state = { order, rewards: [], notices: [], locks: [], failInviteeReward: false, cancelBeforeLock: false };
    const db = { order: {
        findUnique: async () => structuredClone(state.order),
        findFirst: async () => ({ id: state.firstPaidOrderId || state.order.id }),
    }, rewardHistory: {
        findFirst: async ({ where }) => state.rewards.find(reward => Object.entries(where).every(([key, value]) => reward[key] === value)) || null,
        upsert: async ({ where, create }) => {
            if (state.failInviteeReward && create.type === 'REFERRAL_INVITED') throw new Error('Simulated database interruption');
            const key = where.userId_type_sourceUserId;
            const existing = state.rewards.find(row => Object.entries(key).every(([field, value]) => row[field] === value));
            if (existing) return existing;
            const row = { id: `reward-${state.rewards.length}`, ...structuredClone(create) }; state.rewards.push(row); return row;
        },
    }, notification: { upsert: async ({ where, create }) => {
        const old = state.notices.find(row => row.id === where.id);
        if (old) return old;
        state.notices.push(structuredClone(create)); return create;
    } }, $queryRaw: async (sql, id) => {
        state.locks.push([sql.join('?').includes('"User"') ? 'User' : 'Order', id]);
        if (state.cancelBeforeLock) state.order.status = 'CANCELLED';
        return [{ id }];
    } };
    let tail = Promise.resolve();
    const transaction = callback => {
        const pending = tail.then(async () => {
            const before = structuredClone({ order: state.order, rewards: state.rewards, notices: state.notices });
            try { return await callback(db); }
            catch (error) { Object.assign(state, before); throw error; }
        });
        tail = pending.catch(() => {}); return pending;
    };
    db.$transaction = transaction;
    const paths = ['../src/prisma', '../src/utils/referralProgram'].map(require.resolve);
    const saved = paths.map(path => [path, require.cache[path]]);
    require.cache[paths[0]] = { exports: db, loaded: true }; delete require.cache[paths[1]];
    t.after(() => { for (const [path, previous] of saved) { if (previous) require.cache[path] = previous; else delete require.cache[path]; } });
    return { db, state, transaction, grant: require(paths[1]).grantReferralCompletionRewards };
}

test('standalone referral reconciliation rechecks paid/completed qualification after customer and order locks', async t => {
    const f = fixture(t);
    f.state.cancelBeforeLock = true;
    assert.deepEqual(await f.grant(f.state.order.id), { granted: false });
    assert.deepEqual(f.state.locks, [['User', 'friend'], ['Order', 'qualifying-order']]);
    assert.equal(f.state.rewards.length, 0); assert.equal(f.state.notices.length, 0);
});

test('referral Gold and notices roll back together on a database interruption and retry without duplication', async t => {
    const f = fixture(t);
    f.state.failInviteeReward = true;
    await assert.rejects(f.grant(f.state.order.id), /interruption/);
    assert.equal(f.state.rewards.length, 0); assert.equal(f.state.notices.length, 0);
    f.state.failInviteeReward = false;
    const results = await Promise.all(Array.from({ length: 8 }, () => f.grant(f.state.order.id)));
    assert.ok(results.every(result => result.granted));
    assert.deepEqual(f.state.rewards.map(row => [row.userId, row.type, row.goldAmount]).sort(),
        [['friend', 'REFERRAL_INVITED', 50], ['inviter', 'REFERRAL_INVITER', 50]]);
    assert.equal(f.state.notices.length, 2);
});

test('inline referral grant shares the existing payment transaction and a power interruption cannot leave partial Gold', async t => {
    const f = fixture(t, { paymentStatus: 'PENDING' });
    await assert.rejects(f.transaction(async tx => {
        f.state.order.paymentStatus = 'PAID';
        const outerTransaction = tx.$transaction;
        tx.$transaction = async () => assert.fail('Do not nest a transaction inside settlement');
        try { await f.grant(f.state.order.id, tx); } finally { tx.$transaction = outerTransaction; }
        throw new Error('Simulated process interruption before commit');
    }), /before commit/);
    assert.equal(f.state.order.paymentStatus, 'PENDING');
    assert.equal(f.state.rewards.length, 0); assert.equal(f.state.notices.length, 0);
    await f.transaction(async tx => { f.state.order.paymentStatus = 'PAID'; await f.grant(f.state.order.id, tx); });
    assert.equal(f.state.order.paymentStatus, 'PAID'); assert.equal(f.state.rewards.length, 2);
});

test('referral rewards reject unpaid, non-completed, below-threshold, non-first and malformed qualification states', async t => {
    for (const override of [{ paymentStatus: 'PENDING' }, { status: 'CANCELLED' }, { totalPrice: 44.99 },
        { totalPrice: Infinity }, { customer: { referredById: 'friend' } }]) await t.test(JSON.stringify(override), async child => {
        const f = fixture(child, override);
        assert.equal((await f.grant(f.state.order.id)).granted, false);
        assert.equal(f.state.rewards.length, 0); assert.equal(f.state.notices.length, 0);
    });
    const f = fixture(t); f.state.firstPaidOrderId = 'earlier-paid-order';
    assert.equal((await f.grant(f.state.order.id)).granted, false); assert.equal(f.state.rewards.length, 0);
});
