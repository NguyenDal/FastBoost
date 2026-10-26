const { createReadStream, createWriteStream } = require('node:fs');
const { open, readFile, rm } = require('node:fs/promises');
const { randomUUID } = require('node:crypto');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { readVideoDurationSeconds } = require('./videoDuration');

const BUCKET = process.env.AWS_S3_ASSETS_BUCKET || 'fastboost-assets';
const s3 = new S3Client({ region: process.env.AWS_REGION });
const MAX_HIGHLIGHT_BYTES = 100 * 1024 * 1024;
const MAX_THUMBNAIL_BYTES = 200 * 1024;
const VIDEO_TYPES = Object.freeze({ mp4: 'video/mp4', webm: 'video/webm' });

const badFile = () => Object.assign(new Error('Upload an MP4 or WebM video up to 100 MB.'), { status: 400 });

async function validateHighlightFile(file) {
    if (!file?.path || !Number.isInteger(file.size) || file.size < 12 || file.size > MAX_HIGHLIGHT_BYTES) throw badFile();
    const extension = String(file.originalname || '').split('.').pop().toLowerCase();
    const mimeType = VIDEO_TYPES[extension];
    if (!mimeType || mimeType !== file.mimetype) throw badFile();

    const handle = await open(file.path, 'r');
    let header;
    try {
        header = Buffer.alloc(16);
        const { bytesRead } = await handle.read(header, 0, header.length, 0);
        header = header.subarray(0, bytesRead);
    } finally { await handle.close(); }

    const isMp4 = extension === 'mp4' && header.length >= 12 && header.toString('ascii', 4, 8) === 'ftyp';
    const isWebm = extension === 'webm' && header.length >= 4 && header.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
    if (!isMp4 && !isWebm) throw badFile();
    return { mimeType, extension };
}

async function validateHighlightThumbnail(file) {
    const bad = () => { throw Object.assign(new Error('Choose a JPEG preview under 200 KB.'), { status: 400 }); };
    if (!file?.path || file.mimetype !== 'image/jpeg' || !Number.isInteger(file.size) ||
        file.size < 32 || file.size > MAX_THUMBNAIL_BYTES) bad();
    const data = await readFile(file.path);
    if (data[0] !== 0xff || data[1] !== 0xd8 || data[data.length - 2] !== 0xff || data[data.length - 1] !== 0xd9) bad();
    let position = 2;
    let dimensions;
    let hasScan = false;
    while (position + 4 < data.length) {
        if (data[position++] !== 0xff) bad();
        while (data[position] === 0xff) position++;
        const marker = data[position++];
        if (marker === 0xda) {
            if (position + 2 > data.length) bad();
            const scanHeaderSize = data.readUInt16BE(position);
            if (scanHeaderSize < 2 || position + scanHeaderSize + 2 >= data.length) bad();
            hasScan = true;
            break; // compressed scan data follows
        }
        if (marker === 0xd9) break;
        if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
        if (position + 2 > data.length) bad();
        const segmentSize = data.readUInt16BE(position);
        if (segmentSize < 2 || position + segmentSize > data.length) bad();
        if ((marker >= 0xc0 && marker <= 0xcf) && ![0xc4, 0xc8, 0xcc].includes(marker)) {
            if (segmentSize < 7) bad();
            dimensions = { height: data.readUInt16BE(position + 3), width: data.readUInt16BE(position + 5) };
        }
        position += segmentSize;
    }
    if (!hasScan || !dimensions || dimensions.width < 16 || dimensions.height < 16 ||
        dimensions.width > 1920 || dimensions.height > 1080) bad();
    return dimensions;
}

async function uploadHighlight({ orderId, file, mimeType, extension }) {
    // The order ID comes from a database record, never directly from the URL.
    const key = `order-highlights/${orderId}/${randomUUID()}.${extension}`;
    await s3.send(new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: createReadStream(file.path),
        ContentLength: file.size,
        ContentType: mimeType,
        ContentDisposition: 'inline',
        CacheControl: 'private, no-store',
    }));
    return key;
}

async function uploadHighlightThumbnail({ orderId, file }) {
    const key = `order-highlights/${orderId}/${randomUUID()}.jpg`;
    await s3.send(new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: createReadStream(file.path),
        ContentLength: file.size,
        ContentType: 'image/jpeg',
        ContentDisposition: 'inline',
        CacheControl: 'private, no-store',
    }));
    return key;
}

async function createHighlightViewUrl({ key, mimeType }) {
    if (!key?.startsWith('order-highlights/') || !Object.values(VIDEO_TYPES).includes(mimeType)) throw new Error('Invalid highlight storage record');
    return getSignedUrl(s3, new GetObjectCommand({
        Bucket: BUCKET,
        Key: key,
        ResponseContentType: mimeType,
        ResponseContentDisposition: 'inline',
        ResponseCacheControl: 'private, no-store',
    }), { expiresIn: 60 * 30 });
}

async function createHighlightThumbnailUrl(key) {
    if (!key?.startsWith('order-highlights/') || !key.endsWith('.jpg')) throw new Error('Invalid highlight thumbnail record');
    return getSignedUrl(s3, new GetObjectCommand({
        Bucket: BUCKET,
        Key: key,
        ResponseContentType: 'image/jpeg',
        ResponseContentDisposition: 'inline',
        ResponseCacheControl: 'private, no-store',
    }), { expiresIn: 60 * 5 });
}

async function inspectStoredHighlightDuration({ key, mimeType }) {
    if (!key?.startsWith('order-highlights/') || !Object.values(VIDEO_TYPES).includes(mimeType)) {
        throw new Error('Invalid highlight storage record');
    }
    // This is used only once for an old highlight without saved duration. Keep
    // the object private and bound the read to the same 100 MB upload limit.
    const path = join(tmpdir(), `fastboost-duration-${randomUUID()}`);
    const signal = AbortSignal.timeout(12000);
    try {
        const object = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }), { abortSignal: signal });
        if (!object.Body || !Number.isSafeInteger(object.ContentLength) || object.ContentLength < 12 || object.ContentLength > MAX_HIGHLIGHT_BYTES) {
            throw new Error('Stored highlight exceeds duration probe limit');
        }
        let received = 0;
        const limit = new Transform({ transform(chunk, encoding, callback) {
            received += chunk.length;
            callback(received > MAX_HIGHLIGHT_BYTES ? new Error('Stored highlight exceeds duration probe limit') : null, chunk);
        } });
        await pipeline(object.Body, limit, createWriteStream(path, { flags: 'wx', mode: 0o600 }), { signal });
        return await readVideoDurationSeconds(path, mimeType);
    } finally { await rm(path, { force: true }); }
}

async function removeHighlight(key) {
    if (!key?.startsWith('order-highlights/')) throw new Error('Invalid highlight storage key');
    await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
}

module.exports = { MAX_HIGHLIGHT_BYTES, MAX_THUMBNAIL_BYTES, validateHighlightFile, validateHighlightThumbnail,
    uploadHighlight, uploadHighlightThumbnail, createHighlightViewUrl, createHighlightThumbnailUrl,
    inspectStoredHighlightDuration, readVideoDurationSeconds, removeHighlight };
