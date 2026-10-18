const express = require("express");
const {
  registerUser,
  loginUser,
  forgotPassword,
  resetPassword,
} = require("../controllers/authController");

const router = express.Router();
router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); return next(); });
const { protect } = require('../middleware/authMiddleware');
const { createRateLimit } = require('../middleware/rateLimit');
const account = req => typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase().slice(0, 254) : 'invalid-email';
const sourceBudget = (limit, windowMs = 15 * 60 * 1000) => createRateLimit({ limit, windowMs });
const accountBudget = (limit, windowMs = 15 * 60 * 1000) => createRateLimit({ limit, windowMs, key: account });
const { socialProviders, startSocialAuth, socialCallback, confirmSocialLink, completeSocialSignup, socialConnections, startSocialLink, startSocialUnlink } = require('../controllers/socialAuthController');
router.get('/social/providers', socialProviders);
router.get('/social/connections', protect, socialConnections);
router.post('/social/:provider/link/start', sourceBudget(30), express.urlencoded({ extended: false, limit: '16kb' }), startSocialLink);
router.post('/social/:provider/unlink/start', sourceBudget(30), express.urlencoded({ extended: false, limit: '16kb' }), startSocialUnlink);
router.post('/social/complete', sourceBudget(30), completeSocialSignup);
router.post('/social/confirm-link', sourceBudget(30), confirmSocialLink);
router.get('/social/:provider/start', sourceBudget(60), startSocialAuth);
router.get('/social/:provider/callback', sourceBudget(60), socialCallback);

router.post("/register", sourceBudget(10, 60 * 60 * 1000), accountBudget(3, 60 * 60 * 1000), registerUser);
router.post("/login", sourceBudget(60), accountBudget(15), loginUser);
// Called on foreground user activity, never from background polling.
router.post('/session/activity', protect, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (req.user.rememberMe !== true) return res.json({ ok: true });
    try {
        const user = await require('../prisma').user.findUnique({ where: { id: req.user.userId || req.user.id } });
        if (!user || user.suspendedAt) return res.status(401).json({ ok: false, message: 'Please sign in again.' });
        if (req.user.securityStamp !== require('../utils/sessionToken').sessionSecurityStamp(user)) return res.status(401).json({ ok: false, message: 'Please sign in again.' });
        return res.json({ ok: true, token: require('../utils/sessionToken').signSessionToken(user, true) });
    } catch { return res.status(503).json({ ok: false, message: 'Session refresh unavailable.' }); }
});
router.post("/forgot-password", sourceBudget(20, 60 * 60 * 1000), accountBudget(3), forgotPassword);
router.post("/reset-password", sourceBudget(30), resetPassword);

module.exports = router;
