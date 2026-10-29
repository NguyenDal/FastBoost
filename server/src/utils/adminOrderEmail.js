const { createHash, randomUUID } = require('node:crypto');
const { validEmail, createConfirmationTransport } = require('./orderConfirmationEmail');
const { checkoutSummary } = require('./checkoutSummary');
const { orderEarnings } = require('./earnings');
const { renderBoosterOrderEmail } = require('./boosterOrderEmailTemplate');
const { clientOrigin } = require('./clientOrigin');

// Existing installations with team email enabled also notify admins. An explicit
// setting can independently enable or disable this channel.
const enabled = () => process.env.ADMIN_ORDER_EMAILS_ENABLED === 'true'
    || (process.env.ADMIN_ORDER_EMAILS_ENABLED === undefined && process.env.BOOSTER_ORDER_EMAILS_ENABLED === 'true');
const activeAdmin = user => user?.role === 'ADMIN' && !user.suspendedAt;
const paidOrder = order => order?.paymentStatus === 'PAID' && order.status !== 'CANCELLED';
const orderSelect = {
    id: true, orderNumber: true, status: true, paymentStatus: true, boostType: true,
    amountCents: true, goldDiscountCents: true, cashAmountCents: true, totalPrice: true, currency: true,
    currentRank: true, desiredRank: true, peakRank: true, placementGames: true, desiredWins: true,
    numberOfGames: true, queueType: true, region: true, service: { select: { title: true } },
};
function buildAdminOrderEmail(order) {
    if (!paidOrder(order)) throw new Error('Admin order notification requires a paid active order');
    const summary = checkoutSummary(order);
    const url = new URL(`/admin/orders/${encodeURIComponent(order.id)}`, clientOrigin()).href;
    const rows = [['Order', `#${order.orderNumber}`], ['Game', summary.game === 'tft' ? 'Teamfight Tactics' : 'League of Legends'],
        ['Service', summary.serviceType], ...summary.details, ['Payment', 'Paid']];
    const money = cents => new Intl.NumberFormat('en-US', { style: 'currency', currency: summary.currency.toUpperCase() }).format(cents / 100);
    const earnings = orderEarnings(order);
    rows.push(['Total', money(summary.totalCents)], ['Booster pool (70% of total)', earnings ? money(earnings.boosterCents) : 'Not available']);
    const copy = { badge: 'NEW ORDER', subject: 'New order placed', title: 'A new order is ready',
        text: 'Payment is confirmed. Open the order to review the details and assign a booster.', action: 'Open order' };
    const subject = `FastBoost · ${copy.subject} #${order.orderNumber}`;
    return { subject, text: [subject, '', copy.text, '', ...rows.map(([label, value]) => `${label}: ${value}`), '', `${copy.action}: ${url}`].join('\n'),
        html: renderBoosterOrderEmail({ copy, orderNumber: order.orderNumber, rows, url, headerLabel: 'ADMIN ORDER UPDATE',
            previewText: 'Payment is confirmed. Review and assign this order.' }) };
}

// Called only after the first PAID transition, inside the payment transaction.
// Each administrator present at placement gets a separate immutable snapshot.
async function queueAdminOrderEmail(transaction, orderId) {
    if (!enabled()) return;
    const order = await transaction.order.findUnique({ where: { id: orderId }, select: orderSelect });
    if (!paidOrder(order)) return;
    const admins = await transaction.user.findMany({ where: { role: 'ADMIN', suspendedAt: null }, select: { id: true } });
    if (!admins.length) return;
    const payload = buildAdminOrderEmail(order);
    await transaction.adminOrderEmail.createMany({ skipDuplicates: true, data: admins.map(admin => ({
        id: `placed-${createHash('sha256').update(`${orderId}\0${admin.id}`).digest('hex')}`, orderId, adminId: admin.id, payload,
    })) });
}

async function deliverPendingAdminOrderEmails(prisma, transport, clock = () => new Date()) {
    const pending = { sentAt: null, skippedAt: null };
    const rows = await prisma.adminOrderEmail.findMany({ where: { ...pending, attempts: { lt: 8 }, nextAttemptAt: { lte: clock() } },
        orderBy: [{ nextAttemptAt: 'asc' }, { id: 'asc' }], take: 25 });
    for (const row of rows) {
        const claimedAt = clock();
        const claim = randomUUID();
        const result = await prisma.adminOrderEmail.updateMany({ where: { id: row.id, ...pending, attempts: row.attempts, nextAttemptAt: { lte: claimedAt } },
            data: { claim, attempts: { increment: 1 }, nextAttemptAt: new Date(claimedAt.getTime() + 5 * 60000) } });
        if (!result.count) continue;
        try {
            const fresh = await prisma.adminOrderEmail.findUnique({ where: { id: row.id }, include: {
                admin: { select: { email: true, role: true, suspendedAt: true } }, order: { select: { paymentStatus: true, status: true } },
            } });
            if (!fresh || fresh.claim !== claim || fresh.sentAt || fresh.skippedAt) continue;
            // A person who lost admin access must not receive this order later.
            if (!activeAdmin(fresh.admin) || !paidOrder(fresh.order)) {
                await prisma.adminOrderEmail.updateMany({ where: { id: row.id, claim, ...pending },
                    data: { skippedAt: clock(), claim: null, lastError: 'EVENT_SUPERSEDED' } });
                continue;
            }
            const recipient = fresh.admin.email;
            if (!validEmail(recipient)) throw new Error('Recipient is invalid');
            const { subject, text, html } = fresh.payload;
            const info = await transport.sendMail({ subject, text, html, to: { address: recipient.trim() },
                from: process.env.SMTP_FROM || process.env.SMTP_USER,
                messageId: `<fastboost-admin-${row.id}@${new URL(clientOrigin()).hostname}>`, disableFileAccess: true, disableUrlAccess: true });
            if (!info.accepted?.some(address => String(address).toLowerCase() === recipient.trim().toLowerCase())) throw new Error('Recipient not accepted');
            await prisma.adminOrderEmail.updateMany({ where: { id: row.id, claim, ...pending }, data: { sentAt: clock(), claim: null, lastError: null } });
        } catch (error) {
            const code = /^[A-Z0-9_]{1,40}$/.test(error.code || '') ? error.code : 'DELIVERY_FAILED';
            await prisma.adminOrderEmail.updateMany({ where: { id: row.id, claim, ...pending }, data: { claim: null, lastError: code,
                nextAttemptAt: new Date(clock().getTime() + Math.min(24 * 60, 2 ** (row.attempts + 1)) * 60000) } });
            console.error(`[Admin order email] ${row.id}: ${code}${row.attempts >= 7 ? ' (retry limit reached)' : ''}`);
        }
    }
    return rows.length;
}

const workers = new WeakMap();
function startAdminOrderEmailWorker(prisma, { transportFactory = createConfirmationTransport, interval = setInterval } = {}) {
    if (!enabled()) return;
    if (workers.has(prisma)) return workers.get(prisma).timer;
    let running = false, requested = false;
    const tick = async () => {
        requested = true;
        if (running) return;
        running = true;
        let transport;
        try {
            transport = transportFactory();
            do {
                requested = false;
                // Drain full batches promptly so more than 25 admins do not wait
                // for the next interval. Leases prevent competing worker sends.
                if (await deliverPendingAdminOrderEmails(prisma, transport) === 25) requested = true;
            } while (requested);
        } catch { console.error('[Admin order email] Worker unavailable; check SMTP and the admin order email migration.'); }
        finally { transport?.close?.(); running = false; }
    };
    const timer = interval(tick, 30000); timer?.unref?.();
    workers.set(prisma, { tick, timer });
    void tick();
    return timer;
}
function wakeAdminOrderEmailWorker(prisma) {
    if (!enabled()) return;
    if (!workers.has(prisma)) startAdminOrderEmailWorker(prisma);
    else void workers.get(prisma).tick();
}

module.exports = { enabled, buildAdminOrderEmail, queueAdminOrderEmail, deliverPendingAdminOrderEmails,
    startAdminOrderEmailWorker, wakeAdminOrderEmailWorker };
