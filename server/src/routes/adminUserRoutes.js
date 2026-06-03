const express = require("express");
const {
    adminListUsers,
    adminUpdateUserRole,
} = require("../controllers/adminUserController");

const { protect, adminOnly } = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/users", protect, adminOnly, adminListUsers);
router.patch("/users/:userId/role", protect, adminOnly, adminUpdateUserRole);

module.exports = router;