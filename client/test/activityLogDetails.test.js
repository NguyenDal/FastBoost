import test from 'node:test';
import assert from 'node:assert/strict';
import { activityLogFields } from '../src/utils/activityLogDetails.js';

test('account changes show the recorded username instead of an opaque user ID', () => {
    const before = { id: 'cmvg5oo0d0002rwrjly79oynx', username: 'Teammate', role: 'CUSTOMER' };
    const after = { ...before, username: 'Updated teammate', role: 'PROVIDER' };
    assert.deepEqual(activityLogFields(before), [['Username', 'Teammate'], ['Role', 'CUSTOMER']]);
    assert.deepEqual(activityLogFields(after), [['Username', 'Updated teammate'], ['Role', 'PROVIDER']]);
    assert.equal(before.id, 'cmvg5oo0d0002rwrjly79oynx', 'display formatting does not alter historical evidence');
});

test('assigned boosters show recorded names without exposing any nested user or order IDs', () => {
    const fields = activityLogFields({ id: 'order-id', orderNumber: 'FB-100', assignments: [
        { boosterId: 'booster-id', booster: { username: 'Fast player' } },
        { boosterId: 'legacy-booster-id' },
    ] });
    assert.deepEqual(fields, [['Order Number', 'FB-100'],
        ['Assignments', 'Booster · Username: Fast player\nUnknown user']]);
    for (const username of [undefined, null, '', '   ']) {
        const entries = activityLogFields({ id: 'old-user-id', ...(username === undefined ? {} : { username }) });
        assert.ok(entries.every(([label, text]) => !/id/i.test(label) && text !== 'old-user-id'));
        if (username !== undefined) assert.deepEqual(entries, [['Username', 'Unknown user']]);
    }
});

test('legacy arrays of account IDs cannot leak into detail values', () => {
    const fields = activityLogFields({
        recipientAccountIds: ['cmvg5oo0d0002rwrjly79oynx'],
        requested: { boosterId: 'booster-id', recipient: { id: 'cmvg5oo0d0002rwrjly79oynx', username: 'Player' } },
        assignments: [{ boosterId: 'legacy-booster-id' }],
        references: ['acct_1TjsIyBZGR1g9f2K'],
    });
    assert.deepEqual(fields, [
        ['Requested · Recipient · Username', 'Player'],
        ['Assignments', 'Unknown user'],
        ['References', 'Reference unavailable'],
    ]);
    assert.doesNotMatch(JSON.stringify(fields), /booster-id|cmvg5oo0d0002rwrjly79oynx|acct_1TjsIyBZGR1g9f2K/);
});
