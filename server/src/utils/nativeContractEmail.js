const { randomUUID, createHash } = require('node:crypto');
const { validEmail, createConfirmationTransport } = require('./orderConfirmationEmail');
const { buildNativeContractEmail } = require('./nativeContractEmailTemplate');

const EVENTS = Object.freeze({
    ISSUED: ['BOOSTER'],
    READY: ['BOOSTER'],
    BOOSTER_SIGNED: ['COMPANY'],
    COMPANY_SIGNED: ['BOOSTER'],
    COMPLETED: ['BOOSTER', 'COMPANY'],
});
const pending = { sentAt: null, skippedAt: null };
const digest = value => createHash('sha256').update(value).digest('hex');

function missingEmailTable(error) {
    const cause = error?.meta?.driverAdapterError?.cause || error?.cause;
    if (![error?.code, error?.meta?.code, cause?.originalCode, cause?.code].some(code => code === 'P2021' || code === '42P01')) return false;
    if ([error?.meta?.table, error?.table, cause?.table].some(table => typeof table === 'string' &&
        /^(?:[\w]+\.)?NativeContractEmail$/.test(table.replace(/["`]/g, '')))) return true;
    return [error?.message, error?.meta?.message, cause?.originalMessage].some(message => typeof message === 'string' &&
        /relation ["`](?:[\w]+\.)?NativeContractEmail["`] does not exist/i.test(message));
}

async function queueNativeContractEmail(tx, contractId, event) {
    if (!Object.hasOwn(EVENTS, event)) throw new Error('Unknown native agreement email event.');
    try {
        await tx.nativeContractEmail.createMany({ skipDuplicates: true, data: EVENTS[event].map(recipientRole => ({
            id: `${contractId}:${event}:${recipientRole}`, contractId, event, recipientRole,
        })) });
    } catch (error) {
        if (!missingEmailTable(error)) throw error;
        // Keep the signature and its email notification atomic while the
        // required migration is pending; never accept a partial signing result.
        throw Object.assign(new Error('Agreement changes are temporarily unavailable. Please contact FastBoost support to finish the service update, then retry.',
            { cause: error }), { status: 503 });
    }
}

function relevant(row, contract) {
    if (!contract || contract.signingProvider !== 'FASTBOOST' || contract.revokedAt
        || ['voided', 'declined', 'replaced'].includes(contract.status)) return false;
    if (contract.archivedAt && row.event !== 'COMPLETED') return false;
    if (row.event === 'ISSUED') return row.recipientRole === 'BOOSTER';
    if (row.event === 'READY') return row.recipientRole === 'BOOSTER' && Boolean(contract.nativePreparedAt);
    if (row.event === 'BOOSTER_SIGNED') return row.recipientRole === 'COMPANY' && Boolean(contract.boosterSignedAt);
    if (row.event === 'COMPANY_SIGNED') return row.recipientRole === 'BOOSTER' && ['FB-BSA-2.3', 'FB-BSA-2.4'].includes(contract.nativeSnapshot?.version)
        && Boolean(contract.nativePreparedAt && contract.companySignedAt);
    if (row.event === 'COMPLETED') return EVENTS.COMPLETED.includes(row.recipientRole) && Boolean(contract.signedAt && contract.boosterSignedAt
        && contract.companySignedAt && contract.nativeCompletedAt && contract.nativePdf && contract.nativePdfHash);
    return false;
}

function recipientFor(contract, role) {
    return role === 'BOOSTER' ? contract.signerEmail : role === 'COMPANY' ? contract.companySignerEmail : null;
}

function completedAttachment(contract) {
    const pdf = Buffer.from(contract.nativePdf || []);
    if (pdf.subarray(0, 5).toString() !== '%PDF-' || digest(pdf) !== contract.nativePdfHash) {
        throw new Error('The completed agreement PDF could not be verified.');
    }
    return [{ filename: `FastBoost-Booster-Service-Agreement-${contract.id}.pdf`, content: pdf,
        contentType: 'application/pdf', contentDisposition: 'attachment' }];
}

async function deliverPendingNativeContractEmails(db, transport, clock = () => new Date()) {
    const rows = await db.nativeContractEmail.findMany({ where: { ...pending, attempts: { lt: 8 }, nextAttemptAt: { lte: clock() } },
        orderBy: [{ nextAttemptAt: 'asc' }, { id: 'asc' }], take: 10 });
    for (const row of rows) {
        const now = clock();
        const claim = randomUUID();
        const claimed = await db.nativeContractEmail.updateMany({ where: { id: row.id, ...pending, attempts: row.attempts,
            nextAttemptAt: { lte: now } }, data: { claim, attempts: { increment: 1 }, nextAttemptAt: new Date(now.getTime() + 5 * 60000) } });
        if (!claimed.count) continue;
        try {
            const fresh = await db.nativeContractEmail.findUnique({ where: { id: row.id }, include: { contract: true } });
            if (!fresh || fresh.claim !== claim || fresh.sentAt || fresh.skippedAt) continue;
            const contract = fresh.contract;
            if (!relevant(fresh, contract)) {
                await db.nativeContractEmail.updateMany({ where: { id: row.id, claim, ...pending },
                    data: { skippedAt: clock(), claim: null, lastError: 'EVENT_SUPERSEDED' } });
                continue;
            }
            const recipient = recipientFor(contract, fresh.recipientRole);
            if (!validEmail(recipient)) throw new Error('Agreement email recipient is invalid.');
            const mail = buildNativeContractEmail(contract, fresh.event);
            const info = await transport.sendMail({ ...mail, to: { address: recipient.trim() },
                from: process.env.SMTP_FROM || process.env.SMTP_USER,
                ...(fresh.event === 'COMPLETED' ? { attachments: completedAttachment(contract) } : {}),
                messageId: `<fastboost-agreement-${digest(fresh.id)}@${new URL(process.env.CLIENT_URL).hostname}>`,
                disableFileAccess: true, disableUrlAccess: true });
            if (!info.accepted?.some(address => String(address).toLowerCase() === recipient.trim().toLowerCase())) throw new Error('Recipient not accepted.');
            await db.nativeContractEmail.updateMany({ where: { id: row.id, claim, ...pending },
                data: { sentAt: clock(), claim: null, lastError: null } });
        } catch (error) {
            const code = /^[A-Z0-9_]{1,40}$/.test(error.code || '') ? error.code : 'DELIVERY_FAILED';
            await db.nativeContractEmail.updateMany({ where: { id: row.id, claim, ...pending },
                data: { claim: null, lastError: code, nextAttemptAt: new Date(clock().getTime() + Math.min(24 * 60, 2 ** (row.attempts + 1)) * 60000) } });
            console.error(`[Agreement email] ${row.id}: ${code}${row.attempts >= 7 ? ' (retry limit reached)' : ''}`);
        }
    }
}

function startNativeContractEmailWorker(db) {
    if (process.env.NATIVE_CONTRACT_EMAILS_ENABLED === 'false') return;
    let running = false;
    const tick = async () => {
        if (running) return;
        running = true;
        let transport;
        try { transport = createConfirmationTransport(); await deliverPendingNativeContractEmails(db, transport); }
        catch { console.error('[Agreement email] Worker unavailable; check SMTP configuration and agreement email migration.'); }
        finally { transport?.close?.(); running = false; }
    };
    void tick();
    const timer = setInterval(tick, 30000); timer.unref(); return timer;
}

module.exports = { EVENTS, queueNativeContractEmail, relevant, completedAttachment, deliverPendingNativeContractEmails, startNativeContractEmailWorker };
