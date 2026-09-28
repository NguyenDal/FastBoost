const express = require('express');
const multer = require('multer');
const db = require('../prisma');
const { protect } = require('../middleware/authMiddleware');
const { uploadChatAttachmentToS3, createChatAttachmentSignedUrl, readChatAttachmentFromS3 } = require('../utils/s3Upload');
const { buildAttachmentPreview, contentTypeOf } = require('../utils/supportAttachmentPreview');
const { identitySelect, messageSelect, fail, onlineAdmins, authorizeThread, validateMessage, saveSupportMessage } = require('../utils/supportChat');
const router = express.Router();
const handle = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
router.use(protect, handle(async (req, res, next) => {
    const user = await db.user.findUnique({ where: { id: req.user.id || req.user.userId }, select: { id: true, role: true, suspendedAt: true } });
    if (!user || user.suspendedAt) fail(403, 'This account cannot use support chat.');
    if (!['CUSTOMER', 'ADMIN'].includes(user.role)) fail(403, 'Support chat is for customers and admins.');
    req.supportUser = user;
    res.set('Cache-Control', 'no-store');
    next();
}));

router.get('/status', handle(async (req, res) => {
    res.json({ ok: true, admins: await onlineAdmins(db) });
}));

router.post('/presence', handle(async (req, res) => {
    if (req.supportUser.role !== 'ADMIN') fail(403, 'Admins only.');
    const { sessionId } = req.body;
    if (typeof sessionId !== 'string' || !/^[\w-]{16,80}$/.test(sessionId)) fail(400, 'Invalid session.');
    const existing = await db.supportPresence.findUnique({ where: { sessionId } });
    if (existing && existing.adminId !== req.supportUser.id) fail(403, 'Invalid session.');
    await db.supportPresence.deleteMany({ where: { expiresAt: { lt: new Date() } } });
    await db.supportPresence.upsert({ where: { sessionId }, create: { sessionId, adminId: req.supportUser.id, expiresAt: new Date(Date.now() + 45000) }, update: { expiresAt: new Date(Date.now() + 45000) } });
    res.json({ ok: true });
}));
router.delete('/presence/:sessionId', handle(async (req, res) => {
    await db.supportPresence.deleteMany({ where: { sessionId: req.params.sessionId, adminId: req.supportUser.id } });
    res.json({ ok: true });
}));

router.post('/thread', handle(async (req, res) => {
    if (req.supportUser.role !== 'CUSTOMER') fail(403, 'Customers only.');
    const thread = await db.supportThread.upsert({ where: { customerId: req.supportUser.id }, create: { customerId: req.supportUser.id }, update: {} });
    res.json({ ok: true, thread });
}));

router.get('/threads', handle(async (req, res) => {
    if (req.supportUser.role !== 'ADMIN') fail(403, 'Admins only.');
    const skip = Math.trunc(Math.max(0, Math.min(100000, Number(req.query.offset) || 0)));
    const threads = await db.supportThread.findMany({ where: { messages: { some: {} } }, orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }], skip, take: 31,
        include: { customer: { select: identitySelect }, messages: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 1, select: messageSelect } } });
    res.json({ ok: true, threads: threads.slice(0, 30), hasMore: threads.length > 30 });
}));

router.get('/threads/:threadId/messages', handle(async (req, res) => {
    const thread = await authorizeThread(db, req.supportUser, req.params.threadId);
    if (req.query.before) {
        const cursor = await db.supportMessage.findUnique({ where: { id: String(req.query.before) } });
        if (!cursor || cursor.threadId !== thread.id) fail(400, 'Invalid message cursor.');
    }
    const messages = await db.supportMessage.findMany({ where: { threadId: thread.id }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 51,
        ...(req.query.before ? { cursor: { id: String(req.query.before) }, skip: 1 } : {}), select: messageSelect });
    res.json({ ok: true, thread, messages: messages.slice(0, 50).reverse(), hasMore: messages.length > 50 });
}));

router.post('/threads/:threadId/read', handle(async (req, res) => {
    await authorizeThread(db, req.supportUser, req.params.threadId);
    const message = await db.supportMessage.findUnique({ where: { id: String(req.body.messageId || '') } });
    if (!message || message.threadId !== req.params.threadId) fail(400, 'Invalid message.');
    const field = req.supportUser.role === 'ADMIN' ? 'adminReadAt' : 'customerReadAt';
    await db.supportThread.updateMany({ where: { id: message.threadId, [field]: { lt: message.createdAt } }, data: { [field]: message.createdAt } });
    res.json({ ok: true });
}));

// Authorize before accepting file bytes. Match-chat storage is reused, with a
// conservative support-file allowlist and the same 10 MB limit.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 2 }, fileFilter: (req, file, cb) => {
    try { validateMessage({ clientId: 'attachment-validation' }, file); cb(null, true); } catch (error) { cb(error); }
} });
router.post('/threads/:threadId/messages', handle(async (req, res, next) => {
    await authorizeThread(db, req.supportUser, req.params.threadId);
    const recent = await db.supportMessage.count({ where: { senderId: req.supportUser.id, createdAt: { gt: new Date(Date.now() - 60000) } } });
    if (recent >= 12) fail(429, 'Please wait a minute before sending more messages.');
    next();
}), upload.single('attachment'), handle(async (req, res) => {
    const message = await saveSupportMessage(db, req.supportUser, req.params.threadId, req.body, req.file, uploadChatAttachmentToS3);
    res.status(201).json({ ok: true, message });
}));

router.get('/attachments/:messageId', handle(async (req, res) => {
    const message = await db.supportMessage.findUnique({ where: { id: req.params.messageId } });
    if (!message?.attachmentKey) fail(404, 'Attachment not found.');
    await authorizeThread(db, req.supportUser, message.threadId);
    const url = await createChatAttachmentSignedUrl({ key: message.attachmentKey, filename: message.attachmentName, download: req.query.download === '1', contentType: contentTypeOf(message.attachmentName) });
    res.json({ ok: true, url });
}));

router.get('/attachments/:messageId/preview', handle(async (req, res) => {
    const message = await db.supportMessage.findUnique({ where: { id: req.params.messageId } });
    if (!message?.attachmentKey) fail(404, 'Attachment not found.');
    await authorizeThread(db, req.supportUser, message.threadId);
    const preview = await buildAttachmentPreview(message, { signUrl: createChatAttachmentSignedUrl, readFile: readChatAttachmentFromS3 });
    res.json({ ok: true, ...preview });
}));

router.get('/attachments/:messageId/content', handle(async (req, res) => {
    const message = await db.supportMessage.findUnique({ where: { id: req.params.messageId } });
    if (!message?.attachmentKey) fail(404, 'Attachment not found.');
    await authorizeThread(db, req.supportUser, message.threadId);
    if (!/\.pdf$/i.test(message.attachmentName)) fail(415, 'This file does not support PDF preview.');
    const buffer = await readChatAttachmentFromS3(message.attachmentKey);
    res.set('X-Content-Type-Options', 'nosniff').type('application/pdf').send(buffer);
}));

router.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const status = error instanceof multer.MulterError ? 400 : error.status || 500;
    if (status === 500) console.error('[Support chat] Request failed:', error.code || 'INTERNAL');
    res.status(status).json({ ok: false, message: error instanceof multer.MulterError ? 'Attach one file up to 10 MB.' : status === 500 ? 'Support chat is temporarily unavailable. Please try again.' : error.message });
});
module.exports = router;
