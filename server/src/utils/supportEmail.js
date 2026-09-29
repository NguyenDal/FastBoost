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

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

function buildSupportEmail(alert) {
    const origin = new URL(process.env.CLIENT_URL);
    if (process.env.NODE_ENV === 'production' && (origin.protocol !== 'https:' || ['localhost', '127.0.0.1'].includes(origin.hostname))) throw new Error('Invalid client URL');
    const message = alert.message;
    const name = message.sender.username || message.sender.profile?.displayName || 'FastBoost support';
    const recipientName = alert.admin.username || alert.admin.profile?.displayName || 'there';
    const toAdmin = customerMessage(alert);
    const heading = toAdmin ? 'You have a new customer message' : 'Your support team has replied';
    const role = toAdmin ? 'Customer' : 'Support team';
    const url = new URL('/support', origin);
    url.searchParams.set('thread', message.threadId);
    url.searchParams.set('message', message.id);
    const date = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Winnipeg', month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(message.createdAt));
    const intro = name + ' sent you a message that’s waiting for your attention.';
    const attachment = message.attachmentName ? 'Attachment: ' + message.attachmentName : '';
    const html = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>' +
        '<body style="margin:0;padding:24px 12px;background:#f4f2f8;color:#202033;font-family:Arial,sans-serif">' +
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">' +
        '<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px;background:#ffffff;border:1px solid #e5def0;border-radius:16px"><tr><td style="padding:32px">' +
        '<div style="font-size:20px;font-weight:800;letter-spacing:1px;color:#713be7">FASTBOOST</div>' +
        '<h1 style="font-size:24px;line-height:1.3;margin:24px 0">' + escapeHtml(heading) + '</h1>' +
        '<p style="font-size:15px;line-height:1.7">Hi ' + escapeHtml(recipientName) + ',<br>' + escapeHtml(intro) + '</p>' +
        '<div style="padding:20px;background:#f6f3fc;border:1px solid #e9e1f5;border-radius:12px;margin:24px 0">' +
        '<strong style="font-size:14px">' + escapeHtml(name) + ' · ' + role + '</strong>' +
        '<div style="font-size:12px;color:#686279;margin-top:6px">' + escapeHtml(date) + '</div>' +
        (message.content ? '<p style="font-size:15px;line-height:1.7;overflow-wrap:anywhere;margin:18px 0 0">' + escapeHtml(message.content).replace(/\r?\n/g, '<br>') + '</p>' : '') +
        (attachment ? '<p style="font-size:13px;overflow-wrap:anywhere;margin:14px 0 0">' + escapeHtml(attachment) + '</p>' : '') + '</div>' +
        '<a href="' + escapeHtml(url.href) + '" style="display:inline-block;padding:14px 24px;border-radius:9px;background:#713be7;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none">Read &amp; reply</a>' +
        '</td></tr></table></td></tr></table></body></html>';
    return { to: { address: alert.admin.email }, subject: toAdmin ? 'New customer message from ' + name : name + ' replied to your support chat', html,
        text: ['FASTBOOST', heading, '', 'Hi ' + recipientName + ',', intro, '', name + ' · ' + role, date, message.content || '', attachment, '', 'Read & reply: ' + url.href].filter(Boolean).join('\n'),
        messageId: '<support-' + alert.id + '@' + origin.hostname + '>' };
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
                admin: { select: { email: true, username: true, profile: { select: { displayName: true } }, role: true, suspendedAt: true } },
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
