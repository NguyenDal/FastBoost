const express = require("express");
const {
    adminListUsers,
    adminUpdateUserRole,
    adminUpdateUserSuspension,
} = require("../controllers/adminUserController");

const { protect, adminOnly } = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/users", protect, adminOnly, adminListUsers);
router.patch("/users/:userId/role", protect, adminOnly, adminUpdateUserRole);
router.patch("/users/:userId/suspension", protect, adminOnly, adminUpdateUserSuspension);

module.exports = router;