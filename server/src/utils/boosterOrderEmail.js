const { randomUUID } = require('node:crypto');
const { validEmail, createConfirmationTransport } = require('./orderConfirmationEmail');
const { checkoutSummary } = require('./checkoutSummary');
const { renderBoosterOrderEmail } = require('./boosterOrderEmailTemplate');

const enabled = () => process.env.BOOSTER_ORDER_EMAILS_ENABLED === 'true';
const eligibleBooster = user => user && !user.suspendedAt && (user.role === 'PROVIDER' || user.hasBoosterAccess === true);
const eventCopy = Object.freeze({
    ASSIGNED: { badge: 'NEW ASSIGNMENT', subject: 'New order assigned', title: 'You have a new order', text: 'An order has been assigned to you. Open the order to review its details and coordinate with the customer and our team.', action: 'Open order' },
    UNASSIGNED: { badge: 'ASSIGNMENT UPDATED', subject: 'Order unassigned', title: 'Your assignment has ended', text: 'You are no longer assigned to this order. No further work is required from you. You can view your current assignments in the Booster Portal.', action: 'View assigned orders' },
    COMPLETED: { badge: 'ORDER COMPLETED', subject: 'Assigned order completed', title: 'Your assigned order is complete', text: 'This order has been marked complete. You can review its match history and check your contribution status in the Booster Portal.', action: 'View order' },
    CANCELLED: { badge: 'ORDER CANCELLED', subject: 'Assigned order cancelled', title: 'Your assigned order was cancelled', text: 'This order has been cancelled. Please stop work on it. Open the order to review the update or contact our team.', action: 'View order' },
    PAYMENT_CONFIRMED: { badge: 'PAYMENT CONFIRMED', subject: 'Assigned order payment confirmed', title: 'Payment has been confirmed', text: 'Payment has been confirmed for an order assigned to you. Open the order to review its details and continue coordinating with our team.', action: 'Open order' },
});
const orderSelect = {
    id: true, orderNumber: true, status: true, paymentStatus: true, boostType: true,
    currentRank: true, currentDivision: true, desiredRank: true, desiredDivision: true,
    peakRank: true, placementGames: true, desiredWins: true, numberOfGames: true, queueType: true, region: true,
    service: { select: { title: true } },
    assignments: { select: { boosterId: true, booster: { select: { id: true, role: true, hasBoosterAccess: true, suspendedAt: true } } } },
};
const assignmentsById = order => new Map((order?.assignments || []).map(assignment => [assignment.boosterId, assignment.booster]));

function buildBoosterOrderEmail(order, event) {
    if (!Object.hasOwn(eventCopy, event)) throw new Error('Unknown booster order email event');
    const origin = new URL(process.env.CLIENT_URL);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname);
    if (origin.protocol !== 'https:' && !(local && origin.protocol === 'http:' && process.env.NODE_ENV !== 'production')) throw new Error('CLIENT_URL must use HTTPS');
    if (local && process.env.NODE_ENV === 'production') throw new Error('Production email links cannot use localhost');
    const copy = eventCopy[event];
    const portalUrl = new URL('/provider/portal', origin.origin).href;
    const url = event === 'UNASSIGNED' ? portalUrl : new URL(`/match/${encodeURIComponent(order.id)}`, origin.origin).href;
    const summary = checkoutSummary(order);
    // Keep account credentials, customer identity, chat and payment identifiers
    // out of email. The signed-in workspace remains the source of order access.
    const rows = [['Order', `#${order.orderNumber}`], ['Game', summary.game === 'tft' ? 'Teamfight Tactics' : 'League of Legends'], ['Service', summary.serviceType],
        ...(event === 'UNASSIGNED' ? [] : summary.details)];
    const subject = `FastBoost · ${copy.subject} #${order.orderNumber}`;
    return { subject,
        text: [subject, '', copy.text, '', ...rows.map(([label, value]) => `${label}: ${value}`), '', `${copy.action}: ${url}`, '', `Booster Portal: ${portalUrl}`].join('\n'),
        html: renderBoosterOrderEmail({ copy, orderNumber: order.orderNumber, rows, url, portalUrl }),
    };
}

function boosterOrderEvents(before, after) {
    if (!after) return [];
    const previous = assignmentsById(before);
    const current = assignmentsById(after);
    const events = [];
    const add = (boosterId, booster, event) => { if (eligibleBooster(booster)) events.push({ boosterId, event }); };
    for (const [id, booster] of current) if (!previous.has(id)) add(id, booster, 'ASSIGNED');
    for (const [id, booster] of previous) if (!current.has(id)) add(id, booster, 'UNASSIGNED');
    if (after.status === 'COMPLETED' && before?.status !== 'COMPLETED' && after.paymentStatus === 'PAID') {
        for (const [id, booster] of current) add(id, booster, 'COMPLETED');
    }
    if (after.status === 'CANCELLED' && before?.status !== 'CANCELLED') {
        for (const [id, booster] of current) add(id, booster, 'CANCELLED');
    }
    if (after.paymentStatus === 'PAID' && before?.paymentStatus !== 'PAID') {
        // Newly assigned boosters receive their assignment email; a payment
        // update is for people already working on this order, never the team.
        for (const [id, booster] of current) if (previous.has(id)) add(id, booster, 'PAYMENT_CONFIRMED');
    }
    return events;
}

const activeMutations = new WeakMap();
// The caller must hold its per-order/checkout lock before entering this wrapper.
// Both snapshots and the outbox writes belong to the same committing transaction.
async function withBoosterOrderEmails(tx, orderId, mutation) {
    if (!enabled()) return mutation();
    let active = activeMutations.get(tx);
    if (active?.has(orderId)) return mutation();
    if (!active) { active = new Set(); activeMutations.set(tx, active); }
    active.add(orderId);
    try {
        const before = await tx.order.findUnique({ where: { id: orderId }, select: orderSelect });
        const result = await mutation();
        const after = await tx.order.findUnique({ where: { id: orderId }, select: orderSelect });
        const events = boosterOrderEvents(before, after);
        // If an order is unassigned and reassigned before delivery, an older
        // assignment alert must not become relevant again and send twice.
        for (const { boosterId, event } of events) await tx.boosterOrderEmail.updateMany({
            where: { orderId, boosterId, event, sentAt: null, skippedAt: null },
            data: { skippedAt: new Date(), claim: null, lastError: 'EVENT_SUPERSEDED' },
        });
        if (events.length) await tx.boosterOrderEmail.createMany({ data: events.map(({ boosterId, event }) => ({
            id: randomUUID(), orderId, boosterId, event, payload: buildBoosterOrderEmail(after, event),
        })) });
        return result;
    } finally {
        active.delete(orderId);
        if (!active.size) activeMutations.delete(tx);
    }
}

function stillRelevant(row) {
    if (!eligibleBooster(row.booster) || !row.order) return false;
    const assigned = row.order.assignments.some(assignment => assignment.boosterId === row.boosterId);
    switch (row.event) {
        case 'ASSIGNED': return assigned && !['COMPLETED', 'CANCELLED'].includes(row.order.status);
        case 'UNASSIGNED': return !assigned;
        case 'COMPLETED': return assigned && row.order.status === 'COMPLETED' && row.order.paymentStatus === 'PAID';
        case 'CANCELLED': return assigned && row.order.status === 'CANCELLED';
        case 'PAYMENT_CONFIRMED': return assigned && row.order.paymentStatus === 'PAID' && row.order.status !== 'CANCELLED';
        default: return false;
    }
}

async function deliverPendingBoosterOrderEmails(prisma, transport, clock = () => new Date()) {
    const pending = { sentAt: null, skippedAt: null };
    const rows = await prisma.boosterOrderEmail.findMany({ where: { ...pending, attempts: { lt: 8 }, nextAttemptAt: { lte: clock() } }, orderBy: [{ nextAttemptAt: 'asc' }, { id: 'asc' }], take: 10 });
    for (const row of rows) {
        const claimedAt = clock();
        const claim = randomUUID();
        const claimed = await prisma.boosterOrderEmail.updateMany({ where: { id: row.id, ...pending, attempts: row.attempts, nextAttemptAt: { lte: claimedAt } },
            data: { claim, attempts: { increment: 1 }, nextAttemptAt: new Date(claimedAt.getTime() + 5 * 60000) } });
        if (!claimed.count) continue;
        try {
            const fresh = await prisma.boosterOrderEmail.findUnique({ where: { id: row.id }, include: {
                booster: { select: { email: true, role: true, hasBoosterAccess: true, suspendedAt: true } },
                order: { select: { status: true, paymentStatus: true, assignments: { select: { boosterId: true } } } },
            } });
            if (!fresh || fresh.claim !== claim || fresh.sentAt || fresh.skippedAt) continue;
            if (!stillRelevant(fresh)) {
                await prisma.boosterOrderEmail.updateMany({ where: { id: row.id, claim, ...pending }, data: { skippedAt: clock(), claim: null, lastError: 'EVENT_SUPERSEDED' } });
                continue;
            }
            const recipient = fresh.booster.email;
            if (!validEmail(recipient)) throw new Error('Recipient is invalid');
            const info = await transport.sendMail({ ...fresh.payload, to: { address: recipient.trim() }, from: process.env.SMTP_FROM || process.env.SMTP_USER,
                messageId: `<fastboost-booster-${row.id}@${new URL(process.env.CLIENT_URL).hostname}>`, disableFileAccess: true, disableUrlAccess: true });
            if (!info.accepted?.some(address => String(address).toLowerCase() === recipient.trim().toLowerCase())) throw new Error('Recipient not accepted');
            await prisma.boosterOrderEmail.updateMany({ where: { id: row.id, claim, ...pending }, data: { sentAt: clock(), claim: null, lastError: null } });
        } catch (error) {
            const code = /^[A-Z0-9_]{1,40}$/.test(error.code || '') ? error.code : 'DELIVERY_FAILED';
            await prisma.boosterOrderEmail.updateMany({ where: { id: row.id, claim, ...pending }, data: { claim: null, lastError: code,
                nextAttemptAt: new Date(clock().getTime() + Math.min(24 * 60, 2 ** (row.attempts + 1)) * 60000) } });
            console.error(`[Booster order email] ${row.id}: ${code}${row.attempts >= 7 ? ' (retry limit reached)' : ''}`);
        }
    }
}

function startBoosterOrderEmailWorker(prisma) {
    if (!enabled()) return;
    console.log('[Booster order email] Delivery enabled.');
    let running = false;
    const tick = async () => {
        if (running) return;
        running = true;
        let transport;
        try { transport = createConfirmationTransport(); await deliverPendingBoosterOrderEmails(prisma, transport); }
        catch { console.error('[Booster order email] Worker unavailable; check SMTP configuration and booster email migration.'); }
        finally { transport?.close?.(); running = false; }
    };
    void tick();
    const timer = setInterval(tick, 30000); timer.unref(); return timer;
}

module.exports = { buildBoosterOrderEmail, boosterOrderEvents, withBoosterOrderEmails, deliverPendingBoosterOrderEmails, startBoosterOrderEmailWorker };
