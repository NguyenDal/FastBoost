const router = require('express').Router();
const db = require('../prisma');
const { protect } = require('../middleware/authMiddleware');
const { buildEarningsReport } = require('../utils/earningsReport');
const { boosterEarnings } = require('../utils/boosterEarnings');
const { boosterRating } = require('../utils/orderRatings');
const { preferenceSelect, validatePreferences, missingPreferencesTable, loadPreferences, loadPreferencesForUsers } = require('../utils/boosterPreferences');
const { usesMatchHistory } = require('../utils/orderMatchScope');
const { withEarningsLedgerMutation } = require('../utils/boosterEarningsLedger');
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
router.use('/provider-agreement', require('./providerAgreementRoutes'));
router.use(require('./matchHistoryRoutes'));

async function earnings() {
    const boosterIdentity = { id: true, username: true, profile: { select: { displayName: true } } };
    const orders = await db.order.findMany({ where: { paymentStatus: 'PAID', status: 'COMPLETED' },
        select: { id: true, orderNumber: true, boostType: true, queueType: true, amountCents: true, goldDiscountCents: true, currency: true, paidAt: true, updatedAt: true,
            matchHistoryEnabled: true, matchHistoryConfirmedAt: true,
            matches: { select: { game: true, details: true, status: true, boosterId: true, booster: { select: boosterIdentity } } },
            assignments: { select: { boosterId: true, booster: { select: boosterIdentity } } },
            contributions: { include: { booster: { select: boosterIdentity } } } }, orderBy: [{ paidAt: 'desc' }, { id: 'desc' }] });
    return buildEarningsReport(orders);
}
router.get('/earnings', admin, handle(async (req, res) => {
    const [report, boosterDirectory] = await Promise.all([earnings(), db.user.findMany({
        where: { OR: [{ role: 'PROVIDER' }, { hasBoosterAccess: true }] },
        select: { id: true, username: true, profile: { select: { displayName: true } } }, orderBy: { username: 'asc' },
    })]);
    res.json({ ok: true, ...report, boosterDirectory });
}));
// The CSV is assembled in the browser. Record the export request before allowing
// the download; this does not claim that the browser saved a file successfully.
router.post('/earnings/export', admin, handle(async (req, res) => {
    const body = req.body || {};
    if (!['orders', 'boosters'].includes(body.exportType) || !Number.isSafeInteger(body.rowCount) || body.rowCount < 0) fail(400, 'Choose a valid earnings export.');
    for (const field of ['from', 'to']) {
        if (!body[field]) continue;
        const date = new Date(`${body[field]}T00:00:00Z`);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(body[field]) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== body[field]) fail(400, 'Choose a valid payment period.');
    }
    if (body.from && body.to && body.from > body.to) fail(400, 'Choose a valid payment period.');
    for (const field of ['query', 'reviewStatus', 'boosterId']) {
        if (body[field] != null && (typeof body[field] !== 'string' || body[field].length > 1000)) fail(400, 'Choose valid export filters.');
    }
    res.json({ ok: true });
}));
router.get('/contributions', handle(async (req, res) => {
    const scope = req.query.scope ?? 'mine';
    if (!['mine', 'all'].includes(scope)) fail(400, 'Choose a valid contribution view.');
    const reviewAll = scope === 'all';
    if (reviewAll ? req.actor.role !== 'ADMIN' : !eligible(req.actor)) fail(403, reviewAll ? 'Admins only.' : 'Boosters only.');
    const query = req.query.q ?? '';
    if (typeof query !== 'string' || query.length > 100) fail(400, 'Enter an order number up to 100 characters.');
    const requestedPage = req.query.page === undefined ? 1 : Number(req.query.page);
    if ((req.query.page !== undefined && (typeof req.query.page !== 'string' || !/^\d+$/.test(req.query.page))) || !Number.isSafeInteger(requestedPage) || requestedPage < 1) fail(400, 'Choose a valid page.');
    const where = { paymentStatus: 'PAID', status: { in: ['PENDING', 'IN_PROGRESS', 'COMPLETED'] },
        ...(query.trim() ? { orderNumber: { contains: query.trim(), mode: 'insensitive' } } : {}),
        ...(reviewAll ? {} : { OR: [{ assignments: { some: { boosterId: req.actor.id } } }, { contributions: { some: { boosterId: req.actor.id } } }] }) };
    const pageSize = 10;
    const total = await db.order.count({ where });
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(requestedPage, totalPages);
    const rows = await db.order.findMany({ where,
        select: { id: true, orderNumber: true, boostType: true, status: true, matchHistoryEnabled: true, matchHistoryConfirmedAt: true,
            // Keep other boosters' submissions out of personal response reads.
            // The count preserves TFT workflow detection after this filtering.
            _count: { select: { contributions: true } },
            assignments: { ...(reviewAll ? {} : { where: { boosterId: req.actor.id } }), select: { boosterId: true, booster: { select: { username: true } } } },
            contributions: { ...(reviewAll ? {} : { where: { boosterId: req.actor.id } }), include: { booster: { select: { username: true } } } } },
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * pageSize, take: pageSize });
    res.json({ ok: true, page, pageSize, total, totalPages, orders: rows.map(({ _count, ...order }) => ({ ...order,
        matchHistoryEnabled: usesMatchHistory({ ...order, contributions: _count.contributions ? [true] : [] }) })) });
}));
router.post('/contributions/:orderId', handle(async (req, res) => {
    if (!eligible(req.actor)) fail(403, 'Boosters only.');
    const matches = req.body.matches;
    if (!Number.isInteger(matches) || matches < 0 || matches > 10000) fail(400, 'Enter a whole match count from 0 to 10,000.');
    await db.$transaction(tx => withEarningsLedgerMutation(tx, req.params.orderId, async () => {
        const assigned = await tx.orderAssignment.findUnique({ where: { orderId_boosterId: { orderId: req.params.orderId, boosterId: req.actor.id } }, include: { order: { include: { contributions: { select: { boosterId: true } } } } } });
        if (!assigned || assigned.order.paymentStatus !== 'PAID' || assigned.order.status === 'CANCELLED') fail(403, 'Only your assigned paid orders accept submissions.');
        if (usesMatchHistory(assigned.order)) fail(409, 'Review individual matches in Match History for this order.');
        // Revisions invalidate approval; the admin must review the exact submitted version.
        await tx.boosterContribution.upsert({ where: { orderId_boosterId: { orderId: assigned.orderId, boosterId: req.actor.id } },
            create: { orderId: assigned.orderId, boosterId: req.actor.id, submittedMatches: matches },
            update: { submittedMatches: matches, approvedMatches: null, submittedAt: new Date(), reviewedAt: null, reviewedBy: null, reviewNote: null, revision: { increment: 1 } } });
    }));
    res.json({ ok: true });
}));
router.post('/contributions/:orderId/:boosterId/review', admin, handle(async (req, res) => {
    if (!Number.isInteger(req.body.revision) || !['approve', 'return'].includes(req.body.decision)) fail(400, 'Choose an approval decision.');
    const key = { orderId: req.params.orderId, boosterId: req.params.boosterId };
    const note = String(req.body.note || '').trim().slice(0, 500);
    if (req.body.decision === 'return' && !note) fail(400, 'Explain what needs correcting.');
    await db.$transaction(tx => withEarningsLedgerMutation(tx, req.params.orderId, async () => {
        const contribution = await tx.boosterContribution.findUnique({ where: { orderId_boosterId: key }, include: { order: { select: { matchHistoryEnabled: true } } } });
        if (!contribution) fail(404, 'Submission not found.');
        if (contribution.order?.matchHistoryEnabled) fail(409, 'Review individual matches in Match History for this order.');
        const result = await tx.boosterContribution.updateMany({ where: { ...key, revision: req.body.revision, reviewedAt: null },
            data: { approvedMatches: req.body.decision === 'approve' ? contribution.submittedMatches : null, reviewedAt: new Date(), reviewedBy: req.actor.id, reviewNote: note || null } });
        if (!result.count) fail(409, 'This submission changed. Refresh and review it again.');
    }));
    res.json({ ok: true });
}));
router.get('/me', handle(async (req, res) => {
    if (!eligible(req.actor)) fail(403, 'Boosters only.');
    const [profile, contracts, income, rating, preferences] = await Promise.all([
        db.boosterProfile.findUnique({ where: { userId: req.actor.id } }),
        db.boosterContract.findMany({ where: { boosterId: req.actor.id }, select: { id: true, title: true, startsAt: true, signedAt: true, revokedAt: true }, orderBy: { createdAt: 'desc' } }), boosterEarnings(db, req.actor.id),
        boosterRating(db, req.actor.id),
        loadPreferences(db, req.actor.id),
    ]);
    res.json({ ok: true, profile, contracts, earnings: income[req.actor.id] || {}, rating, ...preferences,
        account: { username: req.actor.username, email: req.actor.email, profile: req.actor.profile } });
}));
router.patch('/me/preferences', handle(async (req, res) => {
    if (!eligible(req.actor)) fail(403, 'Boosters only.');
    const data = validatePreferences(req.body);
    try {
        const preferences = await db.boosterPreferences.upsert({
            where: { userId: req.actor.id }, create: { userId: req.actor.id, ...data }, update: data, select: preferenceSelect,
        });
        res.json({ ok: true, preferences, preferencesAvailable: true });
    } catch (error) {
        if (missingPreferencesTable(error)) fail(503, 'Champion preferences are not available yet. Please try again later.');
        throw error;
    }
}));
router.get('/boosters', admin, handle(async (req, res) => {
    const [users, income] = await Promise.all([
        db.user.findMany({ where: { OR: [{ role: 'PROVIDER' }, { hasBoosterAccess: true }] }, select: { ...identity,
            boosterProfile: true, boosterContracts: { orderBy: { createdAt: 'desc' }, select: { id: true, title: true, startsAt: true, createdAt: true, signedAt: true, signedName: true, revokedAt: true } },
            providedAssignments: { where: { order: { paymentStatus: 'PAID', status: { in: ['PENDING', 'IN_PROGRESS'] } } }, select: { id: true } },
        }, orderBy: { username: 'asc' } }), boosterEarnings(db),
    ]);
    const { preferencesByUser, preferencesAvailable } = await loadPreferencesForUsers(db, users.map(user => user.id));
    res.json({ ok: true, preferencesAvailable, boosters: users.map(user => ({ ...user,
        preferences: preferencesByUser.get(user.id), earnings: income[user.id] || {} })) });
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
