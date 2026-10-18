const express = require("express");
const multer = require("multer");
const { protect } = require("../middleware/authMiddleware");
const ctrl = require("../controllers/chatController");
const { createRateLimit } = require("../middleware/rateLimit");

const router = express.Router();
const uploadLimit = createRateLimit({ limit: 20, windowMs: 60000,
    key: req => req.user.userId || req.user.id,
    message: "Please wait a minute before uploading more attachments." });

const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 10 * 1024 * 1024,
    },
});

router.get("/orders/:orderId", protect, ctrl.getOrCreateOrderConversation);
router.get("/conversations/:conversationId/messages", protect, ctrl.getMessages);
router.post("/conversations/:conversationId/messages", protect, ctrl.postMessage);

router.post(
    "/conversations/:conversationId/attachments",
    protect,
    uploadLimit,
    upload.single("attachment"),
    ctrl.uploadAttachmentMessage
);

router.get(
    "/messages/:messageId/attachment",
    protect,
    ctrl.getAttachmentViewUrl
);

module.exports = router;
