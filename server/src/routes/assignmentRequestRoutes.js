const express = require("express");
const { protect, adminOnly } = require("../middleware/authMiddleware");
const ctrl = require("../controllers/assignmentRequestController");

const router = express.Router();

// Admin creates/cancels assignment request
router.post("/orders/:orderId/boosters/:boosterId", protect, adminOnly, ctrl.createAssignmentRequest);
router.patch("/:requestId/cancel", protect, adminOnly, ctrl.cancelAssignmentRequest);

// Booster accepts/declines assignment request
router.patch("/:requestId/accept", protect, ctrl.acceptAssignmentRequest);
router.patch("/:requestId/decline", protect, ctrl.declineAssignmentRequest);

// Admin/detail page can check pending requests for an order
router.get("/orders/:orderId", protect, adminOnly, ctrl.listOrderAssignmentRequests);

module.exports = router;