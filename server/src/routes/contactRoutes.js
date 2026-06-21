const express = require("express");
const { sendContactMessage } = require("../controllers/contactController");

const router = express.Router();

router.post("/", sendContactMessage);

module.exports = router;