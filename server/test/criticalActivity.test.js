const test = require('node:test');
const assert = require('node:assert/strict');
const { recordCriticalActivity } = require('../src/utils/criticalActivity');

const booster = { id: 'private-user-id', username: 'Starlight', role: 'PROVIDER', isOwner: false };

test('records a changed booster action using its username and no sensitive details', async () => {
    let row;
    const tx = { managementAuditLog: { create: async ({ data }) => { row = data; return data; } } };
    await recordCriticalActivity(tx, {
        actor: booster, action: 'assignment.accept', targetType: 'order',
        targetId: 'private-order-id', targetLabel: 'FB-104',
        before: { assignment: 'Invited' }, after: { assignment: 'Accepted' },
    });
    assert.equal(row.actorName, 'Starlight');
    assert.equal(row.action, 'assignment.accept');
    assert.equal(row.category, 'orders');
    assert.equal(row.targetLabel, 'FB-104');
    assert.equal(row.outcome, 'SUCCEEDED');
    assert.ok(row.finishedAt instanceof Date);
    assert.deepEqual(row.before, { assignment: 'Invited' });
    assert.deepEqual(row.after, { assignment: 'Accepted' });
});

test('skips admin events and unchanged retries so the route middleware is the only admin writer', async () => {
    let writes = 0;
    const tx = { managementAuditLog: { create: async () => { writes++; } } };
    const payload = { action: 'order.complete', targetType: 'order', targetId: 'order-1', targetLabel: 'FB-104',
        before: { status: 'IN_PROGRESS' }, after: { status: 'COMPLETED' } };
    assert.equal(await recordCriticalActivity(tx, { ...payload, actor: { ...booster, role: 'ADMIN' } }), null);
    assert.equal(await recordCriticalActivity(tx, { ...payload, actor: booster, after: payload.before }), null);
    assert.equal(writes, 0);
});

test('records a verified external admin signature when no HTTP audit route owns it', async () => {
    let row;
    const tx = { managementAuditLog: { create: async ({ data }) => { row = data; return data; } } };
    await recordCriticalActivity(tx, { actor: { id: 'owner', username: 'Owner', role: 'ADMIN', isOwner: true },
        allowAdmin: true, action: 'contract.sign', targetType: 'contract', targetId: 'contract-1',
        before: { companySignedAt: null }, after: { companySignedAt: 'signed' } });
    assert.equal(row.actorName, 'Owner');
    assert.equal(row.action, 'contract.sign');
});

test('fails the caller transaction if a changed event cannot be saved', async () => {
    const tx = { managementAuditLog: { create: async () => { throw new Error('audit unavailable'); } } };
    await assert.rejects(recordCriticalActivity(tx, { actor: booster, action: 'contract.sign', targetType: 'contract',
        targetId: 'contract-1', before: { signedAt: null }, after: { signedAt: 'now' } }), /audit unavailable/);
});
