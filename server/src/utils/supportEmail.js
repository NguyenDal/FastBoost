const { randomUUID } = require('node:crypto');
const { createContactTransport } = require('./contactEmail');

function buildSupportEmail(alert) {
    const origin = new URL(process.env.CLIENT_URL);
    if (process.env.NODE_ENV === 'production' && (origin.protocol !== 'https:' || ['localhost', '127.0.0.1'].includes(origin.hostname))) throw new Error('Invalid client URL');
    const message = alert.message;
    const name = message.sender.username || message.sender.profile?.displayName || 'A customer';
    const url = new URL(`/admin/support?thread=${encodeURIComponent(message.threadId)}`, origin).href;
    return { to: { address: alert.admin.email }, subject: 'New FastBoost support message',
        text: [`${name} sent a message while no admins were online.`, '', message.content || '', message.attachmentName ? `Attachment: ${message.attachmentName}` : '', '', `Reply in the support inbox: ${url}`].filter(Boolean).join('\n'),
        messageId: `<support-${alert.id}@${origin.hostname}>` };
}

async function deliverSupportAlerts(db, transport, now = new Date()) {
    const alerts = await db.supportEmailAlert.findMany({ where: { sentAt: null, nextAttemptAt: { lte: now } }, orderBy: { nextAttemptAt: 'asc' }, take: 20,
        include: { admin: { select: { email: true, role: true, suspendedAt: true } }, message: { include: { sender: { select: { username: true, profile: { select: { displayName: true } } } } } } } });
    for (const alert of alerts) {
        const claim = randomUUID();
        const claimed = await db.supportEmailAlert.updateMany({ where: { id: alert.id, sentAt: null, attempts: alert.attempts, nextAttemptAt: { lte: now } }, data: { claim, attempts: { increment: 1 }, nextAttemptAt: new Date(now.getTime() + 300000) } });
        if (!claimed.count) continue;
        try {
            if (alert.admin.role === 'ADMIN' && !alert.admin.suspendedAt) {
                const info = await transport.sendMail({ ...buildSupportEmail(alert), from: process.env.SMTP_FROM || process.env.SMTP_USER, disableFileAccess: true, disableUrlAccess: true });
                if (!info.accepted?.length) throw new Error('Not accepted');
            }
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
module.exports = { buildSupportEmail, deliverSupportAlerts, startSupportEmailWorker };
