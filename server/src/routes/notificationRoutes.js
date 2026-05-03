const express = require("express");
const { protect } = require("../middleware/authMiddleware");
const ctrl = require("../controllers/notificationController");
const {
  listMyNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  markAllChatNotificationsRead,
} = require("../controllers/notificationController");

const router = express.Router();

router.get("/", protect, ctrl.listMyNotifications);
router.patch("/read-all", protect, ctrl.markAllNotificationsRead);
router.patch("/messages/read-all", protect, markAllChatNotificationsRead);
router.patch("/:id/read", protect, ctrl.markNotificationRead);

module.exports = router;