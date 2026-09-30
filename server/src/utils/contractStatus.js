const docusign = require('./docusign');
async function syncContract(db, contract) {
    if (!contract.envelopeId || contract.signedAt) return contract;
    const status = await docusign.getStatus(contract);
    return db.$transaction(async tx => {
        // Never let a delayed event erase a completed agreement.
        const current = await tx.boosterContract.findUnique({ where: { id: contract.id } });
        if (current.signedAt) return current;
        const updated = await tx.boosterContract.update({ where: { id: current.id }, data: { ...status, lastSyncedAt: new Date() } });
        if (status.signedAt) {
            await tx.boosterProfile.upsert({ where: { userId: current.boosterId }, create: { userId: current.boosterId, startedAt: current.startsAt }, update: {} });
            await tx.boosterProfile.updateMany({ where: { userId: current.boosterId, startedAt: null }, data: { startedAt: current.startsAt } });
            await tx.notification.updateMany({ where: { id: `contract-${current.id}`, userId: current.boosterId }, data: { read: true } });
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
