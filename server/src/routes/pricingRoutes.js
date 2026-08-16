const express = require("express");
const router = express.Router();

const {
    getPriceQuote,
} = require("../controllers/pricingController");

router.post("/quote", getPriceQuote);

module.exports = router;