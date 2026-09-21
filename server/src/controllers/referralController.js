const prisma = require("../prisma");
const {
  getReferralProgramDetails,
} = require("../utils/referralProgram");

async function getPublicReferralInvite(req, res) {
  try {
    const referralCode = String(req.params.referralCode || "").trim();

    if (!referralCode) {
      return res.status(400).json({
        ok: false,
        message: "Referral code is required.",
      });
    }

    const inviter = await prisma.user.findUnique({
      where: {
        referralCode,
      },
      select: {
        id: true,
        username: true,
        email: true,
        referralCode: true,
        profile: {
          select: {
            displayName: true,
            profileImageUrl: true,
          },
        },
      },
    });

    if (!inviter) {
      return res.status(404).json({
        ok: false,
        message: "This private invite link is invalid.",
      });
    }

    const inviterName =
      inviter.username ||
      inviter.profile?.displayName ||
      inviter.email?.split("@")[0] ||
      "FastBoost user";

    const referralProgram = getReferralProgramDetails();

    return res.json({
      ok: true,
      invite: {
        referralCode: inviter.referralCode,
        inviter: {
          username: inviterName,
          profileImageUrl: inviter.profile?.profileImageUrl || "",
        },
        reward: {
          ...referralProgram,
          text: "Get 10% off your first purchase. After you complete a first purchase of $50 or more, both accounts receive 50 gold ($5); your gold is for a future purchase.",
        },
      },
    });
  } catch (error) {
    console.error("Get public referral invite error:", error);

    return res.status(500).json({
      ok: false,
      message: "Failed to load private invite.",
    });
  }
}

module.exports = {
  getPublicReferralInvite,
};