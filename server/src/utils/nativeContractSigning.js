const { createHash } = require('node:crypto');
const jwt = require('jsonwebtoken');
const agreement = require('./nativeAgreement');

const PROVIDER = 'FASTBOOST';
const CONSENT_TEXT = 'I have reviewed this completed agreement and Schedule A, agree to use electronic signatures, and intend my signature and initials to bind me to this exact agreement. I can download and retain a completed copy.';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const digest = value => createHash('sha256').update(value).digest('hex');
const native = contract => contract.signingProvider === PROVIDER;
const email = value => String(value || '').trim().toLowerCase();
const eligible = actor => actor.role === 'PROVIDER' || actor.hasBoosterAccess;
const sameName = (left, right) => left.normalize('NFKC').replace(/\s+/g, ' ').toLowerCase() === right.normalize('NFKC').replace(/\s+/g, ' ').toLowerCase();

function publicContract(contract) {
    if (!contract) return null;
    const { nativeSnapshot, nativePdf, nativeSignatures, ...record } = contract;
    return { ...record, signingProvider: record.signingProvider || 'DOCUSIGN', documentAvailable: native(contract) ? Boolean(nativePdf && contract.nativePreparedAt) : Boolean(contract.envelopeId) };
}
async function activeActor(db, actor) {
    const current = actor?.id && await db.user.findUnique({ where: { id: actor.id } });
    if (!current || current.suspendedAt) fail(403, 'Your account cannot sign this agreement.');
    return current;
}
function roleFor(contract, actor) {
    if (actor.role === 'ADMIN' && email(actor.email) === email(contract.companySignerEmail)
        && (!native(contract) || actor.id === contract.nativeCompanySignerId)) return 'COMPANY';
    if (actor.id === contract.boosterId && eligible(actor)) return 'BOOSTER';
    return null;
}
function secret() {
    if (!process.env.JWT_SECRET) fail(503, 'Website signing is temporarily unavailable.');
    return process.env.JWT_SECRET;
}
async function resolveCompany(db) {
    const configuredEmail = email(process.env.FASTBOOST_COMPANY_SIGNER_EMAIL || process.env.DOCUSIGN_COMPANY_SIGNER_EMAIL);
    const name = String(process.env.FASTBOOST_COMPANY_SIGNER_NAME || process.env.DOCUSIGN_COMPANY_SIGNER_NAME || 'An Nguyen Nguyen').trim();
    let actor;
    if (configuredEmail) actor = await db.user.findFirst({ where: { email: { equals: configuredEmail, mode: 'insensitive' }, role: 'ADMIN', suspendedAt: null } });
    else {
        const owners = await db.user.findMany({ where: { role: 'ADMIN', suspendedAt: null, isOwner: true }, take: 2 });
        if (owners.length === 1) actor = owners[0];
    }
    if (!actor || !email(actor.email) || name.length < 2 || name.length > 100) fail(503, 'Configure an active FastBoost owner as the agreement countersigner.');
    return { id: actor.id, name, email: email(actor.email) };
}
async function readiness(db) {
    try {
        agreement.assertAssets(); secret(); await resolveCompany(db);
        return { configured: true, signingProvider: PROVIDER, environment: 'production', version: agreement.VERSION };
    } catch {
        return { configured: false, signingProvider: PROVIDER, environment: 'production', version: agreement.VERSION };
    }
}
function matchesCreation(contract, input) {
    return contract.boosterId === input.boosterId && contract.issuedById === input.issuedById
        && contract.signerName === input.signerName && new Date(contract.startsAt).toISOString().slice(0, 10) === input.startsAt;
}
async function issue(db, input, company) {
    const issuer = await db.user.findUnique({ where: { id: input.issuedById } });
    if (!issuer || issuer.suspendedAt || issuer.role !== 'ADMIN') fail(403, 'Only an active admin can issue an agreement.');
    const booster = await db.user.findUnique({ where: { id: input.boosterId } });
    if (!booster || booster.suspendedAt || !eligible(booster)) fail(404, 'Active booster not found.');
    if (booster.id === company.id) fail(400, 'The booster and FastBoost must be different signers.');
    if (!String(booster.username || '').trim()) fail(400, 'Set the booster’s username in Account Management before issuing an agreement.');
    const create = {
        id: input.requestId, boosterId: booster.id, issuedById: input.issuedById,
        title: 'Booster Service Agreement', signerName: input.signerName, signerEmail: booster.email,
        startsAt: new Date(input.startsAt), templateId: agreement.VERSION, accountId: 'fastboost', environment: 'production',
        signingProvider: PROVIDER, status: 'sent', companySignerName: company.name, companySignerEmail: company.email,
        nativeCompanySignerId: company.id, ...(input.replacesContractId && { replacesContractId: input.replacesContractId }),
    };
    create.nativeSnapshot = { ...agreement.createSnapshot({ ...create, providerUsername: booster.username }), commercialFields: agreement.commercialFields() };
    const contract = await db.boosterContract.upsert({ where: { id: input.requestId }, update: {}, create });
    if (!native(contract) || !matchesCreation(contract, input) || (contract.replacesContractId || null) !== (input.replacesContractId || null)) fail(409, 'This request already belongs to another agreement.');
    await db.notification.upsert({ where: { id: `contract-${contract.id}` }, update: {}, create: {
        id: `contract-${contract.id}`, userId: contract.boosterId, type: 'BOOSTER_CONTRACT', title: 'New agreement awaiting FastBoost signature',
        message: contract.title, data: { targetPath: `/provider/contracts/${contract.id}` },
    } });
    await db.notification.upsert({ where: { id: `contract-company-${contract.id}` }, update: {}, create: {
        id: `contract-company-${contract.id}`, userId: contract.nativeCompanySignerId, type: 'BOOSTER_CONTRACT', title: 'Agreement ready for your signature',
        message: contract.title, data: { targetPath: `/provider/contracts/${contract.id}` },
    } });
    return contract;
}
async function createContract(db, input) {
    if (!input || !UUID.test(input.requestId || '') || typeof input.signerName !== 'string' || input.signerName.trim().length < 2
        || input.signerName.trim().length > 100 || !/^\d{4}-\d{2}-\d{2}$/.test(input.startsAt || '')
        || !Number.isFinite(Date.parse(input.startsAt)) || new Date(input.startsAt).toISOString().slice(0, 10) !== input.startsAt) fail(400, 'Enter a full legal name and a valid agreement start date.');
    input = { ...input, requestId: input.requestId.toLowerCase(), signerName: input.signerName.trim() };
    agreement.assertAssets(); secret();
    const company = await resolveCompany(db);
    return db.$transaction(tx => issue(tx, input, company));
}
async function signaturesFor(db, contractId) {
    return db.nativeContractSignature.findMany({ where: { contractId }, orderBy: [{ signedAt: 'asc' }, { role: 'asc' }] });
}
function publicSignature(signature) {
    return { role: signature.role, legalName: signature.legalName, initials: signature.initials, signedAt: signature.signedAt, signature: signature.signature };
}
function assertNative(contract) {
    if (!native(contract)) fail(409, 'This agreement uses its original DocuSign signing record.');
    if (!contract.nativeSnapshot) fail(503, 'The issued agreement is unavailable.');
}
function assertOpen(contract) {
    if (contract.archivedAt) fail(409, 'This agreement is archived and is available for reference only.');
    if (contract.revokedAt || ['replaced', 'voided', 'declined'].includes(contract.status)) fail(409, 'This agreement is no longer available for signing.');
}
function verifyFrozen(contract) {
    if (!contract.nativePreparedAt || !contract.nativeDocumentHash || !contract.nativePdf || !contract.nativePdfHash) fail(409, 'FastBoost must prepare the completed agreement before signing.');
    if (agreement.snapshotHash(contract.nativeSnapshot) !== contract.nativeDocumentHash || digest(Buffer.from(contract.nativePdf)) !== contract.nativePdfHash) fail(503, 'The saved agreement could not be verified.');
}
function document(contract) {
    assertNative(contract); verifyFrozen(contract);
    return Buffer.from(contract.nativePdf);
}
function challengeFor(contract, actor, role) {
    return jwt.sign({ purpose: 'fastboost-contract-signature-v1', contractId: contract.id, actorId: actor.id, role,
        documentHash: contract.nativeDocumentHash, pdfHash: contract.nativePdfHash, consentVersion: agreement.VERSION }, secret(),
    { algorithm: 'HS256', expiresIn: '15m', issuer: 'FastBoost', audience: 'contract-signing' });
}
async function signingContext(db, contract, actor) {
    const current = await activeActor(db, actor);
    const role = roleFor(contract, current);
    if (!role) fail(404, 'Contract not found.');
    if (!native(contract)) return { ok: true, legacy: true, contract: publicContract(contract), html: null, fields: [], values: {},
        documentHash: null, prepared: false, canSign: false, role: role.toLowerCase(), signatures: [], archived: Boolean(contract.archivedAt),
        canReplace: role === 'COMPANY' && contract.environment === 'demo' && !contract.archivedAt && !contract.revokedAt && !contract.signedAt && !contract.companySignedAt && !contract.boosterSignedAt };
    assertNative(contract);
    if (!contract.archivedAt) assertOpen(contract);
    if (role === 'BOOSTER' && !contract.companySignedAt) fail(403, 'FastBoost must complete and sign the agreement before the booster can review it.');
    const signatures = await signaturesFor(db, contract.id);
    const prepared = Boolean(contract.nativePreparedAt);
    if (prepared) verifyFrozen(contract);
    const canSign = prepared && !contract.archivedAt && !contract.signedAt && !signatures.some(value => value.role === role)
        && (role === 'COMPANY' || Boolean(contract.companySignedAt));
    return { ok: true, contract: publicContract(contract), html: agreement.renderHtml(contract.nativeSnapshot, signatures),
        fields: contract.nativeSnapshot.commercialFields || agreement.commercialFields(), values: contract.nativeSnapshot.values,
        documentHash: contract.nativeDocumentHash || null, prepared, canSign, role: role.toLowerCase(), archived: Boolean(contract.archivedAt),
        signatures: signatures.map(publicSignature), consentText: CONSENT_TEXT,
        challenge: canSign ? challengeFor(contract, current, role) : null };
}
async function lockedContract(tx, id) {
    // The fixed statement uses a bound parameter. Serializes prepare, sign and replacement.
    await tx.$queryRawUnsafe('SELECT "id" FROM "BoosterContract" WHERE "id" = $1 FOR UPDATE', id);
    const contract = await tx.boosterContract.findUnique({ where: { id } });
    if (!contract) fail(404, 'Contract not found.');
    return contract;
}
async function lockedActor(tx, actor) {
    if (!actor?.id) fail(403, 'Your account cannot sign this agreement.');
    await tx.$queryRawUnsafe('SELECT "id" FROM "User" WHERE "id" = $1 FOR UPDATE', actor.id);
    return activeActor(tx, actor);
}
async function prepareContract(db, id, actor, values) {
    const contract = await db.$transaction(async tx => {
        const current = await lockedContract(tx, id);
        const signer = await lockedActor(tx, actor);
        assertNative(current); assertOpen(current);
        if (roleFor(current, signer) !== 'COMPANY') fail(403, 'Only the assigned FastBoost signer can prepare this agreement.');
        if (current.signedAt || current.companySignedAt || (await signaturesFor(tx, id)).length) fail(409, 'Signed agreement terms cannot be changed. Issue a replacement agreement.');
        const normalized = agreement.validateValues(values);
        const snapshot = { ...current.nativeSnapshot, values: { ...current.nativeSnapshot.values, ...normalized } };
        const hash = agreement.snapshotHash(snapshot);
        if (current.nativePreparedAt && hash === current.nativeDocumentHash) { verifyFrozen(current); return current; }
        const pdf = await agreement.renderPdf(snapshot);
        if (!Buffer.isBuffer(pdf) || pdf.subarray(0, 5).toString() !== '%PDF-') fail(503, 'The agreement PDF could not be prepared.');
        return tx.boosterContract.update({ where: { id }, data: { nativeSnapshot: snapshot, nativeDocumentHash: hash,
            nativePreparedAt: new Date(), nativePdf: pdf, nativePdfHash: digest(pdf) } });
    }, { timeout: 20000 });
    return signingContext(db, contract, actor);
}
function normalizeSignature(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail(400, 'Choose a typed or drawn signature.');
    if (value.type === 'typed' && Object.keys(value).every(key => key === 'type')) return { type: 'typed' };
    if (value.type !== 'drawn' || value.width !== 600 || value.height !== 180 || !Array.isArray(value.strokes)
        || !value.strokes.length || value.strokes.length > 100 || Object.keys(value).some(key => !['type', 'width', 'height', 'strokes'].includes(key))) fail(400, 'Draw your signature within the signature box.');
    let points = 0, distance = 0;
    for (const stroke of value.strokes) {
        if (!Array.isArray(stroke) || !stroke.length) fail(400, 'Draw your signature within the signature box.');
        points += stroke.length;
        if (points > 6000) fail(400, 'The drawn signature is too large. Clear it and sign again.');
        for (let index = 0; index < stroke.length; index++) {
            const point = stroke[index];
            if (!Array.isArray(point) || point.length !== 2 || point.some(coordinate => typeof coordinate !== 'number' || !Number.isFinite(coordinate))
                || point[0] < 0 || point[0] > 600 || point[1] < 0 || point[1] > 180) fail(400, 'Draw your signature within the signature box.');
            if (index) distance += Math.hypot(point[0] - stroke[index - 1][0], point[1] - stroke[index - 1][1]);
        }
    }
    if (distance < 8) fail(400, 'Draw your signature before continuing.');
    return { type: 'drawn', width: 600, height: 180, strokes: value.strokes.map(stroke => stroke.map(point => point.map(value => Math.round(value * 100) / 100))) };
}
function signingInput(body) {
    if (!body || typeof body !== 'object' || !UUID.test(body.requestId || '') || !HASH.test(body.documentHash || '')) fail(400, 'Refresh the agreement and try signing again.');
    if (body.consent !== true) fail(400, 'Confirm your agreement to electronic signing before signing.');
    const legalName = typeof body.legalName === 'string' ? body.legalName.trim() : '';
    const initials = typeof body.initials === 'string' ? body.initials.trim() : '';
    if (legalName.length < 2 || legalName.length > 100 || initials.length < 1 || initials.length > 16 || /[\u0000-\u001f\u007f]/.test(legalName + initials)) fail(400, 'Enter your full legal name and Schedule A initials.');
    const signature = normalizeSignature(body.signature);
    const payload = { requestId: body.requestId.toLowerCase(), documentHash: body.documentHash, legalName, initials, consent: true, signature };
    return { ...payload, requestHash: digest(JSON.stringify(payload)) };
}
function verifyChallenge(token, contract, actor, role) {
    let claims;
    try { claims = jwt.verify(token, secret(), { algorithms: ['HS256'], issuer: 'FastBoost', audience: 'contract-signing' }); }
    catch { fail(409, 'Your signing review has expired. Refresh and review the agreement again.'); }
    if (claims.purpose !== 'fastboost-contract-signature-v1' || claims.contractId !== contract.id || claims.actorId !== actor.id
        || claims.role !== role || claims.documentHash !== contract.nativeDocumentHash || claims.pdfHash !== contract.nativePdfHash
        || claims.consentVersion !== agreement.VERSION) fail(409, 'The agreement changed. Refresh and review it before signing.');
}
async function signContract(db, id, actor, body, audit = {}) {
    const input = signingInput(body);
    const contract = await db.$transaction(async tx => {
        const current = await lockedContract(tx, id);
        const signer = await lockedActor(tx, actor);
        assertNative(current);
        if (current.archivedAt) fail(409, 'This agreement is archived and is available for reference only.');
        const role = roleFor(current, signer);
        if (!role) fail(404, 'Contract not found.');
        const previous = await tx.nativeContractSignature.findUnique({ where: { contractId_requestId: { contractId: id, requestId: input.requestId } } });
        if (previous) {
            if (previous.actorId !== signer.id || previous.role !== role || previous.requestHash !== input.requestHash) fail(409, 'This signing request already belongs to a different signature.');
            return current;
        }
        assertOpen(current);
        if (current.signedAt) fail(409, 'This agreement has already been completed.');
        verifyFrozen(current);
        if (input.documentHash !== current.nativeDocumentHash) fail(409, 'The agreement changed. Refresh and review it before signing.');
        verifyChallenge(body.challenge, current, signer, role);
        const signatures = await signaturesFor(tx, id);
        if (signatures.some(value => value.role === role)) fail(409, 'Your signature has already been recorded.');
        if (role === 'BOOSTER' && (!current.companySignedAt || !signatures.some(value => value.role === 'COMPANY'))) fail(409, 'FastBoost must sign the completed agreement first.');
        const expectedName = role === 'COMPANY' ? current.companySignerName : current.signerName;
        if (!sameName(input.legalName, expectedName)) fail(400, 'Use the full legal name assigned to your signing invitation.');
        const signedAt = new Date();
        const signature = { contractId: id, role, actorId: signer.id, actorEmail: email(signer.email), legalName: input.legalName,
            initials: input.initials, consentText: CONSENT_TEXT, signature: input.signature, documentHash: input.documentHash,
            requestId: input.requestId, requestHash: input.requestHash, signedAt,
            clientIp: typeof audit.ip === 'string' ? audit.ip.slice(0, 128) : null,
            userAgent: typeof audit.userAgent === 'string' ? audit.userAgent.slice(0, 500) : null };
        const completed = role === 'BOOSTER';
        const pdf = await agreement.renderPdf(current.nativeSnapshot, [...signatures, signature], { completed });
        if (!Buffer.isBuffer(pdf) || pdf.subarray(0, 5).toString() !== '%PDF-') fail(503, 'The signed PDF could not be saved. Your signature was not recorded.');
        await tx.nativeContractSignature.create({ data: signature });
        const updated = await tx.boosterContract.update({ where: { id }, data: {
            [role === 'COMPANY' ? 'companySignedAt' : 'boosterSignedAt']: signedAt,
            nativePdf: pdf, nativePdfHash: digest(pdf), ...(completed && { signedAt, signedName: input.legalName,
                nativeCompletedAt: signedAt, status: 'completed' }),
        } });
        if (completed) {
            const startedAt = new Date(Math.max(new Date(current.startsAt).getTime(), signedAt.getTime()));
            await tx.boosterProfile.upsert({ where: { userId: current.boosterId }, create: { userId: current.boosterId, startedAt }, update: {} });
            await tx.boosterProfile.updateMany({ where: { userId: current.boosterId, startedAt: null }, data: { startedAt } });
            await tx.notification.updateMany({ where: { id: `contract-${id}`, userId: current.boosterId }, data: { read: true } });
            await tx.notification.updateMany({ where: { id: `contract-company-${id}` }, data: { read: true } });
        } else await tx.notification.updateMany({ where: { id: `contract-${id}`, userId: current.boosterId }, data: { title: 'Contract ready to sign', read: false } });
        return updated;
    }, { timeout: 20000 });
    return signingContext(db, contract, actor);
}
async function replaceLegacyContract(db, original, actor, requestId, verifyStatus) {
    if (!UUID.test(requestId || '')) fail(400, 'Choose a valid replacement request.');
    requestId = requestId.toLowerCase();
    const signer = await activeActor(db, actor);
    if (original.archivedAt) fail(409, 'Archived agreements are available for reference only.');
    if (native(original) || roleFor(original, signer) !== 'COMPANY' || original.environment !== 'demo') fail(409, 'Only the assigned signer can replace an unsigned sandbox agreement.');
    const existing = await db.boosterContract.findUnique({ where: { replacesContractId: original.id } });
    if (existing) {
        if (existing.id !== requestId || existing.issuedById !== signer.id) fail(409, 'A website agreement already replaces this document.');
        return existing;
    }
    if (original.revokedAt || original.signedAt || original.companySignedAt || original.boosterSignedAt || !original.envelopeId) fail(409, 'This agreement must be reconciled before creating a replacement.');
    agreement.assertAssets(); secret();
    let status;
    try { status = await verifyStatus(original); }
    catch { fail(409, 'The sandbox envelope could not be verified. Reconcile it in DocuSign before replacing it.'); }
    if (status.signedAt || status.companySignedAt || status.boosterSignedAt || !['sent', 'delivered', 'created'].includes(status.status)) fail(409, 'A signed or unresolved envelope cannot be replaced here.');
    const company = { id: signer.id, name: original.companySignerName, email: original.companySignerEmail };
    return db.$transaction(async tx => {
        const current = await lockedContract(tx, original.id);
        const currentSigner = await lockedActor(tx, signer);
        const retry = await tx.boosterContract.findUnique({ where: { replacesContractId: original.id } });
        if (retry) {
            if (retry.id !== requestId || retry.issuedById !== currentSigner.id) fail(409, 'A website agreement already replaces this document.');
            return retry;
        }
        if (roleFor(current, currentSigner) !== 'COMPANY' || current.archivedAt || current.revokedAt || current.signedAt || current.companySignedAt || current.boosterSignedAt) fail(409, 'This agreement changed. Refresh before creating a replacement.');
        const replacement = await issue(tx, { requestId, boosterId: current.boosterId, issuedById: signer.id,
            signerName: current.signerName, startsAt: new Date(current.startsAt).toISOString().slice(0, 10), replacesContractId: current.id }, company);
        await tx.boosterContract.update({ where: { id: current.id }, data: { revokedAt: new Date(), status: 'replaced' } });
        return replacement;
    }, { timeout: 20000 });
}

module.exports = { PROVIDER, CONSENT_TEXT, publicContract, readiness, createContract, signingContext, prepareContract, signContract, replaceLegacyContract, document };
