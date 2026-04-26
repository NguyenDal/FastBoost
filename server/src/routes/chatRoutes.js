const express = require("express");
const { protect } = require("../middleware/authMiddleware");
const ctrl = require("../controllers/chatController");

const router = express.Router();

router.get("/orders/:orderId", protect, ctrl.getOrCreateOrderConversation);
router.get("/conversations/:conversationId/messages", protect, ctrl.getMessages);
router.post("/conversations/:conversationId/messages", protect, ctrl.postMessage);

module.exports = router;
