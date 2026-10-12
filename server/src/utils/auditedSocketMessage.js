const { routeFor, snapshot, responseDetails } = require('./managementAudit');

// Socket messages bypass Express, so admin sends need the same durable journal.
// No message contents or attachment data are copied into the audit trail.
async function withAuditedSocketMessage(db, session, conversationId, send) {
    const actor = await db.user.findUnique({ where: { id: session.id || session.userId },
        select: { id: true, username: true, role: true, isOwner: true, suspendedAt: true } });
    if (!actor || actor.suspendedAt || (session.role === 'ADMIN' && actor.role !== 'ADMIN')) {
        throw Object.assign(new Error('Chat access is unavailable.'), { status: 403 });
    }
    if (actor.role !== 'ADMIN') return send();
    const route = routeFor('POST', `/chats/conversations/${encodeURIComponent(conversationId)}/messages`);
    let record;
    try {
        const before = await snapshot(db, route, conversationId);
        record = await db.managementAuditLog.create({ data: {
            actorId: actor.id, actorName: actor.username || 'Admin', actorRole: actor.role, actorIsOwner: actor.isOwner,
            category: route.category, action: route.action, targetType: route.targetType, targetId: conversationId,
            requested: { transport: 'Live chat' }, ...(before ? { before } : {}),
        } });
    } catch {
        throw Object.assign(new Error('Activity logging is unavailable. No message was sent.'), { status: 503 });
    }
    async function finish(statusCode, message) {
        try {
            await db.managementAuditLog.update({ where: { id: record.id }, data: {
                outcome: statusCode < 400 ? 'SUCCEEDED' : 'FAILED', statusCode, finishedAt: new Date(),
                after: responseDetails(route, { message }),
            } });
        } catch (error) { console.error('[Management audit] Outcome unconfirmed:', record.id, error.code || 'INTERNAL'); }
    }
    try {
        const message = await send(); await finish(201, message); return message;
    } catch (error) { await finish(error.status || 500); throw error; }
}
module.exports = { withAuditedSocketMessage };
