const { randomUUID } = require('node:crypto');
const { validEmail, createConfirmationTransport } = require('./orderConfirmationEmail');
const { checkoutSummary } = require('./checkoutSummary');
const { renderCompletion } = require('./orderCompletionTemplate');

const enabled = () => process.env.ORDER_COMPLETION_EMAILS_ENABLED === 'true';
const completed = order => order?.status === 'COMPLETED' && order?.paymentStatus === 'PAID';
const eligibleOrder = { status: 'COMPLETED', paymentStatus: 'PAID' };

function buildCompletion(order) {
    if (!completed(order)) throw new Error('Completion email requires a paid completed order');
    const email = order.customer?.email;
    if (!validEmail(email)) throw new Error('Completion email recipient is invalid');
    const origin = new URL(process.env.CLIENT_URL);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname);
    if (origin.protocol !== 'https:' && !(local && origin.protocol === 'http:' && process.env.NODE_ENV !== 'production')) throw new Error('CLIENT_URL must use HTTPS');
    if (local && process.env.NODE_ENV === 'production') throw new Error('Production email links cannot use localhost');
    const orderUrl = new URL(`/match/${encodeURIComponent(order.id)}`, origin.origin).href;
    const ratingUrl = `${orderUrl}#order-rating`;
    const summary = checkoutSummary(order);
    const rows = [['Game', summary.game === 'tft' ? 'Teamfight Tactics' : 'League of Legends'], ['Service', summary.serviceType], ...summary.details];
    const subject = `FastBoost order #${order.orderNumber} completed`;
    return { to: email.trim(), subject,
        text: [subject, '', 'Your FastBoost order has been completed. Thank you for playing with us.', '',
            ...rows.map(([label, value]) => `${label}: ${value}`), '', 'How was your experience?',
            'Rate your booster on your order page. Your feedback helps our team improve.', `Rate your booster: ${ratingUrl}`,
            '', `Need help? Open your order and chat with our team: ${orderUrl}`].join('\n'),
        html: renderCompletion({ orderNumber: order.orderNumber, rows, ratingUrl, orderUrl }),
    };
}

// Called with the completed order inside its status-change transaction. The
// order primary key keeps retries and later re-completions on one outbox row.
async function queueOrderCompletion(transaction, order) {
    if (!enabled() || !completed(order)) return;
    const payload = buildCompletion(order);
    await transaction.orderCompletionEmail.upsert({ where: { orderId: order.id }, create: { orderId: order.id, payload }, update: {} });
}

async function deliverPendingCompletions(prisma, transport, clock = () => new Date()) {
    const now = clock();
    const rows = await prisma.orderCompletionEmail.findMany({
        where: { sentAt: null, attempts: { lt: 8 }, nextAttemptAt: { lte: now }, order: eligibleOrder },
        orderBy: { nextAttemptAt: 'asc' }, take: 10,
    });
    for (const row of rows) {
        const claimedAt = clock();
        const claim = randomUUID();
        const result = await prisma.orderCompletionEmail.updateMany({
            where: { orderId: row.orderId, sentAt: null, attempts: row.attempts, nextAttemptAt: { lte: claimedAt }, order: eligibleOrder },
            data: { claim, attempts: { increment: 1 }, nextAttemptAt: new Date(claimedAt.getTime() + 5 * 60000) },
        });
        if (!result.count) continue;
        try {
            const fresh = await prisma.orderCompletionEmail.findUnique({ where: { orderId: row.orderId }, include: {
                order: { select: { status: true, paymentStatus: true, customer: { select: { email: true } } } },
            } });
            if (!fresh || fresh.claim !== claim || fresh.sentAt) continue;
            if (!completed(fresh.order)) {
                await prisma.orderCompletionEmail.updateMany({ where: { orderId: row.orderId, claim, sentAt: null },
                    data: { claim: null, attempts: { decrement: 1 } } });
                continue;
            }
            // Follow the customer's current email on retries; a changed account
            // address must not leave private order updates going to the old one.
            const recipient = fresh.order.customer?.email;
            if (!validEmail(recipient)) throw new Error('Recipient is invalid');
            const info = await transport.sendMail({ ...fresh.payload, to: { address: recipient.trim() },
                from: process.env.SMTP_FROM || process.env.SMTP_USER,
                messageId: `<fastboost-completed-${row.orderId}@${new URL(process.env.CLIENT_URL).hostname}>`,
                disableFileAccess: true, disableUrlAccess: true });
            if (!info.accepted?.some(address => String(address).toLowerCase() === recipient.trim().toLowerCase())) throw new Error('Recipient not accepted');
            await prisma.orderCompletionEmail.updateMany({ where: { orderId: row.orderId, claim, sentAt: null }, data: { sentAt: clock(), claim: null, lastError: null } });
        } catch (error) {
            const code = /^[A-Z0-9_]{1,40}$/.test(error.code || '') ? error.code : 'DELIVERY_FAILED';
            await prisma.orderCompletionEmail.updateMany({ where: { orderId: row.orderId, claim, sentAt: null },
                data: { claim: null, lastError: code, nextAttemptAt: new Date(clock().getTime() + Math.min(24 * 60, 2 ** (row.attempts + 1)) * 60000) } });
            console.error(`[Completion email] ${row.orderId}: ${code}${row.attempts >= 7 ? ' (retry limit reached)' : ''}`);
        }
    }
}

function startCompletionWorker(prisma) {
    if (!enabled()) return;
    console.log('[Completion email] Delivery enabled.');
    let running = false;
    const tick = async () => {
        if (running) return;
        running = true;
        let transport;
        try { transport = createConfirmationTransport(); await deliverPendingCompletions(prisma, transport); }
        catch { console.error('[Completion email] Worker unavailable; check SMTP configuration and completion email migration.'); }
        finally { transport?.close?.(); running = false; }
    };
    void tick();
    const timer = setInterval(tick, 30000);
    timer.unref();
    return timer;
}

module.exports = { buildCompletion, queueOrderCompletion, deliverPendingCompletions, startCompletionWorker };
