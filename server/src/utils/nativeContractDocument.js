const { createHash } = require('node:crypto');
const agreement = require('./nativeAgreement');

const digest = value => createHash('sha256').update(value).digest('hex');
const unavailable = () => Object.assign(new Error('The saved agreement and its signatures could not be verified. Refresh and try again.'), { status: 503 });
const timestamp = value => value == null ? NaN : new Date(value).getTime();

// This is a display copy, not a replacement for the accepted snapshot, retained
// signing PDF, or signature audit records. Keep those original records intact.
async function presentationDocument(contract, signatures, render = agreement.renderPresentationPdf) {
    if (contract?.signingProvider !== 'FASTBOOST' || !contract.nativeSnapshot || !contract.nativePreparedAt
        || !contract.nativeDocumentHash || !contract.nativePdf || !contract.nativePdfHash) throw unavailable();
    const originalPdf = Buffer.from(contract.nativePdf);
    if (originalPdf.subarray(0, 5).toString() !== '%PDF-' || digest(originalPdf) !== contract.nativePdfHash
        || agreement.snapshotHash(contract.nativeSnapshot) !== contract.nativeDocumentHash || !Array.isArray(signatures)) throw unavailable();

    const expected = { COMPANY: contract.companySignedAt, BOOSTER: contract.boosterSignedAt };
    const roles = new Set();
    for (const signature of signatures) {
        if (!signature || !Object.hasOwn(expected, signature.role) || roles.has(signature.role)
            || signature.contractId !== contract.id || signature.documentHash !== contract.nativeDocumentHash
            || !expected[signature.role] || !Number.isFinite(timestamp(signature.signedAt))
            || timestamp(signature.signedAt) !== timestamp(expected[signature.role])
            || typeof signature.legalName !== 'string' || !signature.legalName.trim()
            || !['typed', 'drawn'].includes(signature.signature?.type)) throw unavailable();
        roles.add(signature.role);
    }
    for (const [role, signedAt] of Object.entries(expected)) {
        if (Boolean(signedAt) !== roles.has(role)) throw unavailable();
    }
    const completed = Boolean(contract.signedAt);
    if (completed !== Boolean(contract.nativeCompletedAt) || completed !== (roles.size === 2)
        || (completed && (!Number.isFinite(timestamp(contract.signedAt))
            || timestamp(contract.signedAt) !== timestamp(contract.nativeCompletedAt)
            || timestamp(contract.signedAt) !== Math.max(...signatures.map(signature => timestamp(signature.signedAt)))))) throw unavailable();

    // Copies ensure a renderer can never change the caller's retained evidence.
    const pdf = await render(structuredClone(contract.nativeSnapshot), structuredClone(signatures), { completed });
    if (!Buffer.isBuffer(pdf) || pdf.subarray(0, 5).toString() !== '%PDF-') throw unavailable();
    return pdf;
}

module.exports = { presentationDocument };
