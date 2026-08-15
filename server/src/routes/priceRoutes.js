const express = require("express");
const router = express.Router();

const {
    listPriceRules,
    createSale,
    disableSale,
    updatePriceRule,
} = require("../controllers/priceController");

const { protect, adminOnly } = require("../middleware/authMiddleware");

router.get("/", protect, adminOnly, listPriceRules);

router.patch(
    "/rules/:id",
    protect,
    adminOnly,
    updatePriceRule
);

router.post("/sales", protect, adminOnly, createSale);
router.patch("/sales/:id/disable", protect, adminOnly, disableSale);

module.exports = router;