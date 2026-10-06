const router = require('express').Router();
const db = require('../prisma');
const riot = require('../utils/riotMatches');
const { orderEarnings, estimateMatchEarnings } = require('../utils/earnings');
const handle = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const orderSelect = { id: true, orderNumber: true, customerId: true, boostType: true, inGameName: true, region: true,
    createdAt: true, paidAt: true, paymentStatus: true, status: true, amountCents: true, goldDiscountCents: true, currency: true,
    matchHistoryEnabled: true, matchHistoryRevision: true, matchHistoryConfirmedAt: true, matchHistorySyncedAt: true,
    assignments: { select: { boosterId: true } }, contributions: { select: { boosterId: true } } };
const isAdmin = actor => actor.role === 'ADMIN';
const assigned = (order, actor) => (actor.role === 'PROVIDER' || Boolean(actor.hasBoosterAccess)) && order.assignments.some(a => a.boosterId === actor.id);
async function loadOrder(client, id, actor) {
    const order = await client.order.findUnique({ where: { id }, select: orderSelect });
    if (!order || !(isAdmin(actor) || order.customerId === actor.id || assigned(order, actor))) fail(404, 'Order not found.');
    return order;
}
function writable(order) {
    if (!order.matchHistoryEnabled) fail(409, 'This historical order uses its original contribution review.');
    if (order.paymentStatus !== 'PAID' || order.status === 'CANCELLED') fail(409, 'Only paid, active or completed orders accept match reviews.');
    if (order.matchHistoryConfirmedAt) fail(409, 'Reopen the history before changing confirmed matches.');
}
async function locked(id, actor, fn) {
    return db.$transaction(async tx => {
        await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${id} FOR UPDATE`;
        const order = await loadOrder(tx, id, actor);
        return fn(tx, order);
    });
}
async function invalidate(tx, id) {
    await tx.order.update({ where: { id }, data: { matchHistoryRevision: { increment: 1 }, matchHistoryConfirmedAt: null, matchHistoryConfirmedBy: null } });
}
const adminOnly = actor => { if (!isAdmin(actor)) fail(403, 'Admins only.'); };

router.get('/match-history/:orderId', handle(async (req, res) => {
    const order = await loadOrder(db, req.params.orderId, req.actor);
    const admin = isAdmin(req.actor);
    const provider = assigned(order, req.actor);
    // Customer history contains submitted work, never the account's unrelated games.
    const customer = !admin && !provider;
    const matches = await db.orderMatch.findMany({ where: { orderId: order.id,
        ...(customer ? { boosterId: { not: null }, status: { in: ['PENDING', 'APPROVED'] } } : {}) }, orderBy: [{ playedAt: 'desc' }, { id: 'desc' }],
        select: { id: true, externalId: true, playedAt: true, details: true, status: true, revision: true, boosterId: true,
            booster: { select: { username: true } }, ...(admin ? { reviews: { orderBy: { createdAt: 'desc' }, take: 1, select: { note: true, createdAt: true } } } : {}) } });
    const boosters = admin ? await db.user.findMany({ where: { suspendedAt: null, OR: [{ role: 'PROVIDER' }, { hasBoosterAccess: true }] }, select: { id: true, username: true }, orderBy: { username: 'asc' } }) : [];
    let importIssue = '';
    try { riot.importSettings(order); } catch (e) { importIssue = e.message; }
    const mutable = order.matchHistoryEnabled && order.paymentStatus === 'PAID' && order.status !== 'CANCELLED' && !order.matchHistoryConfirmedAt;
    const amounts = orderEarnings({ ...order, matches });
    const estimate = estimateMatchEarnings({ ...order, matches });
    const ownShare = estimate?.shares.find(s => s.boosterId === req.actor.id);
    const paidShare = amounts?.shares.find(s => s.boosterId === req.actor.id);
    res.json({ ok: true, matches, boosters, canReview: admin && mutable,
        canSubmit: provider && mutable, customerView: customer,
        submission: provider ? { matches: ownShare?.matches || 0, estimatedCents: ownShare?.cents ?? 0,
            confirmedCents: paidShare?.cents ?? null, currency: order.currency } : undefined,
        canImport: (admin || assigned(order, req.actor)) && mutable && !importIssue && riot.configured(),
        importIssue: admin || assigned(order, req.actor) ? importIssue || (!riot.configured() ? 'Riot imports are not configured on the server.' : '') : '',
        order: { id: order.id, revision: order.matchHistoryRevision, confirmedAt: order.matchHistoryConfirmedAt,
            syncedAt: order.matchHistorySyncedAt, enabled: order.matchHistoryEnabled, status: order.status },
        canConfirm: admin && mutable && order.status === 'COMPLETED', canReopen: admin && Boolean(order.matchHistoryConfirmedAt),
        earnings: admin && amounts ? { ...amounts, estimates: estimate?.shares || [], currency: order.currency } : undefined,
    });
}));

function selectedMatches(body) {
    const selections = body.matches;
    if (!Array.isArray(selections) || !selections.length || selections.length > 1000 ||
        selections.some(m => !m || typeof m.id !== 'string' || !Number.isInteger(m.revision) || m.revision < 1) ||
        new Set(selections.map(m => m.id)).size !== selections.length) fail(400, 'Select between 1 and 1,000 different matches.');
    return selections.map(({ id, revision }) => ({ id, revision }));
}
router.get('/match-history/:orderId/:matchId/player-details', handle(async (req, res) => {
    const order = await loadOrder(db, req.params.orderId, req.actor);
    const customer = !isAdmin(req.actor) && !assigned(order, req.actor);
    const match = await db.orderMatch.findFirst({ where: { id: req.params.matchId, orderId: order.id,
        ...(customer ? { boosterId: { not: null }, status: { in: ['PENDING', 'APPROVED'] } } : {}) }, select: { externalId: true, details: true } });
    if (!match) fail(404, 'Match not found.');
    res.json({ ok: true, ...await riot.matchPlayerDetails(match) });
}));
async function submissionPreview(tx, order, actor, selections) {
    if (!assigned(order, actor)) fail(403, 'Only a currently assigned booster can submit their matches.');
    writable(order);
    const matches = await tx.orderMatch.findMany({ where: { orderId: order.id }, select: { id: true, revision: true, status: true, boosterId: true } });
    const selected = new Map(selections.map(m => [m.id, m.revision]));
    for (const selection of selections) {
        const match = matches.find(m => m.id === selection.id);
        if (!match || match.revision !== selection.revision || match.status !== 'PENDING' || match.boosterId) {
            fail(409, 'A selected match changed or has already been submitted. Refresh and select again.');
        }
    }
    const estimate = estimateMatchEarnings({ ...order, matches: matches.map(m => selected.has(m.id) ? { ...m, boosterId: actor.id } : m) });
    if (!estimate) fail(409, 'This order needs a service amount before matches can be submitted.');
    const share = estimate.shares.find(s => s.boosterId === actor.id);
    return { revision: order.matchHistoryRevision, selectedCount: selections.length, totalMatches: share.matches,
        estimatedCents: share.cents, currency: order.currency };
}
router.post('/match-history/:orderId/submission-preview', handle(async (req, res) => {
    const selections = selectedMatches(req.body);
    const preview = await locked(req.params.orderId, req.actor, (tx, order) => submissionPreview(tx, order, req.actor, selections));
    res.json({ ok: true, ...preview });
}));
router.post('/match-history/:orderId/submit', handle(async (req, res) => {
    const selections = selectedMatches(req.body);
    await locked(req.params.orderId, req.actor, async (tx, order) => {
        const preview = await submissionPreview(tx, order, req.actor, selections);
        if (req.body.revision !== preview.revision || req.body.estimatedCents !== preview.estimatedCents) {
            fail(409, 'The match count or earnings estimate changed. Review a new confirmation before submitting.');
        }
        const changed = await tx.orderMatch.updateMany({ where: { orderId: order.id, OR: selections,
            status: 'PENDING', boosterId: null }, data: { boosterId: req.actor.id, revision: { increment: 1 } } });
        if (changed.count !== selections.length) fail(409, 'A selected match changed. Refresh and select again.');
        await tx.orderMatchReview.createMany({ data: selections.map(match => ({ matchId: match.id, reviewerId: req.actor.id,
            revision: match.revision + 1, decision: 'SUBMITTED', boosterId: req.actor.id })) });
        await invalidate(tx, order.id);
    });
    res.json({ ok: true, submitted: selections.length, boosterId: req.actor.id });
}));

router.post('/match-history/:orderId/import', handle(async (req, res) => {
    const start = req.body.start ?? 0;
    if (!Number.isInteger(start) || start < 0 || start > 10000) fail(400, 'Invalid match page.');
    const order = await locked(req.params.orderId, req.actor, async (tx, order) => {
        if (!isAdmin(req.actor) && !assigned(order, req.actor)) fail(403, 'Only admins and the assigned booster can import matches.');
        writable(order); riot.importSettings(order);
        if (!riot.configured()) fail(503, 'Riot imports are not configured on the server.');
        if (order.matchHistorySyncedAt && Date.now() - order.matchHistorySyncedAt.getTime() < 60000) fail(429, 'Please wait one minute between imports.');
        await tx.order.update({ where: { id: order.id }, data: { matchHistorySyncedAt: new Date() } });
        return order;
    });
    const result = await riot.importMatches(order, start);
    const count = await locked(order.id, req.actor, async (tx, current) => {
        if (!isAdmin(req.actor) && !assigned(current, req.actor)) fail(403, 'Your assignment changed. Ask an admin to import these matches.');
        writable(current);
        if (current.inGameName !== order.inGameName || current.region !== order.region) fail(409, 'The saved game account changed. Import again.');
        // One order tracks one game account. App-scoped Riot identifiers can change
        // with the API key, but that must not turn the same game into new evidence.
        const existing = await tx.orderMatch.findMany({ where: { orderId: order.id }, select: { id: true, game: true, externalId: true, details: true } });
        // Add newly supported match details without changing the evidence used in review.
        for (const match of result.matches) {
            const saved = existing.find(m => m.game === match.game && m.externalId === match.externalId);
            if (!saved?.details?.players || !match.details?.players) continue;
            const players = saved.details.players.map(player => {
                const fresh = match.details.players.find(p => p.name === player.name && p.tag === player.tag && p.team === player.team && p.championId === player.championId);
                return fresh ? { ...player, summonerSpells: fresh.summonerSpells, runes: fresh.runes,
                    damageTaken: player.damageTaken ?? fresh.damageTaken } : player;
            });
            const details = { ...saved.details, players };
            if (!saved.details.teams?.length && match.details.teams?.length) details.teams = match.details.teams;
            if (JSON.stringify(details) !== JSON.stringify(saved.details)) {
                await tx.orderMatch.update({ where: { id: saved.id }, data: { details } });
            }
        }
        const seen = new Set(existing.map(match => `${match.game}:${match.externalId}`));
        const additions = result.matches.filter(match => {
            const key = `${match.game}:${match.externalId}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
        const inserted = additions.length ? await tx.orderMatch.createMany({ data: additions.map(match => ({ ...match, orderId: order.id })), skipDuplicates: true }) : { count: 0 };
        if (inserted.count) await invalidate(tx, order.id);
        return inserted.count;
    });
    res.json({ ok: true, imported: count, nextStart: result.nextStart });
}));

router.post('/match-history/:orderId/:matchId/review', handle(async (req, res) => {
    adminOnly(req.actor);
    const { decision, revision, boosterId } = req.body;
    const note = String(req.body.note || '').trim().slice(0, 500);
    if (!['APPROVED', 'REJECTED', 'PENDING'].includes(decision) || !Number.isInteger(revision)) fail(400, 'Choose a valid match decision.');
    if (decision === 'REJECTED' && !note) fail(400, 'Add a reason for excluding this match.');
    await locked(req.params.orderId, req.actor, async (tx, order) => {
        writable(order);
        if (decision === 'APPROVED') {
            if (typeof boosterId !== 'string') fail(400, 'Choose the booster who played this match.');
            const booster = await tx.user.findUnique({ where: { id: boosterId }, select: { role: true, hasBoosterAccess: true, suspendedAt: true } });
            if (!booster || booster.suspendedAt || !(booster.role === 'PROVIDER' || booster.hasBoosterAccess)) fail(400, 'Choose an active booster.');
        }
        const changed = await tx.orderMatch.updateMany({ where: { id: req.params.matchId, orderId: order.id, revision },
            data: { status: decision, boosterId: decision === 'APPROVED' ? boosterId : null, revision: { increment: 1 } } })
            .catch(error => { if (error.code === 'P2002') fail(409, 'This match is already approved on another order.'); throw error; });
        if (!changed.count) fail(409, 'This match changed. Refresh before reviewing it.');
        await tx.orderMatchReview.create({ data: { matchId: req.params.matchId, reviewerId: req.actor.id, revision: revision + 1, decision, boosterId: decision === 'APPROVED' ? boosterId : null, note: note || null } });
        await invalidate(tx, order.id);
    });
    res.json({ ok: true });
}));

router.post('/match-history/:orderId/confirm', handle(async (req, res) => {
    adminOnly(req.actor);
    await locked(req.params.orderId, req.actor, async (tx, order) => {
        writable(order);
        if (req.body.revision !== order.matchHistoryRevision) fail(409, 'History changed. Refresh before confirming.');
        if (order.status !== 'COMPLETED') fail(409, 'Complete the order before confirming earnings.');
        const matches = await tx.orderMatch.findMany({ where: { orderId: order.id }, select: { status: true, boosterId: true } });
        if (!matches.some(m => m.status === 'APPROVED') || matches.some(m => m.status === 'PENDING' && m.boosterId)) fail(409, 'Review every submitted match and approve at least one before confirming.');
        await tx.order.update({ where: { id: order.id }, data: { matchHistoryConfirmedAt: new Date(), matchHistoryConfirmedBy: req.actor.id, matchHistoryRevision: { increment: 1 } } });
    });
    res.json({ ok: true });
}));
router.post('/match-history/:orderId/reopen', handle(async (req, res) => {
    adminOnly(req.actor);
    await locked(req.params.orderId, req.actor, async (tx, order) => {
        if (!order.matchHistoryEnabled || !order.matchHistoryConfirmedAt || req.body.revision !== order.matchHistoryRevision) fail(409, 'History changed. Refresh before reopening.');
        await invalidate(tx, order.id);
    });
    res.json({ ok: true });
}));
module.exports = router;
