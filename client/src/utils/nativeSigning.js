export function agreementSigningPath(id) {
    return `/provider/contracts/${encodeURIComponent(id)}/sign`;
}

export function signingValuesMatch(values, acceptedValues) {
    const keys = Object.keys(values || {}).sort();
    return keys.length === Object.keys(acceptedValues || {}).length
        && keys.every(key => String(values[key] ?? '') === String(acceptedValues[key] ?? ''));
}

export function hasDrawnSignature(signature) {
    return signature?.type === 'drawn' && signature.strokes?.some(stroke => stroke.length > 1);
}

export function signatureMissingRequirements({ legalName, initials, signature, consent }) {
    return [
        legalName.trim().length < 2 && 'legalName',
        !initials.trim() && 'initials',
        signature.type === 'drawn' && !hasDrawnSignature(signature) && 'signature',
        !consent && 'consent',
    ].filter(Boolean);
}

export function signatureSubmission({ context, legalName, initials, signature, consent }, previous, uuid = () => crypto.randomUUID()) {
    if (!context?.documentHash || !context.challenge || !consent) throw new Error('Review the agreement and accept electronic signing first.');
    const details = {
        documentHash: context.documentHash, legalName: legalName.trim(), initials: initials.trim(), consent: true, signature,
    };
    if (!details.legalName || !details.initials || (signature.type === 'drawn' && !hasDrawnSignature(signature))) throw new Error('Enter your legal name, initials and signature.');
    // A lost response retries the original body, including its request ID and
    // challenge. Refreshing the page's challenge must not create another intent.
    const fingerprint = JSON.stringify(details);
    if (previous?.fingerprint === fingerprint) return previous;
    return { fingerprint, body: { ...details, challenge: context.challenge, requestId: uuid() } };
}
