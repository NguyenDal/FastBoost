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

test('assigned boosters show recorded names while order and unnamed user IDs remain available', () => {
    const fields = activityLogFields({ id: 'order-id', orderNumber: 'FB-100', assignments: [
        { boosterId: 'booster-id', booster: { username: 'Fast player' } },
        { boosterId: 'legacy-booster-id' },
    ] });
    assert.deepEqual(fields, [['Id', 'order-id'], ['Order Number', 'FB-100'],
        ['Assignments', 'Booster · Username: Fast player\nBooster Id: legacy-booster-id']]);
    for (const username of [undefined, null, '', '   ']) {
        assert.deepEqual(activityLogFields({ id: 'old-user-id', ...(username === undefined ? {} : { username }) })[0], ['Id', 'old-user-id']);
    }
});
