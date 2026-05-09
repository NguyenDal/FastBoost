const express = require("express");
const { protect } = require("../middleware/authMiddleware");
const { getMyLoyalty } = require("../controllers/loyaltyController");

const router = express.Router();

router.get("/me", protect, getMyLoyalty);

module.exports = router;