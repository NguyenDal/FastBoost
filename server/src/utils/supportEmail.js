const { randomUUID } = require('node:crypto');
const { createContactTransport } = require('./contactEmail');
const { supportNotificationId, EMAIL_DELAY_MS } = require('./supportChat');

const customerMessage = alert => alert.message.senderId === alert.message.thread.customerId;

async function shouldDeliver(db, alert) {
    const toAdmin = customerMessage(alert);
    const recipient = alert.admin; // Existing relation/column name; also stores customer recipients.
    if (recipient.suspendedAt || (toAdmin ? recipient.role !== 'ADMIN'
        : recipient.role !== 'CUSTOMER' || alert.adminId !== alert.message.thread.customerId)) return false;
    const readAt = toAdmin ? alert.message.thread.adminReadAt : alert.message.thread.customerReadAt;
    if (readAt >= alert.message.createdAt) return false;
    const notification = await db.notification.findUnique({ where: { id: supportNotificationId(alert.messageId, alert.adminId) }, select: { read: true } });
    return !notification?.read;
}

function buildSupportEmail(alert) {
    const origin = new URL(process.env.CLIENT_URL);
    if (process.env.NODE_ENV === 'production' && (origin.protocol !== 'https:' || ['localhost', '127.0.0.1'].includes(origin.hostname))) throw new Error('Invalid client URL');
    const message = alert.message;
    const name = message.sender.username || message.sender.profile?.displayName || 'FastBoost support';
    const toAdmin = customerMessage(alert);
    const url = new URL(toAdmin ? `/admin/support?thread=${encodeURIComponent(message.threadId)}` : '/support', origin).href;
    return { to: { address: alert.admin.email }, subject: 'New FastBoost support message',
        text: [`${name} ${toAdmin ? 'sent you a support message' : 'replied to your support conversation'}.`, '', message.content || '', message.attachmentName ? `Attachment: ${message.attachmentName}` : '', '', `Read and reply: ${url}`].filter(Boolean).join('\n'),
        messageId: `<support-${alert.id}@${origin.hostname}>` };
}

async function deliverSupportAlerts(db, transport, now = new Date()) {
    const mature = { createdAt: { lte: new Date(now.getTime() - EMAIL_DELAY_MS) } };
    const alerts = await db.supportEmailAlert.findMany({ where: { sentAt: null, nextAttemptAt: { lte: now }, message: mature }, orderBy: { nextAttemptAt: 'asc' }, take: 20 });
    for (const alert of alerts) {
        const claim = randomUUID();
        const claimed = await db.supportEmailAlert.updateMany({ where: { id: alert.id, sentAt: null, attempts: alert.attempts, nextAttemptAt: { lte: now }, message: mature }, data: { claim, attempts: { increment: 1 }, nextAttemptAt: new Date(now.getTime() + 300000) } });
        if (!claimed.count) continue;
        try {
            // Re-read recipient/ownership and read status after claiming, including on retries.
            const fresh = await db.supportEmailAlert.findUnique({ where: { id: alert.id }, include: {
                admin: { select: { email: true, role: true, suspendedAt: true } },
                message: { include: { thread: true, sender: { select: { username: true, profile: { select: { displayName: true } } } } } },
            } });
            if (!fresh || fresh.claim !== claim) continue;
            if (!(await shouldDeliver(db, fresh))) {
                await db.supportEmailAlert.deleteMany({ where: { id: alert.id, claim, sentAt: null } });
                continue;
            }
            const info = await transport.sendMail({ ...buildSupportEmail(fresh), from: process.env.SMTP_FROM || process.env.SMTP_USER, disableFileAccess: true, disableUrlAccess: true });
            if (!info.accepted?.length) throw new Error('Not accepted');
            await db.supportEmailAlert.updateMany({ where: { id: alert.id, claim }, data: { sentAt: new Date(), claim: null, lastError: null } });
        } catch (error) {
            const code = /^[A-Z0-9_]{1,40}$/.test(error.code || '') ? error.code : 'DELIVERY_FAILED';
            await db.supportEmailAlert.updateMany({ where: { id: alert.id, claim }, data: { claim: null, lastError: code, nextAttemptAt: new Date(now.getTime() + Math.min(360, 2 ** Math.min(alert.attempts + 1, 9)) * 60000) } });
            console.error('[Support email]', code);
        }
    }
}

function startSupportEmailWorker(db) {
    let running = false;
    const tick = async () => {
        if (running) return;
        running = true;
        let transport;
        try { transport = createContactTransport(); await deliverSupportAlerts(db, transport); }
        catch { console.error('[Support email] Delivery unavailable; check SMTP and support migration.'); }
        finally { transport?.close(); running = false; }
    };
    void tick();
    const timer = setInterval(tick, 15000);
    timer.unref();
    return timer;
}
module.exports = { buildSupportEmail, deliverSupportAlerts, startSupportEmailWorker, shouldDeliver };
