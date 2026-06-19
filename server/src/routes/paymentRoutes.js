const express = require("express");
const { createCheckoutSession } = require("../controllers/paymentController");
const { protect } = require("../middleware/authMiddleware");

const router = express.Router();

router.post("/create-checkout-session", protect, createCheckoutSession);

module.exports = router;