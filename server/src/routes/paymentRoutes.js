const express = require("express");
const {
    createCheckoutSession,
    verifyCheckoutSession,
    payWithWallet,
    cancelCheckoutSession,
    heartbeatCheckoutPresence,
    leaveCheckoutPresence,
} = require("../controllers/paymentController");
const { protect } = require("../middleware/authMiddleware");
const { createRateLimit } = require('../middleware/rateLimit');

const router = express.Router();

router.post("/create-checkout-session", protect, createCheckoutSession);
router.get("/verify-checkout-session", protect, verifyCheckoutSession);
router.post('/cancel-checkout-session', protect, createRateLimit({ limit: 12, windowMs: 60 * 1000, key: req => req.user.id || req.user.userId }), cancelCheckoutSession);
router.post('/checkout-presence', protect, createRateLimit({ limit: 120, windowMs: 60 * 1000, key: req => req.user.id || req.user.userId }), heartbeatCheckoutPresence);
router.post('/checkout-presence/leave', protect, createRateLimit({ limit: 60, windowMs: 60 * 1000, key: req => req.user.id || req.user.userId }), leaveCheckoutPresence);
router.post('/wallet', protect, createRateLimit({ limit: 12, windowMs: 60 * 1000, key: req => req.user.id || req.user.userId }), payWithWallet);

module.exports = router;
