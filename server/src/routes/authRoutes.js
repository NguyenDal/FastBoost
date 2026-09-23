const express = require("express");
const {
  registerUser,
  loginUser,
  forgotPassword,
  resetPassword,
} = require("../controllers/authController");

const router = express.Router();
const { socialProviders, startSocialAuth, socialCallback } = require('../controllers/socialAuthController');
router.get('/social/providers', socialProviders);
router.get('/social/:provider/start', startSocialAuth);
router.get('/social/:provider/callback', socialCallback);

router.post("/register", registerUser);
router.post("/login", loginUser);
router.post("/forgot-password", forgotPassword);
router.post("/reset-password", resetPassword);

module.exports = router;
