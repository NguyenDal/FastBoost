const express = require("express");
const {
    createCheckoutSession,
    verifyCheckoutSession,
    payWithWallet,
} = require("../controllers/paymentController");
const { protect } = require("../middleware/authMiddleware");
const { createRateLimit } = require('../middleware/rateLimit');

const router = express.Router();

router.post("/create-checkout-session", protect, createCheckoutSession);
router.get("/verify-checkout-session", protect, verifyCheckoutSession);
router.post('/wallet', protect, createRateLimit({ limit: 12, windowMs: 60 * 1000, key: req => req.user.id || req.user.userId }), payWithWallet);

module.exports = router;
