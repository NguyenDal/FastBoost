const { syncLoyaltyTierBonuses } = require("../utils/loyaltyTierBonuses");
const prisma = require("../prisma");
const { rewardPage, rewardPagination } = require("../utils/loyaltyRewards");
const { generateReferralCode } = require("../utils/referralCode");
const {
    getReferralFirstPurchaseOffer,
} = require("../utils/referralProgram");

function getUserId(req) {
    return req.user?.id || req.user?.userId;
}

async function ensureReferralCode(userId, username = "") {
    const existingUser = await prisma.user.findUnique({
        where: {
            id: userId,
        },
        select: {
            id: true,
            username: true,
            emailVerifiedAt: true,
            referralCode: true,
            _count: {
                select: {
                    referrals: true,
                },
            },
        },
    });

    if (!existingUser) return null;

    if (existingUser.referralCode) {
        return existingUser;
    }

    let newReferralCode = generateReferralCode(username || existingUser.username || "");

    let existingCode = await prisma.user.findUnique({
        where: {
            referralCode: newReferralCode,
        },
        select: {
            id: true,
        },
    });

    while (existingCode) {
        newReferralCode = generateReferralCode(username || existingUser.username || "");

        existingCode = await prisma.user.findUnique({
            where: {
                referralCode: newReferralCode,
            },
            select: {
                id: true,
            },
        });
    }

    return prisma.user.update({
        where: {
            id: userId,
        },
        data: {
            referralCode: newReferralCode,
        },
        select: {
            id: true,
            username: true,
            emailVerifiedAt: true,
            referralCode: true,
            _count: {
                select: {
                    referrals: true,
                },
            },
        },
    });
}

const LOYALTY_TIERS = [
    {
        key: "bronze",
        name: "Bronze",
        icon: "🥉",
        minSpend: 0,
        nextTier: "Silver",
        bonusCoins: 0,
        topUpBonusPercent: 0,
        cashBackPercent: 0,
        benefits: ["No bonus"],
    },
    {
        key: "silver",
        name: "Silver",
        icon: "🥈",
        minSpend: 200,
        nextTier: "Gold",
        bonusCoins: 200,
        topUpBonusPercent: 3,
        cashBackPercent: 3,
        benefits: ["200 bonus coins", "3% cash back to wallet"],
    },
    {
        key: "gold",
        name: "Gold",
        icon: "🥇",
        minSpend: 500,
        nextTier: "Platinum",
        bonusCoins: 500,
        topUpBonusPercent: 5,
        cashBackPercent: 5,
        benefits: ["500 bonus coins", "5% cash back to wallet"],
    },
    {
        key: "platinum",
        name: "Platinum",
        icon: "💎",
        minSpend: 1000,
        nextTier: "Diamond",
        bonusCoins: 1000,
        topUpBonusPercent: 10,
        cashBackPercent: 10,
        benefits: ["1000 bonus coins", "10% cash back to wallet"],
    },
    {
        key: "diamond",
        name: "Diamond",
        icon: "🔷",
        minSpend: 1500,
        nextTier: null,
        bonusCoins: 1500,
        topUpBonusPercent: 15,
        cashBackPercent: 15,
        benefits: ["1500 bonus coins", "15% cash back to wallet"],
    },
];

function getTierInfo(totalCompletedSpend) {
    const currentTier =
        [...LOYALTY_TIERS]
            .reverse()
            .find((tier) => totalCompletedSpend >= tier.minSpend) ||
        LOYALTY_TIERS[0];

    if (!currentTier.nextTier) {
        return {
            ...currentTier,
            spendToNext: 0,
        };
    }

    const nextTier = LOYALTY_TIERS.find(
        (tier) => tier.name === currentTier.nextTier
    );

    return {
        ...currentTier,
        spendToNext: Math.max(0, nextTier.minSpend - totalCompletedSpend),
    };
}

function getTierProgressPercent(totalCompletedSpend, tierInfo) {
    if (tierInfo.key === "diamond") return 100;

    const currentMin = tierInfo.minSpend;

    const nextTier = LOYALTY_TIERS.find(
        (tier) => tier.name === tierInfo.nextTier
    );

    if (!nextTier) return 100;

    const range = nextTier.minSpend - currentMin;
    const currentProgress = totalCompletedSpend - currentMin;

    return Math.min(100, Math.max(0, (currentProgress / range) * 100));
}

exports.getMyLoyalty = async (req, res) => {
    try {
        const userId = getUserId(req);

        if (!userId) {
            return res.status(401).json({
                ok: false,
                message: "Invalid user token: missing user id",
            });
        }

        const { page, limit: rewardLimit, offset } = rewardPagination(req.query);

        await syncLoyaltyTierBonuses(prisma, userId);
        const user = await ensureReferralCode(userId);
        const referralOffer = await getReferralFirstPurchaseOffer(userId);

        const completedOrderWhere = {
            customerId: userId,
            status: "COMPLETED",
            paymentStatus: "PAID",
        };

        const [
            completedOrdersStats,
            rewardHistory,
            rewardRecordCount,
            rewardGoldStats,
            completedOrderGoldRows,
        ] = await Promise.all([
            prisma.order.aggregate({
                where: completedOrderWhere,
                _count: {
                    _all: true,
                },
                _sum: {
                    totalPrice: true,
                },
            }),

            rewardPage(prisma, userId, offset, rewardLimit),

            prisma.rewardHistory.count({
                where: {
                    userId,
                },
            }),

            prisma.rewardHistory.aggregate({
                where: {
                    userId,
                },
                _sum: {
                    goldAmount: true,
                },
            }),

            prisma.$queryRaw`
    SELECT COALESCE(SUM(FLOOR("totalPrice")), 0)::int AS "totalGold"
    FROM "Order"
    WHERE "customerId" = ${userId}
    AND "status" = 'COMPLETED'
    AND "paymentStatus" = 'PAID'
`,
        ]);

        const completedMatches = completedOrdersStats._count._all || 0;

        const hasReferralLink = Boolean(user?.referralCode);

        const totalCompletedSpend = Number(completedOrdersStats._sum.totalPrice || 0);


        const completedOrderGold = Number(completedOrderGoldRows?.[0]?.totalGold || 0);
        const extraRewardGold = Number(rewardGoldStats?._sum?.goldAmount || 0);

        const totalGold = completedOrderGold + extraRewardGold;

        const tierInfo = getTierInfo(totalCompletedSpend);
        const progressPercent = getTierProgressPercent(
            totalCompletedSpend,
            tierInfo
        );

        const totalRewardItems = completedMatches + rewardRecordCount;
        const totalRewardPages = Math.max(1, Math.ceil(totalRewardItems / rewardLimit));

        return res.json({
            ok: true,
            loyalty: {
                tier: tierInfo.name,
                tierKey: tierInfo.key,
                icon: tierInfo.icon,
                bonusCoins: tierInfo.bonusCoins,
                topUpBonusPercent: tierInfo.topUpBonusPercent,
                cashBackPercent: tierInfo.cashBackPercent,
                benefits: tierInfo.benefits,

                // Keep this for stats only, not tier calculation.
                completedMatches,

                totalGold,
                totalCompletedSpend,

                nextTier: tierInfo.nextTier,
                spendToNext: tierInfo.spendToNext,
                progressPercent,

                tiers: LOYALTY_TIERS,
                rewardHistory,
                completedOrders: rewardHistory,
                rewardPagination: {
                    page,
                    limit: rewardLimit,
                    totalItems: totalRewardItems,
                    totalPages: totalRewardPages,
                },

                referralCode: user?.referralCode || null,
                referralLink:
                    hasReferralLink && user?.referralCode
                        ? `${process.env.APP_BASE_URL}/r/${user.referralCode}`
                        : null,
                referralCount: user?._count?.referrals || 0,

                referralOffer,

                referralEligibility: {
                    eligible: hasReferralLink,
                    discountAmount: referralOffer.rewardDollarValue,
                    conditions: {
                        referralLinkReady: {
                            passed: hasReferralLink,
                            label: "Referral link ready",
                            helpText: hasReferralLink
                                ? "Your private referral link is ready."
                                : "Referral link is still being created. Refresh this page.",
                        },
                    },
                },
            },
        });
    } catch (error) {
        if (error.status === 400) return res.status(400).json({ ok: false, message: error.message });
        console.error("getMyLoyalty error:", error);

        return res.status(500).json({
            ok: false,
            message: "Failed to load loyalty data",
            error: error.message,
        });
    }
};
