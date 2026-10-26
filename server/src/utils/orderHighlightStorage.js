const { createReadStream } = require('node:fs');
const { open } = require('node:fs/promises');
const { randomUUID } = require('node:crypto');
const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const BUCKET = process.env.AWS_S3_ASSETS_BUCKET || 'fastboost-assets';
const s3 = new S3Client({ region: process.env.AWS_REGION });
const MAX_HIGHLIGHT_BYTES = 100 * 1024 * 1024;
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

async function removeHighlight(key) {
    if (!key?.startsWith('order-highlights/')) throw new Error('Invalid highlight storage key');
    await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
}

module.exports = { MAX_HIGHLIGHT_BYTES, validateHighlightFile, uploadHighlight, createHighlightViewUrl, removeHighlight };
