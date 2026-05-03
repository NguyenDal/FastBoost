const crypto = require("crypto");
const {
    KMSClient,
    GenerateDataKeyCommand,
    DecryptCommand,
} = require("@aws-sdk/client-kms");
const { env } = require("../config/env");

const kmsClient = new KMSClient({
    region: env.awsRegion,
});

const ENCRYPTION_ALGORITHM = "aes-256-gcm";
const IV_LENGTH_BYTES = 12;
const KEY_SPEC = "AES_256";
const ENCODING = "base64";

function hasEncryptedPasswordFields(order) {
    return Boolean(
        order?.accountPasswordCiphertext &&
        order?.accountPasswordEncryptedKey &&
        order?.accountPasswordIv &&
        order?.accountPasswordAuthTag
    );
}

async function encryptOrderPassword(plainPassword) {
    if (!plainPassword || typeof plainPassword !== "string") {
        return null;
    }

    const trimmedPassword = plainPassword.trim();

    if (!trimmedPassword) {
        return null;
    }

    const dataKeyResponse = await kmsClient.send(
        new GenerateDataKeyCommand({
            KeyId: env.orderPasswordKmsKeyId,
            KeySpec: KEY_SPEC,
        })
    );

    const plaintextDataKey = dataKeyResponse.Plaintext;
    const encryptedDataKey = dataKeyResponse.CiphertextBlob;

    if (!plaintextDataKey || !encryptedDataKey) {
        throw new Error("AWS KMS did not return a valid data key.");
    }

    try {
        const iv = crypto.randomBytes(IV_LENGTH_BYTES);
        const cipher = crypto.createCipheriv(
            ENCRYPTION_ALGORITHM,
            plaintextDataKey,
            iv
        );

        const ciphertext = Buffer.concat([
            cipher.update(trimmedPassword, "utf8"),
            cipher.final(),
        ]);

        const authTag = cipher.getAuthTag();

        return {
            accountPasswordCiphertext: ciphertext.toString(ENCODING),
            accountPasswordEncryptedKey: Buffer.from(encryptedDataKey).toString(
                ENCODING
            ),
            accountPasswordIv: iv.toString(ENCODING),
            accountPasswordAuthTag: authTag.toString(ENCODING),
            accountPasswordUpdatedAt: new Date(),
        };
    } finally {
        // Best-effort cleanup of plaintext key material from memory.
        if (Buffer.isBuffer(plaintextDataKey)) {
            plaintextDataKey.fill(0);
        }
    }
}

async function decryptOrderPassword(order) {
    if (!hasEncryptedPasswordFields(order)) {
        return null;
    }

    const decryptResponse = await kmsClient.send(
        new DecryptCommand({
            CiphertextBlob: Buffer.from(
                order.accountPasswordEncryptedKey,
                ENCODING
            ),
        })
    );

    const plaintextDataKey = decryptResponse.Plaintext;

    if (!plaintextDataKey) {
        throw new Error("AWS KMS could not decrypt the order password data key.");
    }

    try {
        const decipher = crypto.createDecipheriv(
            ENCRYPTION_ALGORITHM,
            plaintextDataKey,
            Buffer.from(order.accountPasswordIv, ENCODING)
        );

        decipher.setAuthTag(Buffer.from(order.accountPasswordAuthTag, ENCODING));

        const decrypted = Buffer.concat([
            decipher.update(Buffer.from(order.accountPasswordCiphertext, ENCODING)),
            decipher.final(),
        ]);

        return decrypted.toString("utf8");
    } finally {
        // Best-effort cleanup of plaintext key material from memory.
        if (Buffer.isBuffer(plaintextDataKey)) {
            plaintextDataKey.fill(0);
        }
    }
}

function stripEncryptedPasswordFields(order) {
    if (!order) return order;

    const {
        accountPasswordCiphertext,
        accountPasswordEncryptedKey,
        accountPasswordIv,
        accountPasswordAuthTag,
        ...safeOrder
    } = order;

    return safeOrder;
}

module.exports = {
    encryptOrderPassword,
    decryptOrderPassword,
    hasEncryptedPasswordFields,
    stripEncryptedPasswordFields,
};