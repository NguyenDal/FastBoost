const express = require("express");
const {
  createService,
  getAllServices,
  getServiceById,
} = require("../controllers/serviceController");
const { protect, adminOnly } = require("../middleware/authMiddleware");

const router = express.Router();

router.post("/", protect, adminOnly, createService);
router.get("/", getAllServices);
router.get("/:id", getServiceById);

module.exports = router;