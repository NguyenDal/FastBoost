const express = require('express');
const multer = require('multer');
const { randomUUID } = require('node:crypto');
const { tmpdir } = require('node:os');
const { rm } = require('node:fs/promises');
const db = require('../prisma');
const highlightStorage = require('../utils/orderHighlightStorage');
const { createProtect } = require('../middleware/authMiddleware');
const { createRateLimit } = require('../middleware/rateLimit');
const { canBoost } = require('../utils/boosterAccess');

const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const handle = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const publicSelect = { id: true, title: true, mimeType: true, byteSize: true,
    durationSeconds: true, thumbnailKey: true, createdAt: true, uploaderName: true };
const publicHighlight = row => ({ id: row.id, title: row.title, mimeType: row.mimeType,
    byteSize: row.byteSize, durationSeconds: row.durationSeconds ?? null,
    hasThumbnail: Boolean(row.thumbnailKey), createdAt: row.createdAt, uploader: { username: row.uploaderName } });
const paidAndActive = order => order.paymentStatus === 'PAID' && order.status !== 'CANCELLED';

async function orderAccess(client, userId, orderId) {
    if (!userId) fail(401, 'Sign in to view highlights.');
    if (!orderId || orderId.length > 128) fail(404, 'Order not found.');
    const [actor, order] = await Promise.all([
        client.user.findUnique({ where: { id: userId }, select: { id: true, username: true, role: true, hasBoosterAccess: true, suspendedAt: true } }),
        client.order.findUnique({ where: { id: orderId }, select: { id: true, customerId: true, paymentStatus: true, status: true } }),
    ]);
    if (!actor || actor.suspendedAt || !order) fail(404, 'Order not found.');
    const admin = actor.role === 'ADMIN';
    const owner = order.customerId === actor.id;
    const assigned = !admin && canBoost(actor) && Boolean(await client.orderAssignment.findFirst({
        where: { orderId: order.id, boosterId: actor.id }, select: { id: true },
    }));
    if (!admin && !owner && !assigned) fail(404, 'Order not found.');
    return { actor, order, canUpload: (admin || assigned) && paidAndActive(order) };
}

async function cleanUploadedFile(file) {
    if (file?.path) await rm(file.path, { force: true });
}

async function removeOrphan(storage, key) {
    let lastError;
    for (let attempt = 0; attempt < 3; attempt++) {
        try { await storage.removeHighlight(key); return; }
        catch (error) { lastError = error; }
    }
    console.error('Unable to remove an uncommitted order highlight from storage', { key, error: lastError });
    fail(503, 'The upload could not be completed. Please contact support if this persists.');
}

function createOrderHighlightRouter(client = db, storage = highlightStorage) {
    const router = express.Router();
    const protect = createProtect(client);
    const uploadLimit = createRateLimit({ limit: 6, windowMs: 60 * 60 * 1000,
        key: req => req.user.userId || req.user.id,
        message: 'Please wait before uploading another highlight.' });
    const thumbnailLimit = createRateLimit({ limit: 12, windowMs: 60 * 60 * 1000,
        key: req => req.user.userId || req.user.id,
        message: 'Please wait before adding another highlight preview.' });
    const upload = multer({
        storage: multer.diskStorage({ destination: tmpdir(), filename: (req, file, callback) => callback(null, `fastboost-highlight-${randomUUID()}`) }),
        limits: { fileSize: storage.MAX_HIGHLIGHT_BYTES || highlightStorage.MAX_HIGHLIGHT_BYTES, files: 1, fields: 1, fieldSize: 2048 },
    });
    const thumbnailUpload = multer({
        storage: multer.diskStorage({ destination: tmpdir(), filename: (req, file, callback) => callback(null, `fastboost-thumbnail-${randomUUID()}`) }),
        limits: { fileSize: storage.MAX_THUMBNAIL_BYTES || highlightStorage.MAX_THUMBNAIL_BYTES,
            files: 1, fields: 0, parts: 1 },
    });

    router.get('/:orderId/highlights', protect, handle(async (req, res) => {
        res.set('Cache-Control', 'private, no-store');
        const { canUpload } = await orderAccess(client, req.user.userId || req.user.id, req.params.orderId);
        const highlights = await client.orderHighlight.findMany({ where: { orderId: req.params.orderId },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            select: { ...publicSelect, s3Key: true, durationProbedAt: true } });
        // Older uploads predate duration storage. Inspect only two per request
        // so a long order does not trigger an unbounded set of private S3 reads.
        await Promise.all(highlights.filter(row => !row.durationProbedAt).slice(0, 2).map(async row => {
            try {
                const durationSeconds = await storage.inspectStoredHighlightDuration({ key: row.s3Key, mimeType: row.mimeType });
                await client.orderHighlight.updateMany({ where: { id: row.id, durationProbedAt: null },
                    data: { durationSeconds, durationProbedAt: new Date() } });
                row.durationSeconds = durationSeconds;
            } catch (error) {
                // Playback and the list remain usable if legacy metadata cannot
                // be retrieved. A later request can retry a transient failure.
                console.warn('Could not inspect stored highlight duration', { highlightId: row.id, error });
            }
        }));
        res.json({ ok: true, canUpload, highlights: highlights.map(publicHighlight) });
    }));

    router.post('/:orderId/highlights', protect, handle(async (req, res, next) => {
        const access = await orderAccess(client, req.user.userId || req.user.id, req.params.orderId);
        if (!access.canUpload) fail(403, 'Only an admin or assigned booster can upload to a paid, active order.');
        return next();
    }), uploadLimit, upload.single('highlight'), handle(async (req, res) => {
        let key;
        let row;
        try {
            const title = req.body?.title;
            if (typeof title !== 'string' || !title.trim() || title.trim().length > 120) fail(400, 'Enter a highlight title up to 120 characters.');
            if (!req.file) fail(400, 'Choose an MP4 or WebM video.');
            const { mimeType, extension } = await storage.validateHighlightFile(req.file);
            const durationSeconds = await storage.readVideoDurationSeconds(req.file.path, mimeType);
            key = await storage.uploadHighlight({ orderId: req.params.orderId, file: req.file, mimeType, extension });
            row = await client.$transaction(async tx => {
                // Assignment, account status, and order status can change while a large
                // file streams to storage. The order lock serializes assignment edits.
                await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${req.params.orderId} FOR UPDATE`;
                await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${req.user.userId || req.user.id} FOR UPDATE`;
                const access = await orderAccess(tx, req.user.userId || req.user.id, req.params.orderId).catch(error => {
                    if (error.status === 404) fail(409, 'Upload access changed. Refresh the order and try again.');
                    throw error;
                });
                if (!access.canUpload) fail(409, 'Upload access changed. Refresh the order and try again.');
                return tx.orderHighlight.create({ data: { orderId: access.order.id, uploadedById: access.actor.id,
                    uploaderName: access.actor.username?.trim() || 'Unknown user', title: title.trim(), s3Key: key,
                    mimeType, byteSize: req.file.size, durationSeconds, durationProbedAt: new Date() }, select: publicSelect });
            });
        } catch (error) {
            if (key) await removeOrphan(storage, key);
            throw error;
        } finally {
            await cleanUploadedFile(req.file);
        }
        res.status(201).json({ ok: true, highlight: publicHighlight(row) });
    }));

    router.get('/:orderId/highlights/:highlightId/view-url', protect, handle(async (req, res) => {
        res.set('Cache-Control', 'private, no-store');
        await orderAccess(client, req.user.userId || req.user.id, req.params.orderId);
        if (!req.params.highlightId || req.params.highlightId.length > 128) fail(404, 'Highlight not found.');
        const highlight = await client.orderHighlight.findFirst({ where: { id: req.params.highlightId, orderId: req.params.orderId },
            select: { s3Key: true, mimeType: true } });
        if (!highlight) fail(404, 'Highlight not found.');
        const url = await storage.createHighlightViewUrl({ key: highlight.s3Key, mimeType: highlight.mimeType });
        res.json({ ok: true, url });
    }));

    router.post('/:orderId/highlights/:highlightId/thumbnail', protect, handle(async (req, res, next) => {
        const access = await orderAccess(client, req.user.userId || req.user.id, req.params.orderId);
        if (!access.canUpload) fail(403, 'Only an admin or assigned booster can add a preview to a paid, active order.');
        return next();
    }), thumbnailLimit, thumbnailUpload.single('thumbnail'), handle(async (req, res) => {
        let key;
        try {
            if (!req.params.highlightId || req.params.highlightId.length > 128) fail(404, 'Highlight not found.');
            const current = await client.orderHighlight.findFirst({ where: { id: req.params.highlightId, orderId: req.params.orderId },
                select: { id: true, thumbnailKey: true } });
            if (!current) fail(404, 'Highlight not found.');
            if (current.thumbnailKey) fail(409, 'This highlight already has a preview.');
            await storage.validateHighlightThumbnail(req.file);
            key = await storage.uploadHighlightThumbnail({ orderId: req.params.orderId, file: req.file });
            await client.$transaction(async tx => {
                await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${req.params.orderId} FOR UPDATE`;
                await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${req.user.userId || req.user.id} FOR UPDATE`;
                const access = await orderAccess(tx, req.user.userId || req.user.id, req.params.orderId).catch(error => {
                    if (error.status === 404) fail(409, 'Preview access changed. Refresh the order and try again.');
                    throw error;
                });
                if (!access.canUpload) fail(409, 'Preview access changed. Refresh the order and try again.');
                const updated = await tx.orderHighlight.updateMany({
                    where: { id: req.params.highlightId, orderId: req.params.orderId, thumbnailKey: null },
                    data: { thumbnailKey: key },
                });
                if (updated.count !== 1) fail(409, 'This highlight already has a preview.');
            });
            key = null;
            await cleanUploadedFile(req.file);
            res.status(201).json({ ok: true, hasThumbnail: true });
        } catch (error) {
            if (key) await removeOrphan(storage, key);
            throw error;
        } finally { await cleanUploadedFile(req.file); }
    }));

    router.get('/:orderId/highlights/:highlightId/thumbnail-url', protect, handle(async (req, res) => {
        res.set('Cache-Control', 'private, no-store');
        await orderAccess(client, req.user.userId || req.user.id, req.params.orderId);
        if (!req.params.highlightId || req.params.highlightId.length > 128) fail(404, 'Highlight not found.');
        const highlight = await client.orderHighlight.findFirst({ where: { id: req.params.highlightId, orderId: req.params.orderId },
            select: { thumbnailKey: true } });
        if (!highlight?.thumbnailKey) fail(404, 'Preview not found.');
        const url = await storage.createHighlightThumbnailUrl(highlight.thumbnailKey);
        res.json({ ok: true, url });
    }));

    router.use((error, req, res, next) => {
        if (res.headersSent) return next(error);
        if (error instanceof multer.MulterError) {
            const tooLarge = error.code === 'LIMIT_FILE_SIZE';
            return res.status(tooLarge ? 413 : 400).json({ ok: false,
            message: tooLarge ? (req.path.endsWith('/thumbnail') ? 'The preview must be 200 KB or smaller.' : 'The video must be 100 MB or smaller.')
                : 'Upload one video or preview at a time.' });
        }
        return res.status(error.status || 500).json({ ok: false,
            message: error.status ? error.message : 'Could not process the highlight. Please try again.' });
    });
    return router;
}

module.exports = { createOrderHighlightRouter, orderAccess };
