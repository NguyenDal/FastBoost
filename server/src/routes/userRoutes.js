const express = require("express");
const { protect, adminOnly } = require("../middleware/authMiddleware");
const { listProviders, me, checkUsername } = require("../controllers/userController");

const router = express.Router();

router.get("/me", protect, me);

// Public username availability
router.get("/check-username", checkUsername);

// Admin: list providers for assignment
router.get("/providers", protect, adminOnly, listProviders);

module.exports = router;