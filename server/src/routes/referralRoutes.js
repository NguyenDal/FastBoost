const express = require("express");
const { getPublicReferralInvite } = require("../controllers/referralController");

const router = express.Router();

router.get("/public/:referralCode", getPublicReferralInvite);

module.exports = router;