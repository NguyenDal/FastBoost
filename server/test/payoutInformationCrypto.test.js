const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createVault } = require('../src/utils/payoutInformationCrypto');

function kms() {
    const keys = new Map();
    const commands = [];
    return { commands, async send(command) {
        commands.push(command);
        const input = command.input;
        if (command.constructor.name === 'GenerateDataKeyCommand') {
            const encrypted = crypto.randomBytes(48);
            const key = crypto.randomBytes(32);
            keys.set(encrypted.toString('hex'), { key, context: input.EncryptionContext });
            return { CiphertextBlob: encrypted, Plaintext: Buffer.from(key) };
        }
        const entry = keys.get(Buffer.from(input.CiphertextBlob).toString('hex'));
        assert.deepEqual(input.EncryptionContext, entry?.context);
        return { Plaintext: Buffer.from(entry.key) };
    } };
}
const identity = { id: '11111111-1111-4111-8111-111111111111', boosterId: 'provider', detailsRevision: 1 };
const details = { legalName: 'Test Person', accountNumber: '000001234567', routingNumber: '021000021', country: 'US', currency: 'USD' };

test('bank details use authenticated envelope encryption, random IVs and payout-specific KMS context', async () => {
    const client = kms();
    const vault = createVault({ client, keyId: 'test-key' });
    const encrypted = await vault.encrypt(details, identity);
    assert.equal(encrypted.version, 1);
    assert.equal(JSON.stringify(encrypted).includes(details.accountNumber), false);
    assert.deepEqual(await vault.decrypt(encrypted, identity), details);
    assert.equal(client.commands[0].input.EncryptionContext.purpose, 'fastboost-payout-information-v1');
    assert.equal(client.commands[0].input.EncryptionContext.requestId, identity.id);
    assert.equal(client.commands[0].input.EncryptionContext.revision, '1');
    assert.notEqual((await vault.encrypt(details, identity)).iv, encrypted.iv);
    assert.deepEqual(Object.keys(encrypted).sort(), ['ciphertext', 'iv', 'key', 'tag', 'version']);
});

test('tampering and moving encrypted data between people, requests or revisions fails closed', async () => {
    const client = kms();
    const vault = createVault({ client, keyId: 'test-key' });
    const encrypted = await vault.encrypt(details, identity);
    for (const change of [{ boosterId: 'other' }, { id: 'other' }, { detailsRevision: 2 }]) {
        await assert.rejects(vault.decrypt(encrypted, { ...identity, ...change }), error => error.status === 503 && !error.message.includes(details.accountNumber));
    }
    for (const key of ['ciphertext', 'tag', 'iv', 'key']) {
        const bytes = Buffer.from(encrypted[key], 'base64'); bytes[0] ^= 1;
        await assert.rejects(vault.decrypt({ ...encrypted, [key]: bytes.toString('base64') }, identity), error => error.status === 503);
    }
    await assert.rejects(vault.decrypt({ ...encrypted, extra: 'untrusted' }, identity), error => error.status === 503);
});

test('missing configuration and KMS outages have no plaintext fallback or sensitive error details', async () => {
    const absent = createVault({ client: kms(), keyId: '' });
    assert.equal(absent.configured(), false);
    await assert.rejects(absent.encrypt(details, identity), error => error.status === 503);
    const broken = createVault({ keyId: 'test-key', client: { send() { throw new Error(`secret: ${details.accountNumber}`); } } });
    await assert.rejects(broken.encrypt(details, identity), error => error.status === 503 && !error.message.includes(details.accountNumber));
});
