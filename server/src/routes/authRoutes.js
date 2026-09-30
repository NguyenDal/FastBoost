const express = require("express");
const {
  registerUser,
  loginUser,
  forgotPassword,
  resetPassword,
} = require("../controllers/authController");

const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const { socialProviders, startSocialAuth, socialCallback, confirmSocialLink, completeSocialSignup, socialConnections, startSocialLink, startSocialUnlink } = require('../controllers/socialAuthController');
router.get('/social/providers', socialProviders);
router.get('/social/connections', protect, socialConnections);
router.post('/social/:provider/link/start', express.urlencoded({ extended: false, limit: '16kb' }), startSocialLink);
router.post('/social/:provider/unlink/start', express.urlencoded({ extended: false, limit: '16kb' }), startSocialUnlink);
router.post('/social/complete', completeSocialSignup);
router.post('/social/confirm-link', confirmSocialLink);
router.get('/social/:provider/start', startSocialAuth);
router.get('/social/:provider/callback', socialCallback);

router.post("/register", registerUser);
router.post("/login", loginUser);
// Called on foreground user activity, never from background polling.
router.post('/session/activity', protect, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (req.user.rememberMe !== true) return res.json({ ok: true });
    try {
        const user = await require('../prisma').user.findUnique({ where: { id: req.user.userId || req.user.id } });
        if (!user || user.suspendedAt) return res.status(401).json({ ok: false, message: 'Please sign in again.' });
        return res.json({ ok: true, token: require('../utils/sessionToken').signSessionToken(user, true) });
    } catch { return res.status(503).json({ ok: false, message: 'Session refresh unavailable.' }); }
});
router.post("/forgot-password", forgotPassword);
router.post("/reset-password", resetPassword);

module.exports = router;
