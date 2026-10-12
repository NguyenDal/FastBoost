const express = require('express');
const db = require('../prisma');
const { protect } = require('../middleware/authMiddleware');
const { actions, categories } = require('../utils/managementAudit');
const PAGE_SIZE = 10;
const fail = message => { throw Object.assign(new Error(message), { status: 400 }); };
function filters(query) {
    // Keep internal rollout metadata out of the owner's action list and totals.
    const where = { action: { not: 'logging.enabled' } };
    const q = String(query.q || '').trim();
    if (q.length > 100) fail('Search must be 100 characters or fewer.');
    if (q) where.OR = ['actorName', 'targetLabel', 'targetId'].map(key => ({ [key]: { contains: q, mode: 'insensitive' } }));
    if (query.actor) {
        if (typeof query.actor !== 'string' || query.actor.length > 128) fail('Choose an admin.');
        where.actorId = query.actor;
    }
    if (query.category) {
        if (!Object.hasOwn(categories, query.category)) fail('Choose a valid area.');
        where.category = query.category;
    }
    if (query.outcome) {
        if (!['SUCCEEDED', 'FAILED', 'STARTED'].includes(query.outcome)) fail('Choose a valid outcome.');
        where.outcome = query.outcome;
    }
    for (const [key, bound] of [['from', 'gte'], ['to', 'lt']]) {
        if (!query[key]) continue;
        const date = new Date(`${query[key]}T00:00:00.000Z`);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(query[key]) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== query[key]) fail('Choose a valid date.');
        where.createdAt ||= {};
        where.createdAt[bound] = key === 'to' ? new Date(date.getTime() + 86400000) : date;
    }
    if (where.createdAt?.gte && where.createdAt?.lt && where.createdAt.gte >= where.createdAt.lt) fail('End date must be on or after start date.');
    const page = query.page === undefined ? 1 : Number(query.page);
    if (!Number.isSafeInteger(page) || page < 1 || page > 1000000) fail('Choose a valid page.');
    return { where, page };
}
function createActivityLogRouter(client = db) {
    const router = express.Router();
    router.use(protect, async (req, res, next) => {
        res.set('Cache-Control', 'no-store');
        try {
            const user = await client.user.findUnique({ where: { id: req.user.id || req.user.userId }, select: { role: true, isOwner: true, suspendedAt: true } });
            if (!user?.isOwner || user.role !== 'ADMIN' || user.suspendedAt) return res.status(403).json({ message: 'Only the owner can view activity logs.' });
            next();
        } catch (error) { next(error); }
    });
    router.get('/access', (req, res) => res.json({ canView: true }));
    router.get('/', async (req, res, next) => {
        try {
            const { where, page: requestedPage } = filters(req.query);
            const result = await client.$transaction(async tx => {
                const total = await tx.managementAuditLog.count({ where });
                const page = Math.min(requestedPage, Math.max(1, Math.ceil(total / PAGE_SIZE)));
                const items = await tx.managementAuditLog.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: PAGE_SIZE, skip: (page - 1) * PAGE_SIZE });
                return { items, total, page, pageSize: PAGE_SIZE };
            }, { isolationLevel: 'RepeatableRead' });
            const actors = await client.managementAuditLog.findMany({ where: { actorId: { not: null }, action: { not: 'logging.enabled' } }, distinct: ['actorId'], select: { actorId: true, actorName: true }, orderBy: { createdAt: 'desc' } });
            res.json({ ...result, actors, categories,
                items: result.items.map(item => ({ ...item, actionLabel: actions[item.action] || 'Management action' })) });
        } catch (error) { next(error); }
    });
    router.use((error, req, res, next) => {
        if (res.headersSent) return next(error);
        res.status(error.status || 503).json({ message: error.status ? error.message : 'Activity logs are temporarily unavailable. Please try again.' });
    });
    return router;
}
module.exports = { createActivityLogRouter, filters };
