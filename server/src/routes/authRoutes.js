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
router.post("/forgot-password", forgotPassword);
router.post("/reset-password", resetPassword);

module.exports = router;
