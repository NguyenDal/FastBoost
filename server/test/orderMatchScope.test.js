const test = require('node:test');
const assert = require('node:assert/strict');
const { matchScope, matchesOrder, usesMatchHistory } = require('../src/utils/orderMatchScope');
const { orderEarnings } = require('../src/utils/earnings');

test('each sold service maps to exactly one game and ranked queue', () => {
    for (const boostType of ['Rank Boost', 'Placement Boost', 'Win Boost', 'Pro Duo']) {
        for (const [queueType, queueId] of [['Solo/Duo', 420], ['Flex', 440]]) {
            const order = { boostType, queueType };
            assert.equal(matchScope(order).queueId, queueId);
            for (const queue of [400, 420, 440, 450, 1090, 1100, 1160]) {
                assert.equal(matchesOrder(order, { game: 'LOL', details: { queueId: queue } }), queue === queueId);
            }
            assert.equal(matchesOrder(order, { game: 'TFT', details: { queueId } }), false);
        }
    }
    for (const boostType of ['TFT Rank Boost', 'TFT Win Boost', 'TFT Placement Boost']) {
        for (const queueType of ['Ranked', 'Solo/Duo', 'Flex', null]) {
            const order = { boostType, queueType };
            assert.deepEqual(matchScope(order), { game: 'TFT', queueId: 1100, label: 'Ranked TFT' });
            for (const queueId of [420, 440, 1090, 1100, 1130, 1160]) assert.equal(matchesOrder(order, { game: 'TFT', details: { queueId } }), queueId === 1100);
        }
    }
    for (const order of [{}, { boostType: 'Rank Boost' }, { boostType: 'Rank Boost', queueType: 'unknown' }, { boostType: 'unknown', queueType: 'Flex' }]) {
        assert.equal(matchScope(order), null);
        assert.equal(matchesOrder(order, { game: 'LOL', details: { queueId: 420 } }), false);
    }
});

test('only untouched active TFT orders adopt history without replacing legacy payouts', () => {
    const order = { boostType: 'TFT Rank Boost', matchHistoryEnabled: false, status: 'IN_PROGRESS', contributions: [] };
    assert.equal(usesMatchHistory(order), true);
    assert.equal(usesMatchHistory({ ...order, status: 'COMPLETED' }), false);
    assert.equal(usesMatchHistory({ ...order, status: 'CANCELLED' }), false);
    assert.equal(usesMatchHistory({ ...order, contributions: [{ boosterId: 'b' }] }), false);
    assert.equal(usesMatchHistory({ ...order, boostType: 'Rank Boost' }), false);
    assert.equal(usesMatchHistory({ ...order, matchHistoryEnabled: true, status: 'COMPLETED' }), true);
});

test('wrong queues cannot block or earn a share of a ranked order', () => {
    const input = { boostType: 'Rank Boost', queueType: 'Flex', amountCents: 10000, matchHistoryEnabled: true, matchHistoryConfirmedAt: new Date(), matches: [
        { game: 'LOL', details: { queueId: 440 }, status: 'APPROVED', boosterId: 'flex' },
        { game: 'LOL', details: { queueId: 420 }, status: 'APPROVED', boosterId: 'solo' },
        { game: 'LOL', details: { queueId: 420 }, status: 'PENDING', boosterId: 'solo' },
        { game: 'TFT', details: { queueId: 1100 }, status: 'APPROVED', boosterId: 'tft' },
    ] };
    assert.deepEqual(orderEarnings(input).shares, [{ boosterId: 'flex', matches: 1, cents: 7000 }]);
    assert.deepEqual(orderEarnings({ ...input, boostType: 'TFT Win Boost' }).shares, [{ boosterId: 'tft', matches: 1, cents: 7000 }]);
});
