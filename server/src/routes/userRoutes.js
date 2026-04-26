const express = require("express");
const { protect, adminOnly } = require("../middleware/authMiddleware");
const { listProviders } = require("../controllers/userController");

const router = express.Router();

router.get("/me", protect, (req, res) => {
  res.status(200).json({
    ok: true,
    message: "Protected route accessed successfully",
    user: req.user,
  });
});

// Admin: list providers for assignment
router.get("/providers", protect, adminOnly, listProviders);

module.exports = router;