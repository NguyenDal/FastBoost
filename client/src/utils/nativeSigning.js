import { resolveUserTimeZone } from './userTimeZone.js';

export function agreementSigningPath(id) {
    return `/provider/contracts/${encodeURIComponent(id)}/sign`;
}

export function formatLocalSignatureTime(value, language = 'en', timeZone) {
    const date = new Date(value);
    if (!value || !Number.isFinite(date.getTime())) return null;
    return new Intl.DateTimeFormat(language === 'vi' ? 'vi-VN' : 'en-US', {
        year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
        timeZone: resolveUserTimeZone(timeZone),
    }).format(date);
}

export function signingValuesMatch(values, acceptedValues) {
    const keys = Object.keys(values || {}).sort();
    return keys.length === Object.keys(acceptedValues || {}).length
        && keys.every(key => String(values[key] ?? '') === String(acceptedValues[key] ?? ''));
}

export function hasDrawnSignature(signature) {
    return signature?.type === 'drawn' && signature.strokes?.some(stroke => stroke.length > 1);
}

export function signatureMissingRequirements({ legalName, signature = { type: 'typed' } }) {
    return [legalName.trim().length < 2 && 'legalName', signature.type === 'drawn' && !hasDrawnSignature(signature) && 'signature'].filter(Boolean);
}

export function signatureSubmission({ context, legalName, signature = { type: 'typed' }, consent }, previous, uuid = () => crypto.randomUUID()) {
    if (!context?.documentHash || !context.challenge || !consent) throw new Error('Review the agreement and accept electronic signing first.');
    if (signature.type !== 'drawn' && signature.style !== undefined && ![1, 2, 3].includes(signature.style)) throw new Error('Choose a signature style.');
    const mark = signature.type === 'drawn'
        ? { type: 'drawn', width: signature.width, height: signature.height, strokes: signature.strokes }
        : { type: 'typed', ...(signature.style !== undefined ? { style: signature.style } : {}) };
    const details = {
        documentHash: context.documentHash, legalName: legalName.trim(), consent: true, signature: mark,
    };
    if (details.legalName.length < 2 || details.legalName.length > 100) throw new Error('Enter your full legal name.');
    if (signature.type === 'drawn' && !hasDrawnSignature(signature)) throw new Error('Draw your signature before signing.');
    // A lost response retries the original body, including its request ID and
    // challenge. Refreshing the page's challenge must not create another intent.
    const fingerprint = JSON.stringify(details);
    if (previous?.fingerprint === fingerprint) return previous;
    return { fingerprint, body: { ...details, challenge: context.challenge, requestId: uuid() } };
}
