const { orderEarnings } = require('./earnings');
const { earningsMonth } = require('./monthlyEarningsPeriod');

const enabled = () => process.env.BOOSTER_MONTHLY_EARNINGS_ENABLED === 'true';
const unavailable = () => Object.assign(new Error('Monthly earnings are not available yet. Please try again later.'), { status: 503, available: false });
const orderSelect = {
    id: true, orderNumber: true, boostType: true, queueType: true, status: true, paymentStatus: true,
    amountCents: true, goldDiscountCents: true, currency: true, matchHistoryEnabled: true, matchHistoryConfirmedAt: true,
    service: { select: { title: true } }, assignments: { select: { boosterId: true } },
    contributions: { select: { boosterId: true, submittedMatches: true, approvedMatches: true } },
    matches: { select: { game: true, details: true, status: true, boosterId: true } },
};

function allocations(order) {
    if (!order || order.status !== 'COMPLETED' || order.paymentStatus !== 'PAID') return [];
    const currency = String(order.currency || 'UNKNOWN').toUpperCase();
    return (orderEarnings(order)?.shares || []).map(share => ({ boosterId: share.boosterId, currency, amountCents: share.cents }));
}

const balanceKey = value => `${value.boosterId}\0${value.currency}`;

// Callers must take this global lock before any order/user row lock. Activation
// uses the same barrier, so no earnings-changing transaction can cross baseline.
async function ledgerLock(tx) {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(746381923)::text`;
}

async function withEarningsLedgerRead(prisma, read, { now } = {}) {
    if (!enabled()) throw unavailable();
    return prisma.$transaction(async tx => {
        await ledgerLock(tx);
        // Sample the period after earlier recognition transactions have committed.
        // A month-end report cannot miss an entry still committing at midnight.
        return read(tx, now || new Date());
    }, { maxWait: 30000, timeout: 30000 });
}

async function withEarningsLedgerMutation(tx, orderId, mutation, { clock = () => new Date() } = {}) {
    if (!enabled()) return mutation();
    await ledgerLock(tx);
    const state = await tx.boosterEarningsLedgerState.findUnique({ where: { id: 'global' } });
    const result = await mutation();
    if (state) await recognizeOrderEarnings(tx, orderId, clock());
    return result;
}

async function recognizeOrderEarnings(tx, orderId, recognizedAt) {
    const order = await tx.order.findUnique({ where: { id: orderId }, select: orderSelect });
    const previous = await tx.boosterEarningsBalance.findMany({ where: { orderId } });
    const before = new Map(previous.map(balance => [balanceKey(balance), balance]));
    const after = new Map(allocations(order).map(balance => [balanceKey(balance), balance]));
    const keys = new Set([...before.keys(), ...after.keys()]);
    const changes = [...keys].map(key => {
        const old = before.get(key), current = after.get(key);
        return { ...(current || old), amountCents: current?.amountCents || 0, delta: (current?.amountCents || 0) - (old?.amountCents || 0) };
    }).filter(change => change.delta !== 0);
    if (!changes.length) return;
    // Snapshot labels survive removal of an order; no ledger row is cascaded or rewritten.
    const previousLabel = !order ? await tx.boosterEarningsEntry.findFirst({ where: { orderId }, orderBy: [{ recognizedAt: 'desc' }, { id: 'desc' }], select: { orderNumber: true, serviceTitle: true } }) : null;
    const orderNumber = order?.orderNumber || previousLabel?.orderNumber || orderId;
    const serviceTitle = order?.boostType || order?.service?.title || previousLabel?.serviceTitle || 'FastBoost order';
    for (const change of changes) {
        await tx.boosterEarningsEntry.create({ data: {
            orderId, boosterId: change.boosterId, orderNumber, serviceTitle, currency: change.currency,
            amountCents: change.delta, recognizedAt, period: earningsMonth(recognizedAt),
            kind: previous.length ? 'ADJUSTMENT' : 'EARNED',
        } });
        const key = { orderId, boosterId: change.boosterId, currency: change.currency };
        await tx.boosterEarningsBalance.upsert({ where: { orderId_boosterId_currency: key },
            create: { ...key, amountCents: change.amountCents }, update: { amountCents: change.amountCents } });
    }
}

// Explicit rollout operation, never called by a read endpoint or timer. Existing
// confirmed earnings have no reliable historical completion date, so their
// opening balances are preserved outside every calendar month's earnings.
async function initializeEarningsLedger(prisma, { now = new Date() } = {}) {
    if (!enabled()) throw new Error('Enable BOOSTER_MONTHLY_EARNINGS_ENABLED before activating the earnings ledger.');
    return prisma.$transaction(async tx => {
        await ledgerLock(tx);
        const existing = await tx.boosterEarningsLedgerState.findUnique({ where: { id: 'global' } });
        if (existing) return { activatedAt: existing.activatedAt, alreadyActive: true };
        let after;
        let openingEntries = 0;
        for (;;) {
            const orders = await tx.order.findMany({ where: { status: 'COMPLETED', paymentStatus: 'PAID', ...(after ? { id: { gt: after } } : {}) }, select: orderSelect, orderBy: { id: 'asc' }, take: 100 });
            for (const order of orders) for (const balance of allocations(order)) {
                if (!balance.amountCents) continue;
                const key = { orderId: order.id, boosterId: balance.boosterId, currency: balance.currency };
                await tx.boosterEarningsBalance.create({ data: { ...key, amountCents: balance.amountCents } });
                await tx.boosterEarningsEntry.create({ data: { ...key, orderNumber: order.orderNumber || order.id,
                    serviceTitle: order.boostType || order.service?.title || 'FastBoost order', amountCents: balance.amountCents,
                    recognizedAt: now, period: null, kind: 'OPENING' } });
                openingEntries++;
            }
            if (orders.length < 100) break;
            after = orders[orders.length - 1].id;
        }
        const state = await tx.boosterEarningsLedgerState.create({ data: { id: 'global', activatedAt: now } });
        return { activatedAt: state.activatedAt, alreadyActive: false, openingEntries };
    }, { maxWait: 30000, timeout: 120000 });
}

module.exports = { withEarningsLedgerMutation, withEarningsLedgerRead, initializeEarningsLedger, enabled, unavailable, orderSelect };
