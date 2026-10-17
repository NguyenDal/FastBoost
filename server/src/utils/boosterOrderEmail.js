const { randomUUID, createHash } = require('node:crypto');
const { validEmail, createConfirmationTransport } = require('./orderConfirmationEmail');
const { checkoutSummary } = require('./checkoutSummary');
const { orderEarnings } = require('./earnings');
const { renderBoosterOrderEmail } = require('./boosterOrderEmailTemplate');

const enabled = () => process.env.BOOSTER_ORDER_EMAILS_ENABLED === 'true';
const eligibleBooster = user => user && !user.suspendedAt && (user.role === 'PROVIDER' || user.hasBoosterAccess === true);
const eventCopy = Object.freeze({
    ASSIGNED: { badge: 'NEW ASSIGNMENT', subject: 'New order assigned', title: 'You have a new order', text: 'An order has been assigned to you. Open the order to review its details and coordinate with the customer and our team.', action: 'Open order' },
    UNASSIGNED: { badge: 'ASSIGNMENT UPDATED', subject: 'Order unassigned', title: 'Your assignment has ended', text: 'You are no longer assigned to this order. No further work is required from you. You can view your current assignments in the Booster Portal.', action: 'View assigned orders' },
    COMPLETED: { badge: 'ORDER COMPLETED', subject: 'Assigned order completed', title: 'Your assigned order is complete', text: 'This order has been marked complete. You can review its match history and check your contribution status in the Booster Portal.', action: 'View order' },
    CANCELLED: { badge: 'ORDER CANCELLED', subject: 'Assigned order cancelled', title: 'Your assigned order was cancelled', text: 'This order has been cancelled. Please stop work on it. Open the order to review the update or contact our team.', action: 'View order' },
    PAYMENT_CONFIRMED: { badge: 'PAYMENT CONFIRMED', subject: 'Assigned order payment confirmed', title: 'Payment has been confirmed', text: 'Payment has been confirmed for an order assigned to you. Open the order to review its details and continue coordinating with our team.', action: 'Open order' },
    ASSIGNMENT_REQUEST: { badge: 'ASSIGNMENT REQUEST', subject: 'New assignment request', title: 'You have an assignment request', text: 'Our team has invited you to work on this order. Open the Booster Portal to review and respond to the request.', action: 'Review assignment request' },
    ASSIGNMENT_REQUEST_CANCELLED: { badge: 'REQUEST CANCELLED', subject: 'Assignment request cancelled', title: 'Your assignment request was cancelled', text: 'Our team has cancelled this assignment request. No response or work is required from you. You can review your current requests in the Booster Portal.', action: 'Open Booster Portal' },
});
// Keep the existing database event categories; the immutable request metadata
// distinguishes invitations from actual order assignments without a migration.
const requestEvents = Object.freeze({ ASSIGNMENT_REQUEST: 'ASSIGNED', ASSIGNMENT_REQUEST_CANCELLED: 'UNASSIGNED' });
const orderSelect = {
    id: true, orderNumber: true, status: true, paymentStatus: true, boostType: true,
    amountCents: true, goldDiscountCents: true, cashAmountCents: true, totalPrice: true, currency: true,
    currentRank: true, desiredRank: true,
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
    const portalOnly = event === 'UNASSIGNED' || Object.hasOwn(requestEvents, event);
    const url = portalOnly ? portalUrl : new URL(`/match/${encodeURIComponent(order.id)}`, origin.origin).href;
    const summary = checkoutSummary(order);
    // Keep account credentials, customer identity, chat and payment identifiers
    // out of email. The signed-in workspace remains the source of order access.
    const rows = [['Order', `#${order.orderNumber}`], ['Game', summary.game === 'tft' ? 'Teamfight Tactics' : 'League of Legends'], ['Service', summary.serviceType], ...summary.details];
    const earningsNote = 'Potential earnings are shared by approved matches.';
    // Every event retains the same order snapshot. The saved customer total may
    // include tax, but only discounted service revenue after Gold funds earnings.
    // Do not infer a tax charge or rate from the difference between these totals.
    const earnings = orderEarnings(order);
    const money = cents => new Intl.NumberFormat('en-US', { style: 'currency', currency: summary.currency.toUpperCase() }).format(cents / 100);
    const totalKnown = Number.isInteger(order.cashAmountCents) || Number.isInteger(order.amountCents) || Number.isFinite(order.totalPrice);
    rows.push(['Subtotal (before tax)', earnings ? money(earnings.revenueCents) : 'Not available'],
        ['Total (after tax)', totalKnown ? money(summary.totalCents) : 'Not available'],
        ['Potential earnings (70% of subtotal)', earnings ? `Up to ${money(earnings.boosterCents)}` : 'Not available']);
    const subject = `FastBoost · ${copy.subject} #${order.orderNumber}`;
    return { subject,
        text: [subject, '', copy.text, '', ...rows.map(([label, value]) => `${label}: ${value}`), ...(earningsNote ? ['', earningsNote] : []), '', `${copy.action}: ${url}`].join('\n'),
        html: renderBoosterOrderEmail({ copy, orderNumber: order.orderNumber, rows, url, earningsNote }),
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

const requestSelect = { id: true, orderId: true, boosterId: true, status: true, createdAt: true };
const latestRequest = (db, request) => db.assignmentRequest.findFirst({
    where: { orderId: request.orderId, boosterId: request.boosterId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { id: true },
});

// Invoke after a real request transition in the same transaction, while holding
// the Order lock. Stable IDs make retries idempotent even after delivery.
async function queueBoosterAssignmentRequestEmail(tx, requestId, event = 'ASSIGNMENT_REQUEST') {
    if (!enabled()) return null;
    if (!Object.hasOwn(requestEvents, event)) throw new Error('Unknown assignment request email event');
    const request = await tx.assignmentRequest.findUnique({ where: { id: requestId }, select: {
        ...requestSelect,
        booster: { select: { role: true, hasBoosterAccess: true, suspendedAt: true } },
        order: { select: orderSelect },
    } });
    const expectedStatus = event === 'ASSIGNMENT_REQUEST' ? 'PENDING' : 'CANCELLED';
    if (!request || request.status !== expectedStatus || !eligibleBooster(request.booster) || !request.order) return null;
    if (request.order.assignments.some(assignment => assignment.boosterId === request.boosterId)) return null;
    if (event === 'ASSIGNMENT_REQUEST' && ['COMPLETED', 'CANCELLED'].includes(request.order.status)) return null;
    if ((await latestRequest(tx, request))?.id !== request.id) return null;
    const id = `request-${createHash('sha256').update(`${request.id}\0${event}`).digest('hex')}`;
    await tx.boosterOrderEmail.updateMany({ where: {
        orderId: request.orderId, boosterId: request.boosterId, id: { not: id }, sentAt: null, skippedAt: null,
        OR: Object.keys(requestEvents).map(kind => ({ payload: { path: ['assignmentRequest', 'event'], equals: kind } })),
    }, data: { skippedAt: new Date(), claim: null, lastError: 'EVENT_SUPERSEDED' } });
    return tx.boosterOrderEmail.createMany({ skipDuplicates: true, data: [{
        id, orderId: request.orderId, boosterId: request.boosterId, event: requestEvents[event],
        payload: { ...buildBoosterOrderEmail(request.order, event), assignmentRequest: { id: request.id, event } },
    }] });
}

async function stillRelevant(prisma, row) {
    if (!eligibleBooster(row.booster) || !row.order) return false;
    const assigned = row.order.assignments.some(assignment => assignment.boosterId === row.boosterId);
    if (row.payload?.assignmentRequest !== undefined) {
        const metadata = row.payload.assignmentRequest;
        if (!metadata || typeof metadata.id !== 'string' || !metadata.id || !Object.hasOwn(requestEvents, metadata.event) || requestEvents[metadata.event] !== row.event || assigned) return false;
        const request = await prisma.assignmentRequest.findUnique({ where: { id: metadata.id }, select: requestSelect });
        if (!request || request.orderId !== row.orderId || request.boosterId !== row.boosterId) return false;
        const expectedStatus = metadata.event === 'ASSIGNMENT_REQUEST' ? 'PENDING' : 'CANCELLED';
        if (request.status !== expectedStatus) return false;
        if (metadata.event === 'ASSIGNMENT_REQUEST' && ['COMPLETED', 'CANCELLED'].includes(row.order.status)) return false;
        // Only the newest request episode can notify, including when an earlier
        // cancelled invitation has since been replaced by a fresh request.
        return (await latestRequest(prisma, request))?.id === request.id;
    }
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
            if (!await stillRelevant(prisma, fresh)) {
                await prisma.boosterOrderEmail.updateMany({ where: { id: row.id, claim, ...pending }, data: { skippedAt: clock(), claim: null, lastError: 'EVENT_SUPERSEDED' } });
                continue;
            }
            const recipient = fresh.booster.email;
            if (!validEmail(recipient)) throw new Error('Recipient is invalid');
            const { subject, text, html } = fresh.payload;
            const info = await transport.sendMail({ subject, text, html, to: { address: recipient.trim() }, from: process.env.SMTP_FROM || process.env.SMTP_USER,
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

module.exports = { buildBoosterOrderEmail, boosterOrderEvents, withBoosterOrderEmails, queueBoosterAssignmentRequestEmail, deliverPendingBoosterOrderEmails, startBoosterOrderEmailWorker };
