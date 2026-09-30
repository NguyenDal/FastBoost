// Mounted only behind operationsRoutes' JWT and fresh-account checks.
const router = require('express').Router();
const db = require('../prisma');
const docusign = require('../utils/docusign');
const { syncContract } = require('../utils/contractStatus');
const handle = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const admin = req => { if (req.actor.role !== 'ADMIN') fail(403, 'Admins only.'); };
function validDate(value) { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value; }
async function authorized(req, ownerOnly = false) {
    const contract = await db.boosterContract.findUnique({ where: { id: req.params.id } });
    if (!contract || (contract.boosterId !== req.actor.id && (ownerOnly || req.actor.role !== 'ADMIN'))) fail(404, 'Contract not found.');
    return contract;
}
async function send(contract) {
    if (contract.envelopeId) return contract;
    const claim = await db.boosterContract.updateMany({ where: { id: contract.id, envelopeId: null, OR: [
        { status: { in: ['pending', 'send_error'] } }, { status: 'sending', lastSyncedAt: { lt: new Date(Date.now() - 60000) } },
    ] }, data: { status: 'sending', lastSyncedAt: new Date(), sendAttemptAt: contract.sendAttemptAt || new Date() } });
    if (!claim.count) fail(409, 'This contract is being sent. Refresh shortly.');
    try {
        const envelopeId = await docusign.sendContract(contract);
        return await db.$transaction(async tx => {
            const updated = await tx.boosterContract.update({ where: { id: contract.id }, data: { envelopeId, status: 'sent', sendError: null } });
            await tx.notification.upsert({ where: { id: `contract-${contract.id}` }, update: {}, create: { id: `contract-${contract.id}`, userId: contract.boosterId,
                type: 'BOOSTER_CONTRACT', title: 'Contract ready to sign', message: contract.title, data: { targetPath: `/provider/contracts/${contract.id}` } } });
            return updated;
        });
    } catch (error) {
        await db.boosterContract.updateMany({ where: { id: contract.id, envelopeId: null }, data: { status: 'send_error', sendError: 'Delivery not confirmed. Retry this contract to recover its envelope.' } });
        throw error;
    }
}
router.get('/docusign/configuration', handle(async (req, res) => { admin(req); res.json({ ok: true, ...docusign.readiness() }); }));
router.post('/boosters/:boosterId/contracts', handle(async (req, res) => {
    admin(req);
    const config = docusign.configuration();
    const { requestId, startsAt } = req.body;
    const title = String(req.body.title || '').trim();
    const signerName = String(req.body.signerName || '').trim();
    if (!/^[a-f0-9-]{36}$/i.test(requestId || '') || !validDate(startsAt) || !title || title.length > 100 || signerName.length < 2 || signerName.length > 100) fail(400, 'Enter a contract title, full signer name, and valid start date.');
    const booster = await db.user.findUnique({ where: { id: req.params.boosterId } });
    if (!booster || booster.suspendedAt || !(booster.role === 'PROVIDER' || booster.hasBoosterAccess)) fail(404, 'Active booster not found.');
    const contract = await db.boosterContract.upsert({ where: { id: requestId }, update: {}, create: {
        id: requestId, boosterId: booster.id, issuedById: req.actor.id, title, signerName, signerEmail: booster.email,
        startsAt: new Date(startsAt), templateId: config.templateId, accountId: config.accountId, environment: config.environment,
    } });
    if (contract.boosterId !== booster.id || contract.issuedById !== req.actor.id || contract.title !== title || contract.signerName !== signerName || contract.startsAt.toISOString().slice(0, 10) !== startsAt) fail(409, 'This request already belongs to another contract. Refresh before creating a new contract.');
    const sent = await send(contract);
    res.status(201).json({ ok: true, id: sent.id });
}));
router.post('/contracts/:id/retry', handle(async (req, res) => { admin(req); const contract = await authorized(req); await send(contract); res.json({ ok: true }); }));
router.get('/contracts/:id', handle(async (req, res) => { const contract = await authorized(req); res.json({ ok: true, contract }); }));
router.post('/contracts/:id/sync', handle(async (req, res) => {
    const contract = await authorized(req);
    // Connect supplies timely updates; manual fallback observes DocuSign polling limits.
    if (contract.lastSyncedAt && Date.now() - contract.lastSyncedAt.getTime() < 15 * 60000) return res.json({ ok: true, contract, pending: true });
    res.json({ ok: true, contract: await syncContract(db, contract) });
}));
router.post('/contracts/:id/signing-view', handle(async (req, res) => {
    const contract = await authorized(req, true);
    if (!(req.actor.role === 'PROVIDER' || req.actor.hasBoosterAccess)) fail(403, 'Booster access required.');
    if (!contract.envelopeId || contract.signedAt || ['completed', 'voided', 'declined'].includes(contract.status)) fail(409, 'This contract is not awaiting signature.');
    const view = await docusign.signingView(contract);
    const url = new URL(view.url);
    if (url.protocol !== 'https:' || !['docusign.net', 'docusign.com'].some(host => url.hostname.endsWith(`.${host}`))) fail(503, 'Unexpected DocuSign signing URL.');
    await db.boosterContract.update({ where: { id: contract.id }, data: { viewedAt: new Date() } });
    res.json({ ok: true, url: url.href });
}));
router.get('/contracts/:id/document', handle(async (req, res) => {
    const contract = await authorized(req);
    if (!contract.envelopeId) fail(409, 'The contract has not been sent yet.');
    const buffer = await docusign.document(contract);
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="FastBoost-contract.pdf"' }).send(buffer);
}));
module.exports = router;
