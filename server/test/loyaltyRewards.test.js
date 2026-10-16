const test = require('node:test');
const assert = require('node:assert/strict');
const { rewardPage, rewardPagination } = require('../src/utils/loyaltyRewards');

test('reward pagination has bounded integer limits and rejects malformed offsets', () => {
    assert.deepEqual(rewardPagination({}), { page: 1, limit: 5, offset: 0 });
    assert.deepEqual(rewardPagination({ rewardPage: '1000', rewardLimit: '50' }), { page: 1000, limit: 10, offset: 9990 });
    for (const value of ['NaN', 'Infinity', '-1', '0', '1.5', '1000001', ['1'], {}]) {
        assert.throws(() => rewardPagination({ rewardPage: value }), { status: 400 });
    }
    for (const value of ['Infinity', '-1', '0', '1.5', ['5'], {}]) {
        assert.throws(() => rewardPagination({ rewardLimit: value }), { status: 400 });
    }
});

test('deep reward pages return only the database page and bind account and pagination values', async () => {
    const rows = [{ id: 'reward-last', goldEarned: -100 }];
    const userId = "customer' OR TRUE --";
    const db = { $queryRaw: async (strings, ...values) => {
        assert.deepEqual(values, [userId, 10000, userId, 10000, 10, 9990]);
        assert.equal(strings.join('').includes(userId), false);
        return rows;
    } };
    assert.equal(await rewardPage(db, userId, 9990, 10), rows);
});
