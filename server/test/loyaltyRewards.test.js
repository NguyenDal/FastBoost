const test = require("node:test");
const assert = require("node:assert/strict");
const { mergeRewardPage } = require("../src/utils/loyaltyRewards");

const reward = (id, day) => ({ id, createdAt: new Date(Date.UTC(2026, 0, day)) });

test("reward pages preserve chronological order and order-first timestamp ties", () => {
    const orders = [reward("o6", 6), reward("o4", 4), reward("o1", 1)];
    const bonuses = [reward("b5", 5), reward("b4", 4), reward("b2", 2)];
    assert.deepEqual(mergeRewardPage(orders, bonuses, 0, 3).map(r => r.id), ["o6", "b5", "o4"]);
    assert.deepEqual(mergeRewardPage(orders, bonuses, 3, 3).map(r => r.id), ["b4", "b2", "o1"]);
    assert.deepEqual(mergeRewardPage(orders, bonuses, 6, 3), []);
});

test("reward pagination handles empty sources and partial final pages", () => {
    const rewards = [reward("r3", 3), reward("r2", 2), reward("r1", 1)];
    assert.deepEqual(mergeRewardPage([], [], 0, 5), []);
    assert.deepEqual(mergeRewardPage(rewards, [], 2, 5), [rewards[2]]);
    assert.deepEqual(mergeRewardPage([], rewards, 2, 5), [rewards[2]]);
});
