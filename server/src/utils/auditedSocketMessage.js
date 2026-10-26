// Socket chat still checks the current account before sending, but ordinary
// conversation messages are not critical owner activity events.
async function withAuditedSocketMessage(db, session, _conversationId, send) {
    const actor = await db.user.findUnique({ where: { id: session.id || session.userId },
        select: { role: true, suspendedAt: true } });
    if (!actor || actor.suspendedAt || (session.role === 'ADMIN' && actor.role !== 'ADMIN')) {
        throw Object.assign(new Error('Chat access is unavailable.'), { status: 403 });
    }
    return send();
}
module.exports = { withAuditedSocketMessage };
