const crypto = require('node:crypto');
const { KMSClient, GenerateDataKeyCommand, DecryptCommand } = require('@aws-sdk/client-kms');

const unavailable = () => Object.assign(new Error('Bank details are temporarily unavailable. Please try again later.'), { status: 503 });
function binding({ id, boosterId, detailsRevision }) {
    if (typeof id !== 'string' || !id || typeof boosterId !== 'string' || !boosterId || !Number.isSafeInteger(detailsRevision) || detailsRevision < 1) throw unavailable();
    return { purpose: 'fastboost-payout-information-v1', requestId: id, boosterId, revision: String(detailsRevision) };
}
function decode(value, length) {
    if (typeof value !== 'string' || !value || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw unavailable();
    const bytes = Buffer.from(value, 'base64');
    if (bytes.toString('base64') !== value || (length && bytes.length !== length)) throw unavailable();
    return bytes;
}
function createVault({ client, keyId }) {
    return {
        configured: () => Boolean(keyId),
        async encrypt(details, identity) {
            if (!keyId) throw unavailable();
            let plaintextKey;
            try {
                const context = binding(identity);
                const key = await client.send(new GenerateDataKeyCommand({ KeyId: keyId, KeySpec: 'AES_256', EncryptionContext: context }));
                plaintextKey = key.Plaintext && Buffer.from(key.Plaintext);
                if (key.Plaintext instanceof Uint8Array) key.Plaintext.fill(0);
                if (!plaintextKey || plaintextKey.length !== 32 || !key.CiphertextBlob?.length) throw unavailable();
                const iv = crypto.randomBytes(12);
                const cipher = crypto.createCipheriv('aes-256-gcm', plaintextKey, iv);
                cipher.setAAD(Buffer.from(JSON.stringify(context)));
                const ciphertext = Buffer.concat([cipher.update(JSON.stringify(details), 'utf8'), cipher.final()]);
                return { version: 1, key: Buffer.from(key.CiphertextBlob).toString('base64'), iv: iv.toString('base64'),
                    tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') };
            } catch { throw unavailable(); }
            finally { plaintextKey?.fill(0); }
        },
        async decrypt(envelope, identity) {
            let plaintextKey;
            try {
                if (!keyId || envelope?.version !== 1 || Object.keys(envelope).some(key => !['version', 'key', 'iv', 'tag', 'ciphertext'].includes(key))) throw unavailable();
                const context = binding(identity);
                const key = await client.send(new DecryptCommand({ CiphertextBlob: decode(envelope.key), EncryptionContext: context }));
                plaintextKey = key.Plaintext && Buffer.from(key.Plaintext);
                if (key.Plaintext instanceof Uint8Array) key.Plaintext.fill(0);
                if (!plaintextKey || plaintextKey.length !== 32) throw unavailable();
                const decipher = crypto.createDecipheriv('aes-256-gcm', plaintextKey, decode(envelope.iv, 12));
                decipher.setAAD(Buffer.from(JSON.stringify(context)));
                decipher.setAuthTag(decode(envelope.tag, 16));
                return JSON.parse(Buffer.concat([decipher.update(decode(envelope.ciphertext)), decipher.final()]).toString('utf8'));
            } catch { throw unavailable(); }
            finally { plaintextKey?.fill(0); }
        },
    };
}
let defaultVault;
function getVault() {
    if (!defaultVault) {
        const { env } = require('../config/env');
        defaultVault = createVault({ client: new KMSClient({ region: env.awsRegion }),
            keyId: process.env.PAYOUT_INFORMATION_KMS_KEY_ID?.trim() || env.orderPasswordKmsKeyId });
    }
    return defaultVault;
}
module.exports = { createVault, getVault };
