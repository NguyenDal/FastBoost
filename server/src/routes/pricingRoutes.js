const express = require("express");
const router = express.Router();

const {
    getPriceQuote,
} = require("../controllers/pricingController");

router.post("/quote", getPriceQuote);
router.get("/footer-promotion", require("../controllers/promotionController").getFooterPromotion);

module.exports = router;
