const express = require("express");
const router = express.Router();

const {
    listPriceRules,
    createSale,
    disableSale,
} = require("../controllers/priceController");

const { protect, adminOnly } = require("../middleware/authMiddleware");

router.get("/", protect, adminOnly, listPriceRules);
router.post("/sales", protect, adminOnly, createSale);
router.patch("/sales/:id/disable", protect, adminOnly, disableSale);

module.exports = router;