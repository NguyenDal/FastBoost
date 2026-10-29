const test = require('node:test');
const assert = require('node:assert/strict');
const { presentActivityLogItems } = require('../src/utils/activityLogPresentation');

test('owner activity presents affected usernames without exposing user IDs in details', async () => {
    const db = {
        user: { findMany: async () => [
            { id: 'admin-1', username: 'CurrentAdmin' },
            { id: 'booster-1', username: 'CurrentBooster' },
            { id: 'user-1', username: 'CurrentCustomer' },
        ] },
    };
    const [item] = await presentActivityLogItems(db, [{
        id: 'audit-1', actorId: 'admin-1', actorName: 'OriginalAdmin', action: 'account.booster-access',
        targetType: 'user', targetId: 'user-1', targetLabel: 'OriginalCustomer',
        before: { id: 'user-1', username: 'OriginalCustomer', hasBoosterAccess: false },
        requested: { boosterId: 'booster-1', recipientAccountIds: ['user-1'], orderId: 'order-1' },
        after: { id: 'user-1', username: 'OriginalCustomer', hasBoosterAccess: true },
    }]);
    assert.equal(item.actorName, 'OriginalAdmin', 'the name recorded at action time is preserved');
    assert.equal(item.targetLabel, 'OriginalCustomer');
    assert.equal(item.requested.boosterName, 'CurrentBooster');
    assert.deepEqual(item.requested.recipientNames, ['OriginalCustomer']);
    assert.equal(item.before.username, 'OriginalCustomer');
    assert.equal(item.before.id, undefined);
    assert.equal(item.requested.orderId, undefined);
    assert.doesNotMatch(JSON.stringify([item.before, item.requested, item.after]), /user-1|booster-1|order-1/);
    assert.equal(item.targetId, 'user-1', 'stable record IDs remain available internally for links');
});

test('old ID-only labels resolve to useful names or neutral fallbacks', async () => {
    const db = {
        user: { findMany: async () => [{ id: 'admin-1', username: 'Manager' }, { id: 'user-1', username: 'BoosterName' }] },
        service: { findMany: async () => [{ id: 'service-1', title: 'League coaching' }] },
        order: { findMany: async () => [{ id: 'order-1', orderNumber: 'FB-102' }] },
    };
    const items = await presentActivityLogItems(db, [
        { actorId: 'admin-1', actorName: 'Admin', targetType: 'booster', targetId: 'user-1', targetLabel: 'user-1' },
        { actorId: 'admin-1', actorName: 'Admin', targetType: 'user', targetId: 'deleted-user', targetLabel: 'deleted-user' },
        { actorId: 'admin-1', actorName: 'Admin', targetType: 'priceRule', targetId: 'price-1', before: { serviceId: 'service-1' } },
        { actorId: 'admin-1', actorName: 'Admin', targetType: 'match', targetId: 'match-1', before: { orderId: 'order-1' } },
        { actorId: 'admin-1', actorName: 'Admin', targetType: 'contract', targetId: 'contract-1',
            targetLabel: 'Booster Service Agreement', before: { boosterId: 'user-1' } },
    ]);
    assert.equal(items[0].actorName, 'Manager');
    assert.equal(items[0].targetLabel, 'BoosterName');
    assert.equal(items[1].targetLabel, 'Unknown user');
    assert.equal(items[2].targetLabel, 'League coaching');
    assert.equal(items[3].targetLabel, 'FB-102');
    assert.equal(items[4].targetLabel, 'Booster Service Agreement · BoosterName');
});

test('each activity keeps the usernames recorded when that action happened', async () => {
    const db = { user: { findMany: async () => [
        { id: 'admin-1', username: 'CurrentAdmin' },
        { id: 'user-1', username: 'CurrentCustomer' },
    ] } };
    const items = await presentActivityLogItems(db, [
        { actorId: 'admin-1', actorName: 'NewAdmin', targetType: 'user', targetId: 'user-1',
            targetLabel: 'NewCustomer', before: { id: 'user-1', username: 'NewCustomer' } },
        { actorId: 'admin-1', actorName: 'OldAdmin', targetType: 'user', targetId: 'user-1',
            targetLabel: 'OldCustomer', before: { id: 'user-1', username: 'OldCustomer' } },
    ]);
    assert.deepEqual(items.map(item => [item.actorName, item.targetLabel]), [
        ['NewAdmin', 'NewCustomer'], ['OldAdmin', 'OldCustomer'],
    ]);
});

test('legacy payout events identify the affected booster using only public account metadata', async () => {
    const lookups = [];
    const db = {
        user: { findMany: async () => [{ id: 'admin-1', username: 'CurrentAdmin' }] },
        payoutInformation: { findMany: async args => {
            lookups.push(args);
            assert.deepEqual(args.select, { id: true, booster: { select: { username: true } } });
            return [{ id: 'payout-old', booster: { username: 'FastBoost' } }, { id: 'payout-unnamed', booster: { username: null } }];
        } },
    };
    const input = [
        { actorId: 'admin-1', actorName: 'Starlight', targetType: 'payoutInformation', targetId: 'payout-old', targetLabel: 'Payout information', before: { status: 'SUBMITTED', revision: 1, country: 'VN' } },
        { actorId: 'admin-1', actorName: 'Starlight', targetType: 'payoutInformation', targetId: 'payout-new', targetLabel: 'NameAtReview · Payout information' },
        { actorId: 'admin-1', targetType: 'payoutInformation', targetId: 'payout-unnamed', targetLabel: 'Payout information' },
        { actorId: 'admin-1', targetType: 'payoutInformation', targetId: 'payout-missing', targetLabel: 'Payout information' },
    ];
    const original = structuredClone(input);
    const result = await presentActivityLogItems(db, input);
    assert.equal(result[0].actorName, 'Starlight', 'actor and subject must remain distinct');
    assert.equal(result[0].targetLabel, 'FastBoost · Payout information');
    assert.equal(result[1].targetLabel, 'NameAtReview · Payout information', 'recorded names survive later renames');
    assert.equal(result[2].targetLabel, 'Booster · Payout information');
    assert.equal(result[3].targetLabel, 'Booster · Payout information');
    assert.deepEqual(result[0].before, original[0].before);
    assert.deepEqual(input, original, 'historical stored entries are not rewritten');
    assert.equal(lookups.length, 1, 'one batched metadata lookup');
    assert.deepEqual(lookups[0].where.id.in, ['payout-old', 'payout-unnamed', 'payout-missing']);
});
