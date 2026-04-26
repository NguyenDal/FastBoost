const express = require("express");
const {
  createOrder,
  getMyOrders,
  getOrderById,
  assignBooster,
  unassignBooster,
  listAssignments,
  listAllOrders,
  getOrderAdminById,
  updateOrderStatus,
} = require("../controllers/orderController");

const { protect, adminOnly } = require("../middleware/authMiddleware");

const router = express.Router();

// Admin order management endpoints
router.get("/admin", protect, adminOnly, listAllOrders);
router.get("/admin/:id", protect, adminOnly, getOrderAdminById);
router.patch("/admin/:id/status", protect, adminOnly, updateOrderStatus);

// Admin booster assignment endpoints
router.get("/:id/assignments", protect, adminOnly, listAssignments);
router.post("/:id/assign/:boosterId", protect, adminOnly, assignBooster);
router.delete("/:id/assign/:boosterId", protect, adminOnly, unassignBooster);

// Normal order endpoints
router.post("/", protect, createOrder);
router.get("/my", protect, getMyOrders);
router.get("/:id", protect, getOrderById);

module.exports = router;