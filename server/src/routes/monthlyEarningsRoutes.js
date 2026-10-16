const express = require('express');
const prisma = require('../prisma');
const { protect } = require('../middleware/authMiddleware');
const { loadMonthlyEarnings, loadMonthlyEarningsReport } = require('../utils/monthlyBoosterEarnings');

const handle = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function createMonthlyEarningsRouter({ db = prisma, authenticate = protect,
    renderStatement = report => require('../utils/earningsStatementPdf').renderEarningsStatement(report) } = {}) {
    const router = express.Router();
    router.use(authenticate, handle(async (req, res, next) => {
        const actor = await db.user.findUnique({ where: { id: req.user.userId || req.user.id },
            select: { id: true, role: true, hasBoosterAccess: true, suspendedAt: true, username: true, profile: { select: { displayName: true } } } });
        if (!actor || actor.suspendedAt || !(actor.role === 'PROVIDER' || actor.role === 'ADMIN' || actor.hasBoosterAccess)) {
            return res.status(403).json({ ok: false, message: 'Booster access is required.' });
        }
        req.earningsActor = actor;
        res.set('Cache-Control', 'private, no-store');
        next();
    }));
    router.get('/', handle(async (req, res) => {
        res.json(await loadMonthlyEarnings(db, req.earningsActor.id, { currency: 'USD' }));
    }));
    async function reportFor(req, allowOpen = false) {
        const report = await loadMonthlyEarningsReport(db, req.earningsActor.id, req.params.month, { allowOpen, currency: 'USD' });
        return { ...report, booster: { displayName: req.earningsActor.profile?.displayName || req.earningsActor.username || 'Booster' } };
    }
    router.get('/:month/pdf', handle(async (req, res) => {
        // Exports require a completed calendar month; JSON details may stay live.
        const report = await reportFor(req);
        const pdf = await renderStatement(report);
        res.type('application/pdf');
        res.set('Content-Disposition', `attachment; filename="FastBoost-earnings-${report.period.month}.pdf"`);
        res.send(pdf);
    }));
    router.get('/:month', handle(async (req, res) => {
        res.json(await reportFor(req, true));
    }));
    router.use((error, req, res, next) => {
        if (res.headersSent) return next(error);
        res.status(error.status || 500).json({ ok: false, ...(error.available === false ? { available: false } : {}),
            message: error.status ? error.message : 'Could not load monthly earnings. Please try again.' });
    });
    return router;
}

module.exports = { createMonthlyEarningsRouter };
