const docusign = require('./docusign');
const { recordCriticalActivity } = require('./criticalActivity');
async function syncContract(db, contract) {
    if (contract.signingProvider === 'FASTBOOST' || contract.archivedAt || contract.revokedAt || !contract.envelopeId || contract.signedAt) return contract;
    const status = await docusign.getStatus(contract);
    return db.$transaction(async tx => {
        // Serialize a delayed Connect completion with explicit sandbox replacement.
        // Reading without this lock could grant tenure after replacement committed.
        await tx.$queryRawUnsafe('SELECT "id" FROM "BoosterContract" WHERE "id" = $1 FOR UPDATE', contract.id);
        // Never let a delayed event erase a completed agreement.
        const current = await tx.boosterContract.findUnique({ where: { id: contract.id } });
        if (current.signedAt || current.archivedAt || current.revokedAt || current.signingProvider === 'FASTBOOST') return current;
        const updated = await tx.boosterContract.update({ where: { id: current.id }, data: { ...status, lastSyncedAt: new Date() } });
        // A status poll is routine. Only verified new signer timestamps are critical.
        if (!current.companySignedAt && updated.companySignedAt) {
            const company = current.companySignerEmail && await tx.user.findFirst({
                where: { email: { equals: current.companySignerEmail, mode: 'insensitive' }, role: 'ADMIN' },
                select: { id: true, username: true, role: true, isOwner: true },
            });
            await recordCriticalActivity(tx, {
                actor: company || { username: 'FastBoost signer', role: 'ADMIN' }, allowAdmin: true, allowMissingActor: !company,
                action: 'contract.sign', targetType: 'contract', targetId: current.id,
                targetLabel: current.title || 'Booster agreement', requested: { signer: 'FastBoost' },
                before: { status: current.status, companySignedAt: null },
                after: { status: updated.status, companySignedAt: updated.companySignedAt },
            });
        }
        if (!current.boosterSignedAt && updated.boosterSignedAt) {
            const booster = await tx.user.findUnique({ where: { id: current.boosterId },
                select: { id: true, username: true, role: true, isOwner: true } });
            await recordCriticalActivity(tx, {
                actor: booster || { username: 'Former booster', role: 'PROVIDER' }, allowMissingActor: !booster,
                action: 'contract.sign', targetType: 'contract', targetId: current.id,
                targetLabel: current.title || 'Booster agreement', requested: { signer: 'Booster' },
                before: { status: current.status, boosterSignedAt: null },
                after: { status: updated.status, boosterSignedAt: updated.boosterSignedAt },
            });
        }
        if (status.companySignedAt && !current.companySignedAt && !status.signedAt) {
            await tx.notification.updateMany({ where: { id: `contract-${current.id}`, userId: current.boosterId }, data: { title: 'Contract ready to sign', read: false } });
        }
        if (status.signedAt) {
            const startedAt = current.companySignerEmail ? new Date(Math.max(new Date(current.startsAt).getTime(), status.signedAt.getTime())) : current.startsAt;
            await tx.boosterProfile.upsert({ where: { userId: current.boosterId }, create: { userId: current.boosterId, startedAt }, update: {} });
            await tx.boosterProfile.updateMany({ where: { userId: current.boosterId, startedAt: null }, data: { startedAt } });
            await tx.notification.updateMany({ where: { id: `contract-${current.id}`, userId: current.boosterId }, data: { read: true } });
            await tx.notification.updateMany({ where: { id: `contract-company-${current.id}` }, data: { read: true } });
        }
        return updated;
    });
}
async function webhook(req, res) {
    if (!docusign.validWebhook(req.body, req.headers)) return res.status(401).json({ ok: false });
    let event;
    try { event = JSON.parse(req.body.toString('utf8')); } catch { return res.status(400).json({ ok: false }); }
    try {
        const db = require('../prisma');
        const envelopeId = event.data?.envelopeId;
        if (typeof envelopeId !== 'string') return res.status(400).json({ ok: false });
        const contract = await db.boosterContract.findUnique({ where: { envelopeId } });
        // Only re-fetch envelopes belonging to this app and account. Event status is never authoritative.
        if (contract && event.data?.accountId === contract.accountId) await syncContract(db, contract);
        return res.json({ ok: true });
    } catch { return res.status(503).json({ ok: false }); }
}
module.exports = { syncContract, webhook };
