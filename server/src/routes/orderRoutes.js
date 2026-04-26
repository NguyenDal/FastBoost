const express = require("express");
const {
  createOrder,
  getMyOrders,
  getOrderById,
  assignBooster,
  unassignBooster,
  listAssignments,
} = require("../controllers/orderController");
const { protect, adminOnly } = require("../middleware/authMiddleware");

const router = express.Router();

router.post("/", protect, createOrder);
router.get("/my", protect, getMyOrders);
router.get("/:id", protect, getOrderById);

// Admin booster assignment endpoints
router.get("/:id/assignments", protect, adminOnly, listAssignments);
router.post("/:id/assign/:boosterId", protect, adminOnly, assignBooster);
router.delete("/:id/assign/:boosterId", protect, adminOnly, unassignBooster);

module.exports = router;