const express = require("express");
const {
    createCheckoutSession,
    verifyCheckoutSession,
} = require("../controllers/paymentController");
const { protect } = require("../middleware/authMiddleware");

const router = express.Router();

router.post("/create-checkout-session", protect, createCheckoutSession);
router.get("/verify-checkout-session", protect, verifyCheckoutSession);

module.exports = router;