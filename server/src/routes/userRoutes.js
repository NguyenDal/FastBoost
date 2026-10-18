const express = require("express");
const { protect, adminOnly } = require("../middleware/authMiddleware");
const multer = require("multer");

const {
  listProviders,
  me,
  checkUsername,
  updateMyAccount,
  changeMyPassword,
  uploadMyProfilePicture,
  sendEmailVerificationCode,
  confirmEmailVerificationCode,
} = require("../controllers/userController");

const router = express.Router();
const { createRateLimit } = require('../middleware/rateLimit');
const userBudget = limit => createRateLimit({ limit, windowMs: 15 * 60 * 1000, key: req => req.user.userId });

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 2 * 1024 * 1024,
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];

    if (!allowedTypes.includes(file.mimetype)) {
      return cb(new Error("Only JPG, PNG, WEBP, or GIF images are allowed."));
    }

    cb(null, true);
  },
});

router.get("/me", protect, me);
router.patch("/me", protect, updateMyAccount);
router.patch("/me/password", protect, userBudget(10), changeMyPassword);

router.post("/me/email-verification/send", protect, userBudget(3), sendEmailVerificationCode);
router.post("/me/email-verification/confirm", protect, userBudget(10), confirmEmailVerificationCode);

router.post(
  "/me/profile-picture",
  protect,
  upload.single("profileImage"),
  uploadMyProfilePicture
);

// Public username availability
router.get("/check-username", checkUsername);

// Admin: list providers for assignment
router.get("/providers", protect, adminOnly, listProviders);

module.exports = router;
