const db = require('../prisma');
const { createProtect } = require('./authMiddleware');
const { routeFor, snapshot, labelFor, materialChange, requestDetails, responseDetails, resultId } = require('../utils/managementAudit');

function createManagementAudit(client = db) {
    const protect = createProtect(client);
    return (req, res, next) => {
        let route;
        try { route = routeFor(req.method, req.path); }
        catch { return res.status(400).json({ message: 'Invalid management request.' }); }
        if (!route) return next();
        return protect(req, res, async () => {
            let actor, record, targetId, before;
            try {
                actor = await client.user.findUnique({ where: { id: req.user.id || req.user.userId },
                    select: { id: true, username: true, role: true, isOwner: true, suspendedAt: true } });
                // Mixed customer/booster routes retain their existing authorization.
                // A stale admin token must not bypass recording or current access.
                if (!actor || actor.suspendedAt || (req.user.role === 'ADMIN' && actor.role !== 'ADMIN')) {
                    return res.status(403).json({ message: 'Management access is unavailable.' });
                }
                if (actor.role !== 'ADMIN') return next();
                targetId = route.targetType === 'match' ? route.params.matchId : route.params.id;
                if (route.action === 'contract.create') targetId = typeof req.body?.requestId === 'string' ? req.body.requestId : undefined;
                before = await snapshot(client, route, targetId);
                record = await client.managementAuditLog.create({ data: {
                    actorId: actor.id, actorName: actor.username?.trim() || 'Unknown user', actorRole: actor.role, actorIsOwner: actor.isOwner,
                    category: route.category, action: route.action, targetType: route.targetType, targetId: targetId || null,
                    targetLabel: labelFor(route, before),
                    requested: requestDetails(route, req), ...(before ? { before } : {}),
                } });
            } catch (error) {
                console.error('[Management audit] Could not begin recording:', error.code || 'INTERNAL');
                // No management change is allowed without a durable initial entry.
                return res.status(503).json({ message: 'Activity logging is unavailable. No action was started. Please try again.' });
            }

            let responseBody;
            const originalJson = res.json;
            res.json = function (body) { responseBody = body; return originalJson.call(this, body); };
            const originalEnd = res.end;
            let ending = false;
            res.end = function (...args) {
                if (ending) return this;
                ending = true;
                const statusCode = res.statusCode;
                const succeeded = statusCode >= 200 && statusCode < 400;
                const finalId = succeeded ? resultId(route, responseBody) || targetId : targetId;
                (async () => {
                    let after, snapshotFailed = false;
                    try { after = await snapshot(client, route, finalId); }
                    catch { snapshotFailed = true; after = { detailsUnavailable: true }; }
                    // The owner feed contains completed, substantive changes only.
                    // Failed requests and no-op saves remain in the internal journal.
                    const outcome = snapshotFailed ? 'STARTED' : !succeeded ? 'FAILED'
                        : materialChange(route, before, after) ? 'SUCCEEDED' : 'NO_CHANGE';
                    await client.managementAuditLog.update({ where: { id: record.id }, data: {
                        targetId: finalId || null, targetLabel: labelFor(route, after) || record.targetLabel,
                        after: { ...(after || { recordMissing: true }), ...responseDetails(route, responseBody) },
                        outcome, statusCode, finishedAt: new Date(),
                    } });
                })().catch(error => {
                    // The durable STARTED entry remains visible as unconfirmed if
                    // finalization fails or the process dies. Never claim rollback.
                    console.error('[Management audit] Outcome unconfirmed:', record.id, error.code || 'INTERNAL');
                }).finally(() => originalEnd.apply(res, args));
                return this;
            };
            next();
        });
    };
}
module.exports = { createManagementAudit };
