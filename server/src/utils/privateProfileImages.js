const { profileKeyFromValue, createProfileImageSignedUrl } = require('./s3Upload');

const AVATAR_FIELDS = new Set(['profileImageUrl', 'profileImage', 'senderAvatar', 'imageUrl']);

function safeExternalImageUrl(value) {
    if (typeof value !== 'string') return null;
    try {
        const url = new URL(value);
        if (url.protocol !== 'https:' || url.username || url.password) return null;
        // A malformed URL for our bucket must never escape as a bare S3 link.
        const bucket = (process.env.AWS_S3_ASSETS_BUCKET || 'fastboost-assets').toLowerCase();
        const host = url.hostname.toLowerCase();
        if (host.startsWith(`${bucket}.s3.`) || host.startsWith(`${bucket}.s3-`) ||
            ((host === 's3.amazonaws.com' || /^s3[.-][a-z0-9-]+\.amazonaws\.com$/.test(host)) &&
                url.pathname.startsWith(`/${bucket}/`))) return null;
        return url.href;
    } catch { return null; }
}

async function signedProfileImageUrl(value, signer = createProfileImageSignedUrl) {
    if (value == null || value === '') return value;
    const key = profileKeyFromValue(value);
    if (!key) return safeExternalImageUrl(value);
    try { return await signer(key); }
    catch (error) {
        console.error('Could not sign a private profile image', { code: error.code || 'SIGNING_FAILED' });
        return null;
    }
}

// Apply only to avatar fields in a response that is already authorized by its
// route. Preserve Date, Buffer, Decimal, and other non-plain values.
async function signProfileImages(value, signer = createProfileImageSignedUrl) {
    const cache = new Map();
    async function imageUrl(raw) {
        if (typeof raw !== 'string') return raw;
        if (!cache.has(raw)) cache.set(raw, signedProfileImageUrl(raw, signer));
        return cache.get(raw);
    }
    async function walk(current) {
        if (Array.isArray(current)) return Promise.all(current.map(walk));
        if (!current || typeof current !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(current))) return current;
        const result = {};
        await Promise.all(Object.entries(current).map(async ([key, item]) => {
            result[key] = AVATAR_FIELDS.has(key) ? await imageUrl(item) : await walk(item);
        }));
        return result;
    }
    return walk(value);
}

module.exports = { safeExternalImageUrl, signedProfileImageUrl, signProfileImages };
