const router = require('express').Router();
const db = require('../prisma');
const { protect } = require('../middleware/authMiddleware');
const { orderEarnings } = require('../utils/earnings');
const handle = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const eligible = user => user.role === 'PROVIDER' || user.hasBoosterAccess;
const identity = { id: true, email: true, username: true, role: true, hasBoosterAccess: true, suspendedAt: true, profile: { select: { displayName: true, profileImageUrl: true } } };
router.use(protect, handle(async (req, res, next) => {
    req.actor = await db.user.findUnique({ where: { id: req.user.userId || req.user.id }, select: identity });
    if (!req.actor || req.actor.suspendedAt) fail(403, 'Access unavailable.');
    res.set('Cache-Control', 'no-store'); next();
}));
const admin = (req, res, next) => req.actor.role === 'ADMIN' ? next() : next(Object.assign(new Error('Admins only.'), { status: 403 }));

async function earnings() {
    const orders = await db.order.findMany({ where: { paymentStatus: 'PAID', status: 'COMPLETED' },
        select: { id: true, orderNumber: true, boostType: true, amountCents: true, goldDiscountCents: true, currency: true, paidAt: true, updatedAt: true,
            assignments: { select: { boosterId: true } }, contributions: true }, orderBy: { updatedAt: 'desc' } });
    const totals = {}, boosters = {};
    let missingAmounts = 0;
    const rows = [];
    for (const order of orders) {
        const amounts = orderEarnings(order);
        if (!amounts) { missingAmounts++; continue; }
        const currency = order.currency.toUpperCase();
        const total = totals[currency] ||= { currency, revenueCents: 0, boosterCents: 0, platformCents: 0, unallocatedCents: 0, orders: 0 };
        for (const key of ['revenueCents', 'boosterCents', 'platformCents']) total[key] += amounts[key];
        if (!amounts.shares.length) total.unallocatedCents += amounts.boosterCents;
        total.orders++;
        for (const share of amounts.shares) {
            const amount = boosters[share.boosterId] ||= {};
            amount[currency] = (amount[currency] || 0) + share.cents;
        }
        rows.push({ ...order, assignments: undefined, ...amounts, currency });
    }
    return { totals: Object.values(totals), boosters, rows, missingAmounts };
}
router.get('/earnings', admin, handle(async (req, res) => res.json({ ok: true, ...await earnings() })));
router.get('/contributions', handle(async (req, res) => {
    if (req.actor.role !== 'ADMIN' && !eligible(req.actor)) fail(403, 'Boosters only.');
    const isAdmin = req.actor.role === 'ADMIN';
    const rows = await db.order.findMany({ where: { paymentStatus: 'PAID', status: { in: ['PENDING', 'IN_PROGRESS', 'COMPLETED'] },
        ...(isAdmin ? {} : { OR: [{ assignments: { some: { boosterId: req.actor.id } } }, { contributions: { some: { boosterId: req.actor.id } } }] }) },
        select: { id: true, orderNumber: true, boostType: true, status: true,
            assignments: { select: { boosterId: true, booster: { select: { username: true } } } },
            contributions: { include: { booster: { select: { username: true } } } } }, orderBy: { updatedAt: 'desc' } });
    res.json({ ok: true, orders: rows.map(order => ({ ...order, assignments: isAdmin ? order.assignments : order.assignments.filter(a => a.boosterId === req.actor.id),
        contributions: isAdmin ? order.contributions : order.contributions.filter(c => c.boosterId === req.actor.id) })) });
}));
router.post('/contributions/:orderId', handle(async (req, res) => {
    if (!eligible(req.actor)) fail(403, 'Boosters only.');
    const matches = req.body.matches;
    if (!Number.isInteger(matches) || matches < 0 || matches > 10000) fail(400, 'Enter a whole match count from 0 to 10,000.');
    const assigned = await db.orderAssignment.findUnique({ where: { orderId_boosterId: { orderId: req.params.orderId, boosterId: req.actor.id } }, include: { order: true } });
    if (!assigned || assigned.order.paymentStatus !== 'PAID' || assigned.order.status === 'CANCELLED') fail(403, 'Only your assigned paid orders accept submissions.');
    // Revisions invalidate approval; the admin must review the exact submitted version.
    await db.boosterContribution.upsert({ where: { orderId_boosterId: { orderId: assigned.orderId, boosterId: req.actor.id } },
        create: { orderId: assigned.orderId, boosterId: req.actor.id, submittedMatches: matches },
        update: { submittedMatches: matches, approvedMatches: null, submittedAt: new Date(), reviewedAt: null, reviewedBy: null, reviewNote: null, revision: { increment: 1 } } });
    res.json({ ok: true });
}));
router.post('/contributions/:orderId/:boosterId/review', admin, handle(async (req, res) => {
    if (!Number.isInteger(req.body.revision) || !['approve', 'return'].includes(req.body.decision)) fail(400, 'Choose an approval decision.');
    const key = { orderId: req.params.orderId, boosterId: req.params.boosterId };
    const contribution = await db.boosterContribution.findUnique({ where: { orderId_boosterId: key } });
    if (!contribution) fail(404, 'Submission not found.');
    const note = String(req.body.note || '').trim().slice(0, 500);
    if (req.body.decision === 'return' && !note) fail(400, 'Explain what needs correcting.');
    const result = await db.boosterContribution.updateMany({ where: { ...key, revision: req.body.revision, reviewedAt: null },
        data: { approvedMatches: req.body.decision === 'approve' ? contribution.submittedMatches : null, reviewedAt: new Date(), reviewedBy: req.actor.id, reviewNote: note || null } });
    if (!result.count) fail(409, 'This submission changed. Refresh and review it again.');
    res.json({ ok: true });
}));
router.get('/me', handle(async (req, res) => {
    if (!eligible(req.actor)) fail(403, 'Boosters only.');
    const [profile, contracts, income] = await Promise.all([
        db.boosterProfile.findUnique({ where: { userId: req.actor.id } }),
        db.boosterContract.findMany({ where: { boosterId: req.actor.id }, select: { id: true, title: true, startsAt: true, signedAt: true, revokedAt: true }, orderBy: { createdAt: 'desc' } }), earnings(),
    ]);
    res.json({ ok: true, profile, contracts, earnings: income.boosters[req.actor.id] || {} });
}));
router.get('/boosters', admin, handle(async (req, res) => {
    const [users, income] = await Promise.all([
        db.user.findMany({ where: { OR: [{ role: 'PROVIDER' }, { hasBoosterAccess: true }] }, select: { ...identity,
            boosterProfile: true, boosterContracts: { orderBy: { createdAt: 'desc' }, select: { id: true, title: true, startsAt: true, createdAt: true, signedAt: true, signedName: true, revokedAt: true } },
            providedAssignments: { where: { order: { paymentStatus: 'PAID', status: { in: ['PENDING', 'IN_PROGRESS'] } } }, select: { id: true } },
        }, orderBy: { username: 'asc' } }), earnings(),
    ]);
    res.json({ ok: true, boosters: users.map(user => ({ ...user, earnings: income.boosters[user.id] || {} })) });
}));
router.patch('/boosters/:id', admin, handle(async (req, res) => {
    const user = await db.user.findUnique({ where: { id: req.params.id } });
    if (!user || !eligible(user)) fail(404, 'Booster not found.');
    const startedAt = new Date(req.body.startedAt);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(req.body.startedAt || '') || !Number.isFinite(startedAt.getTime()) || startedAt.toISOString().slice(0, 10) !== req.body.startedAt || startedAt > new Date()) fail(400, 'Choose a valid start date no later than today.');
    await db.boosterProfile.upsert({ where: { userId: user.id }, create: { userId: user.id, startedAt }, update: { startedAt } });
    res.json({ ok: true });
}));
router.use(require('./contractRoutes'));
router.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    res.status(error.status || 500).json({ ok: false,
        message: error.status ? error.message : 'Could not load management data. Please try again.' });
});
module.exports = router;
