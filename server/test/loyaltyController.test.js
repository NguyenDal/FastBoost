const test = require('node:test');
const assert = require('node:assert/strict');

test('loyalty response preserves balances, tiers, reward aliases and pagination with the database page', async () => {
    const paths = ['../src/prisma', '../src/utils/loyaltyTierBonuses', '../src/utils/referralProgram',
        '../src/utils/loyaltyRewards', '../src/controllers/loyaltyController'].map(require.resolve);
    const saved = paths.map(path => [path, require.cache[path]]);
    const { rewardPagination } = require(paths[3]);
    const rewards = [{ id: 'order-sample', type: 'COMPLETED_ORDER', title: 'Rank Boost',
        goldEarned: 49, createdAt: new Date('2026-10-16T00:00:00Z') }];
    const reads = [];
    let syncs = 0;
    const offer = { eligible: false, rewardDollarValue: 5 };
    const completedWhere = { customerId: 'customer', status: 'COMPLETED', paymentStatus: 'PAID' };
    const db = {
        user: { findUnique: async () => ({ id: 'customer', referralCode: 'ready', _count: { referrals: 2 } }) },
        order: { aggregate: async ({ where }) => {
            assert.deepEqual(where, completedWhere);
            return { _count: { _all: 8 }, _sum: { totalPrice: 249.99 } };
        } },
        rewardHistory: {
            count: async () => 3,
            aggregate: async () => ({ _sum: { goldAmount: -100 } }),
        },
        $queryRaw: async () => [{ totalGold: 247 }],
    };
    try {
        require.cache[paths[0]] = { exports: db };
        require.cache[paths[1]] = { exports: { syncLoyaltyTierBonuses: async (client, id) => {
            assert.equal(client, db); assert.equal(id, 'customer'); syncs++;
        } } };
        require.cache[paths[2]] = { exports: { getReferralFirstPurchaseOffer: async () => offer } };
        require.cache[paths[3]] = { exports: { rewardPagination, rewardPage: async (client, id, offset, limit) => {
            assert.equal(client, db); reads.push({ id, offset, limit }); return rewards;
        } } };
        delete require.cache[paths[4]];
        const { getMyLoyalty } = require(paths[4]);
        const request = async (query, user = { id: 'customer' }) => {
            const response = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
            await getMyLoyalty({ user, query }, response);
            return response;
        };
        const response = await request({ rewardPage: '2', rewardLimit: '5' });
        assert.equal(response.statusCode, 200);
        const { loyalty } = response.body;
        assert.deepEqual(reads, [{ id: 'customer', offset: 5, limit: 5 }]);
        assert.equal(loyalty.totalGold, 147);
        assert.equal(loyalty.totalCompletedSpend, 249.99);
        assert.equal(loyalty.completedMatches, 8);
        assert.equal(loyalty.tier, 'Silver');
        assert.equal(loyalty.rewardHistory, rewards);
        assert.equal(loyalty.completedOrders, rewards);
        assert.deepEqual(loyalty.rewardPagination, { page: 2, limit: 5, totalItems: 11, totalPages: 3 });
        assert.equal(loyalty.referralOffer, offer);
        assert.equal(loyalty.referralCount, 2);
        assert.equal((await request({ rewardPage: '1.5' })).statusCode, 400);
        assert.equal((await request({}, null)).statusCode, 401);
        assert.equal(syncs, 1, 'invalid and unauthenticated requests must not reconcile rewards');
        assert.equal(reads.length, 1);
    } finally {
        for (const [path, value] of saved) {
            if (value) require.cache[path] = value; else delete require.cache[path];
        }
    }
});
