const express = require("express");
const { sendContactMessage } = require("../controllers/contactController");
const { createRateLimit } = require("../middleware/rateLimit");

const router = express.Router();

router.post("/",
    createRateLimit({ limit: 5, windowMs: 15 * 60 * 1000 }),
    createRateLimit({ limit: 3, windowMs: 15 * 60 * 1000,
        key: req => typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : 'invalid' }),
    sendContactMessage);

module.exports = router;
