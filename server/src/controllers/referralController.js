const prisma = require("../prisma");

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
        emailVerifiedAt: true,
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

    const completedOrders = await prisma.order.count({
      where: {
        customerId: inviter.id,
        status: "COMPLETED",
      },
    });

    const inviterName =
      inviter.username ||
      inviter.profile?.displayName ||
      inviter.email?.split("@")[0] ||
      "FastBoost user";

    const inviterEligible =
      Boolean(inviter.emailVerifiedAt) && completedOrders >= 3;

    return res.json({
      ok: true,
      invite: {
        referralCode: inviter.referralCode,
        inviter: {
          username: inviterName,
          profileImageUrl: inviter.profile?.profileImageUrl || "",
        },
        eligibility: {
          emailVerified: Boolean(inviter.emailVerifiedAt),
          completedOrders: Math.min(completedOrders, 3),
          requiredCompletedOrders: 3,
          eligible: inviterEligible,
        },
        reward: {
          goldAmount: 50,
          dollarValue: 5,
          text: "Both accounts receive 50 gold = $5 discount after the invited user verifies email.",
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