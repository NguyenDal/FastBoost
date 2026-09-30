const router = require('express').Router();
const { readFile } = require('node:fs/promises');
const { resolve } = require('node:path');
const documentRoot = resolve(__dirname, '../../private/legal');

// operationsRoutes has already authenticated the token and reloaded the current user.
router.use((req, res, next) => {
    res.set({ 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, noarchive' });
    if (req.actor.role !== 'ADMIN' && req.actor.role !== 'PROVIDER' && !req.actor.hasBoosterAccess) {
        return res.status(403).json({ ok: false, message: 'This agreement is available to admins and boosters only.' });
    }
    next();
});
router.get('/', async (req, res, next) => {
    try {
        const html = await readFile(resolve(documentRoot, 'provider-agreement.html'), 'utf8');
        res.json({ ok: true, html });
    } catch (error) { next(error); }
});
router.get('/document', (req, res, next) => {
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="FastBoost-provider-agreement-review.pdf"' });
    res.sendFile(resolve(documentRoot, 'provider-agreement-review.pdf'), { cacheControl: false, lastModified: false }, error => {
        if (error) next(error);
    });
});
module.exports = router;
