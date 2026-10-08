const router = require('express').Router();
const db = require('../prisma');
const riot = require('../utils/riotMatches');
const { orderEarnings, estimateMatchEarnings } = require('../utils/earnings');
const { matchScope, matchesOrder, usesMatchHistory } = require('../utils/orderMatchScope');
const handle = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const orderSelect = { id: true, orderNumber: true, customerId: true, boostType: true, queueType: true, inGameName: true, region: true,
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
    if (!usesMatchHistory(order)) fail(409, 'This historical order uses its original contribution review.');
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
    const records = await db.orderMatch.findMany({ where: { orderId: order.id,
        ...(customer ? { boosterId: { not: null }, status: { in: ['PENDING', 'APPROVED'] } } : {}) }, orderBy: [{ playedAt: 'desc' }, { id: 'desc' }],
        select: { id: true, game: true, externalId: true, playedAt: true, details: true, status: true, revision: true, boosterId: true,
            booster: { select: { username: true } }, ...(admin ? { reviews: { orderBy: { createdAt: 'desc' }, take: 1, select: { note: true, createdAt: true } } } : {}) } });
    const matches = records.filter(match => matchesOrder(order, match));
    const boosters = admin ? await db.user.findMany({ where: { suspendedAt: null, OR: [{ role: 'PROVIDER' }, { hasBoosterAccess: true }] }, select: { id: true, username: true }, orderBy: { username: 'asc' } }) : [];
    let importIssue = '';
    try { riot.importSettings(order); } catch (e) { importIssue = e.message; }
    const mutable = usesMatchHistory(order) && order.paymentStatus === 'PAID' && order.status !== 'CANCELLED' && !order.matchHistoryConfirmedAt;
    const amounts = orderEarnings({ ...order, matches });
    const estimate = estimateMatchEarnings({ ...order, matches });
    const ownShare = estimate?.shares.find(s => s.boosterId === req.actor.id);
    const paidShare = amounts?.shares.find(s => s.boosterId === req.actor.id);
    res.json({ ok: true, matches, boosters, scope: matchScope(order), canReview: admin && mutable,
        canSubmit: provider && mutable, customerView: customer,
        submission: provider ? { boosterId: req.actor.id, matches: ownShare?.matches || 0, estimatedCents: ownShare?.cents ?? 0,
            confirmedCents: paidShare?.cents ?? null, currency: order.currency } : undefined,
        canImport: (admin || assigned(order, req.actor)) && mutable && !importIssue && riot.configured(matchScope(order)?.game),
        importIssue: admin || assigned(order, req.actor) ? importIssue || (!riot.configured(matchScope(order)?.game) ? 'Riot imports are not configured on the server.' : '') : '',
        order: { id: order.id, revision: order.matchHistoryRevision, confirmedAt: order.matchHistoryConfirmedAt,
            syncedAt: order.matchHistorySyncedAt, enabled: usesMatchHistory(order), status: order.status },
        canConfirm: admin && mutable && order.status === 'COMPLETED', canReopen: admin && Boolean(order.matchHistoryConfirmedAt),
        earnings: admin && amounts ? { ...amounts, estimates: estimate?.shares || [], currency: order.currency } : undefined,
    });
}));

function selectedMatches(body) {
    const selections = body.matches;
    if (body.mode !== undefined && !['add', 'edit'].includes(body.mode)) fail(400, 'Choose a valid submission mode.');
    if (!Array.isArray(selections) || (!selections.length && body.mode !== 'edit') || selections.length > 1000 ||
        selections.some(m => !m || typeof m.id !== 'string' || !Number.isInteger(m.revision) || m.revision < 1) ||
        new Set(selections.map(m => m.id)).size !== selections.length) fail(400, 'Select up to 1,000 different matches, or clear an existing submission.');
    return selections.map(({ id, revision }) => ({ id, revision }));
}
router.get('/match-history/:orderId/:matchId/player-details', handle(async (req, res) => {
    const order = await loadOrder(db, req.params.orderId, req.actor);
    const customer = !isAdmin(req.actor) && !assigned(order, req.actor);
    const match = await db.orderMatch.findFirst({ where: { id: req.params.matchId, orderId: order.id,
        ...(customer ? { boosterId: { not: null }, status: { in: ['PENDING', 'APPROVED'] } } : {}) }, select: { game: true, externalId: true, details: true } });
    if (!match || !matchesOrder(order, match)) fail(404, 'Match not found.');
    if (match.game === 'TFT') return res.json({ ok: true, ranks: [] });
    res.json({ ok: true, ...await riot.matchPlayerDetails(match) });
}));
async function submissionPreview(tx, order, actor, selections, body) {
    if (!assigned(order, actor)) fail(403, 'Only a currently assigned booster can submit their matches.');
    writable(order);
    const editing = body.mode === 'edit';
    // Replacing a selection must start from the history the booster actually saw.
    if (editing && body.revision !== order.matchHistoryRevision) fail(409, 'History changed. Refresh before editing your submission.');
    const records = await tx.orderMatch.findMany({ where: { orderId: order.id }, select: { id: true, game: true, details: true, revision: true, status: true, boosterId: true } });
    const matches = records.filter(match => matchesOrder(order, match));
    const selected = new Map(selections.map(m => [m.id, m.revision]));
    for (const selection of selections) {
        const match = matches.find(m => m.id === selection.id);
        if (!match || match.revision !== selection.revision || match.status !== 'PENDING' ||
            (match.boosterId && !(editing && match.boosterId === actor.id))) {
            fail(409, 'A selected match changed or has already been submitted. Refresh and select again.');
        }
    }
    const additions = matches.filter(m => selected.has(m.id) && !m.boosterId);
    const withdrawals = editing ? matches.filter(m => m.status === 'PENDING' && m.boosterId === actor.id && !selected.has(m.id)) : [];
    if (!additions.length && !withdrawals.length) fail(400, 'Change your match selection before saving.');
    const withdrawn = new Set(withdrawals.map(m => m.id));
    const estimate = estimateMatchEarnings({ ...order, matches: matches.map(m => selected.has(m.id) ? { ...m, boosterId: actor.id } : withdrawn.has(m.id) ? { ...m, boosterId: null } : m) });
    if (!estimate) fail(409, 'This order needs a service amount before matches can be submitted.');
    const share = estimate.shares.find(s => s.boosterId === actor.id);
    return { additions, withdrawals, quote: { mode: editing ? 'edit' : 'add', revision: order.matchHistoryRevision,
        selectedCount: selections.length, addedCount: additions.length, removedCount: withdrawals.length,
        totalMatches: share?.matches || 0, estimatedCents: share?.cents || 0, currency: order.currency } };
}
router.post('/match-history/:orderId/submission-preview', handle(async (req, res) => {
    const selections = selectedMatches(req.body);
    const { quote } = await locked(req.params.orderId, req.actor, (tx, order) => submissionPreview(tx, order, req.actor, selections, req.body));
    res.json({ ok: true, ...quote });
}));
router.post('/match-history/:orderId/submit', handle(async (req, res) => {
    const selections = selectedMatches(req.body);
    const result = await locked(req.params.orderId, req.actor, async (tx, order) => {
        const { quote: preview, additions, withdrawals } = await submissionPreview(tx, order, req.actor, selections, req.body);
        if (req.body.revision !== preview.revision || req.body.estimatedCents !== preview.estimatedCents) {
            fail(409, 'The match count or earnings estimate changed. Review a new confirmation before submitting.');
        }
        for (const [records, withdrawing] of [[additions, false], [withdrawals, true]]) {
            if (!records.length) continue;
            const changed = await tx.orderMatch.updateMany({ where: { orderId: order.id,
                OR: records.map(({ id, revision }) => ({ id, revision })), status: 'PENDING', boosterId: withdrawing ? req.actor.id : null },
                data: { boosterId: withdrawing ? null : req.actor.id, revision: { increment: 1 } } });
            if (changed.count !== records.length) fail(409, 'A selected match changed. Refresh and select again.');
            await tx.orderMatchReview.createMany({ data: records.map(match => ({ matchId: match.id, reviewerId: req.actor.id,
                revision: match.revision + 1, decision: withdrawing ? 'WITHDRAWN' : 'SUBMITTED', boosterId: req.actor.id })) });
        }
        await invalidate(tx, order.id);
        return { ...preview, revision: preview.revision + 1, addedIds: additions.map(m => m.id), removedIds: withdrawals.map(m => m.id) };
    });
    res.json({ ok: true, ...result, submitted: selections.length, boosterId: req.actor.id });
}));

router.post('/match-history/:orderId/import', handle(async (req, res) => {
    const start = req.body.start ?? 0;
    if (!Number.isInteger(start) || start < 0 || start > 10000) fail(400, 'Invalid match page.');
    const order = await locked(req.params.orderId, req.actor, async (tx, order) => {
        if (!isAdmin(req.actor) && !assigned(order, req.actor)) fail(403, 'Only admins and the assigned booster can import matches.');
        writable(order); riot.importSettings(order);
        if (!riot.configured(matchScope(order)?.game)) fail(503, 'Riot imports are not configured on the server.');
        if (order.matchHistorySyncedAt && Date.now() - order.matchHistorySyncedAt.getTime() < 60000) fail(429, 'Please wait one minute between imports.');
        await tx.order.update({ where: { id: order.id }, data: { matchHistorySyncedAt: new Date() } });
        return order;
    });
    const result = await riot.importMatches(order, start);
    const count = await locked(order.id, req.actor, async (tx, current) => {
        if (!isAdmin(req.actor) && !assigned(current, req.actor)) fail(403, 'Your assignment changed. Ask an admin to import these matches.');
        writable(current);
        if (current.inGameName !== order.inGameName || current.region !== order.region || current.boostType !== order.boostType || current.queueType !== order.queueType) fail(409, 'The saved account, service or queue changed. Import again.');
        // One order tracks one game account. App-scoped Riot identifiers can change
        // with the API key, but that must not turn the same game into new evidence.
        const existing = await tx.orderMatch.findMany({ where: { orderId: order.id }, select: { id: true, game: true, externalId: true, details: true } });
        // Add newly supported match details without changing the evidence used in review.
        for (const match of result.matches) {
            if (match.game !== 'LOL' || !matchesOrder(current, match)) continue;
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
            if (!matchesOrder(current, match)) return false;
            const key = `${match.game}:${match.externalId}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
        const inserted = additions.length ? await tx.orderMatch.createMany({ data: additions.map(match => ({ ...match, orderId: order.id })), skipDuplicates: true }) : { count: 0 };
        if (!current.matchHistoryEnabled) await tx.order.update({ where: { id: order.id }, data: { matchHistoryEnabled: true } });
        if (inserted.count || !current.matchHistoryEnabled) await invalidate(tx, order.id);
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
            const match = await tx.orderMatch.findFirst({ where: { id: req.params.matchId, orderId: order.id }, select: { game: true, details: true } });
            if (!match || !matchesOrder(order, match)) fail(409, 'This match does not belong to the order’s game and ranked queue.');
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
        const records = await tx.orderMatch.findMany({ where: { orderId: order.id }, select: { game: true, details: true, status: true, boosterId: true } });
        const matches = records.filter(match => matchesOrder(order, match));
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
