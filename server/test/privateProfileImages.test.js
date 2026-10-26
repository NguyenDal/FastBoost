const test = require('node:test');
const assert = require('node:assert/strict');
const { profileKeyFromValue } = require('../src/utils/s3Upload');
const { signedProfileImageUrl, signProfileImages } = require('../src/utils/privateProfileImages');

const bucket = process.env.AWS_S3_ASSETS_BUCKET || 'fastboost-assets';
const key = 'profiles/user123/1730000000000-a1b2c3d4.png';

test('canonical and legacy global/regional S3 URLs resolve to one private profile key', () => {
    for (const value of [
        key,
        `https://${bucket}.s3.amazonaws.com/${key}`,
        `https://${bucket}.s3.us-east-1.amazonaws.com/${key}`,
        `https://${bucket}.s3-us-west-2.amazonaws.com/${key}?old=1`,
        `https://s3.amazonaws.com/${bucket}/${key}`,
        `https://s3.ca-central-1.amazonaws.com/${bucket}/${key}`,
        `https://${bucket}.s3.amazonaws.com/profiles%2Fuser123%2F1730000000000-a1b2c3d4.png`,
    ]) assert.equal(profileKeyFromValue(value), key, value);
    for (const value of [
        `https://other-bucket.s3.amazonaws.com/${key}`,
        `https://${bucket}.s3.amazonaws.com/profiles/user123/../secret.png`,
        `https://${bucket}.s3.amazonaws.com/chat-attachments/user123/attachment.png`,
        'profiles/user123/payload.svg',
        'profiles/../payload.png',
        `https://attacker.example.test/${key}`,
    ]) assert.equal(profileKeyFromValue(value), null, value);
});

test('nested authorized avatar responses sign private keys, preserve safe external images, and reject unsafe URLs', async () => {
    const signed = [];
    const signer = async value => { signed.push(value); return `https://signed.example.test/${value}?token=short`; };
    const moment = new Date('2026-10-25T20:00:00Z');
    const input = { user: { profile: { profileImageUrl: key }, profileImage: key },
        messages: [{ sender: { profile: { profileImageUrl: `https://${bucket}.s3.us-east-1.amazonaws.com/${key}` } } },
            { data: { senderAvatar: 'https://cdn.example.test/legacy.png' } }],
        bad: { profileImageUrl: 'javascript:alert(1)', imageUrl: `https://${bucket}.s3.amazonaws.com/profiles/wrong.txt` },
        createdAt: moment };
    const output = await signProfileImages(input, signer);
    assert.match(output.user.profile.profileImageUrl, /token=short$/);
    assert.equal(output.user.profileImage, output.user.profile.profileImageUrl);
    assert.equal(output.messages[0].sender.profile.profileImageUrl, output.user.profileImageUrl || output.user.profile.profileImageUrl);
    assert.equal(output.messages[1].data.senderAvatar, 'https://cdn.example.test/legacy.png');
    assert.equal(output.bad.profileImageUrl, null);
    assert.equal(output.bad.imageUrl, null);
    assert.equal(output.createdAt, moment);
    assert.equal(signed.every(item => item === key), true);
    assert.equal(signed.length, 2, 'duplicate raw keys share one signature within a response');
    assert.equal(input.user.profile.profileImageUrl, key, 'database objects are not mutated');
    assert.equal(await signedProfileImageUrl('http://cdn.example.test/avatar.png', signer), null);
});

test('profile and chat uploads return keys only; avatar GET is signed for 15 minutes with private cache headers', async t => {
    const commands = [], signatures = [];
    class Command { constructor(input) { this.input = input; } }
    class FakeS3 { async send(command) { commands.push(command.input); } }
    const target = require.resolve('../src/utils/s3Upload');
    const s3Path = require.resolve('@aws-sdk/client-s3');
    const signPath = require.resolve('@aws-sdk/s3-request-presigner');
    const saved = [[target, require.cache[target]], [s3Path, require.cache[s3Path]], [signPath, require.cache[signPath]]];
    delete require.cache[target];
    require.cache[s3Path] = { exports: { S3Client: FakeS3, PutObjectCommand: Command, GetObjectCommand: Command } };
    require.cache[signPath] = { exports: { getSignedUrl: async (_client, command, options) => {
        signatures.push({ input: command.input, options }); return 'https://signed.example.test/avatar';
    } } };
    t.after(() => { for (const [path, previous] of saved) { if (previous) require.cache[path] = previous; else delete require.cache[path]; } });
    const storage = require(target);
    const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
    const avatar = await storage.uploadProfileImageToS3({ userId: 'user123', file: { buffer: png, mimetype: 'image/png' } });
    assert.match(avatar.key, /^profiles\/user123\/.+\.png$/);
    assert.equal(avatar.url, undefined);
    assert.equal(commands[0].CacheControl, 'private, no-store');
    assert.equal(commands[0].ContentType, 'image/png');
    await storage.createProfileImageSignedUrl(avatar.key);
    assert.equal(signatures[0].options.expiresIn, 15 * 60);
    assert.equal(signatures[0].input.ResponseCacheControl, 'private, no-store');
    assert.equal(signatures[0].input.ResponseContentType, 'image/png');
    const attachment = await storage.uploadChatAttachmentToS3({ conversationId: 'chat', userId: 'user123',
        file: { originalname: 'proof.pdf', mimetype: 'application/pdf', buffer: Buffer.from('safe') } });
    assert.match(attachment.key, /^chat-attachments\/chat\/user123\//);
    assert.equal(attachment.url, undefined);
    assert.equal(commands[1].ContentDisposition, 'attachment');
});

test('account updates preserve the same signed image, reject arbitrary URLs, and allow clearing or uploading', async t => {
    const dbPath = require.resolve('../src/prisma');
    const s3Path = require.resolve('../src/utils/s3Upload');
    const imagePath = require.resolve('../src/utils/privateProfileImages');
    const controllerPath = require.resolve('../src/controllers/userController');
    const saved = [dbPath, s3Path, imagePath, controllerPath].map(path => [path, require.cache[path]]);
    const state = { user: { id: 'user123', email: 'owner@example.test', username: 'owner', role: 'CUSTOMER',
        passwordHash: 'hash', suspendedAt: null, profile: { profileImageUrl: `https://${bucket}.s3.amazonaws.com/${key}` } } };
    const db = { user: {
        findUnique: async () => structuredClone(state.user),
        findFirst: async () => null,
        updateMany: async () => ({ count: 1 }),
        update: async ({ data }) => {
            const image = data.profile?.upsert?.update?.profileImageUrl;
            if (data.profile?.upsert) state.user.profile.profileImageUrl = image;
            if (data.username) state.user.username = data.username;
            if (data.email) state.user.email = data.email;
            return { ...structuredClone(state.user), _count: { referrals: 0 } };
        },
    }, $transaction: fn => fn(db), passwordResetToken: { deleteMany: async () => {} }, verificationCode: { deleteMany: async () => {} } };
    require.cache[dbPath] = { exports: db };
    require.cache[s3Path] = { exports: { profileKeyFromValue, uploadProfileImageToS3: async () => ({ key: 'profiles/user123/new.png' }) } };
    require.cache[imagePath] = { exports: { signProfileImages: value => signProfileImages(value, async imageKey => `https://${bucket}.s3.amazonaws.com/${imageKey}?X-Amz-Signature=short`),
        safeExternalImageUrl: require('../src/utils/privateProfileImages').safeExternalImageUrl } };
    delete require.cache[controllerPath];
    t.after(() => { for (const [path, previous] of saved) { if (previous) require.cache[path] = previous; else delete require.cache[path]; } });
    const controller = require(controllerPath);
    const response = () => ({ code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });
    const request = (profileImageUrl, extra = {}) => ({ user: { userId: 'user123' }, body: { username: 'owner', email: 'owner@example.test', profileImageUrl, ...extra } });

    const before = response(); await controller.me({ user: { userId: 'user123' } }, before);
    assert.equal(before.code, 200);
    const displayed = before.body.user.profile.profileImageUrl;
    assert.match(displayed, /X-Amz-Signature=short/);
    assert.equal(before.body.user.profileImage, displayed);
    const unchanged = response(); await controller.updateMyAccount(request(displayed), unchanged);
    assert.equal(unchanged.code, 200, JSON.stringify(unchanged.body));
    assert.equal(state.user.profile.profileImageUrl, key, 'legacy S3 URL is stored as a canonical key');
    const arbitrary = response(); await controller.updateMyAccount(request('https://attacker.example.test/tracker.png'), arbitrary);
    assert.equal(arbitrary.code, 400);
    assert.equal(state.user.profile.profileImageUrl, key);
    const cleared = response(); await controller.updateMyAccount(request(''), cleared);
    assert.equal(cleared.code, 200);
    assert.equal(state.user.profile.profileImageUrl, null);
    const uploaded = response(); await controller.uploadMyProfilePicture({ user: { userId: 'user123' }, file: { buffer: Buffer.from('image') } }, uploaded);
    assert.equal(uploaded.code, 200);
    assert.equal(state.user.profile.profileImageUrl, 'profiles/user123/new.png');
    assert.match(uploaded.body.imageUrl, /X-Amz-Signature=short/);
    assert.equal(uploaded.body.user.profile.profileImageUrl, uploaded.body.imageUrl);
});
