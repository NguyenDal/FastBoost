// Write material booster actions in the same transaction as the change.
// The owner-facing report resolves internal IDs to names; never copy messages,
// credentials, signatures, or full request bodies into these records.
const eventCategory = {
    'assignment.accept': 'orders',
    'order.leave': 'orders',
    'order.complete': 'orders',
    'contract.sign': 'boosters',
};

async function recordCriticalActivity(tx, { actor, action, targetType, targetId, targetLabel, requested = {}, before = {}, after = {}, allowAdmin = false, allowMissingActor = false }) {
    if (actor?.role === 'ADMIN' && !allowAdmin) return null; // The management middleware records admin HTTP actions.
    if ((!actor?.id && !allowMissingActor) || !actor?.role || !eventCategory[action] || !targetType || !targetId) throw new Error('Invalid critical activity event.');
    if (JSON.stringify(before) === JSON.stringify(after)) return null;
    const now = new Date();
    return tx.managementAuditLog.create({ data: {
        actorId: actor.id || null,
        actorName: typeof actor.username === 'string' && actor.username.trim() ? actor.username.trim() : 'Unknown user',
        actorRole: actor.role,
        actorIsOwner: Boolean(actor.isOwner),
        category: eventCategory[action], action, targetType, targetId,
        targetLabel: targetLabel || null,
        requested, before, after,
        outcome: 'SUCCEEDED', statusCode: 200, finishedAt: now,
    } });
}

module.exports = { recordCriticalActivity };
