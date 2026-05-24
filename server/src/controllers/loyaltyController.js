const prisma = require("../prisma");
const { generateReferralCode } = require("../utils/referralCode");

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
        benefits: ["200 bonus coins", "3% top-up bonus"],
    },
    {
        key: "gold",
        name: "Gold",
        icon: "🥇",
        minSpend: 500,
        nextTier: "Platinum",
        bonusCoins: 500,
        topUpBonusPercent: 5,
        benefits: ["500 bonus coins", "5% top-up bonus"],
    },
    {
        key: "platinum",
        name: "Platinum",
        icon: "💎",
        minSpend: 1000,
        nextTier: "Diamond",
        bonusCoins: 800,
        topUpBonusPercent: 8,
        benefits: ["800 bonus coins", "8% top-up bonus"],
    },
    {
        key: "diamond",
        name: "Diamond",
        icon: "🔷",
        minSpend: 1500,
        nextTier: null,
        bonusCoins: 1500,
        topUpBonusPercent: 10,
        benefits: ["1500 bonus coins", "10% top-up bonus"],
    },
];

function getGoldFromOrder(order) {
    return Math.floor(Number(order.totalPrice || 0));
}

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

        const rewardPage = Math.max(1, Number(req.query.rewardPage || 1));
        const rewardLimit = Math.min(10, Math.max(1, Number(req.query.rewardLimit || 5)));
        const rewardTake = rewardPage * rewardLimit;
        const rewardStartIndex = (rewardPage - 1) * rewardLimit;

        if (!userId) {
            return res.status(401).json({
                ok: false,
                message: "Invalid user token: missing user id",
            });
        }

        const user = await ensureReferralCode(userId);

        const completedOrderWhere = {
            customerId: userId,
            status: "COMPLETED",
        };

        const [
            completedOrdersStats,
            recentCompletedOrders,
            rewardRecords,
            completedOrderRewardCount,
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

            prisma.order.findMany({
                where: completedOrderWhere,
                take: rewardTake,
                include: {
                    service: {
                        select: {
                            id: true,
                            title: true,
                        },
                    },
                },
                orderBy: {
                    updatedAt: "desc",
                },
            }),

            prisma.rewardHistory.findMany({
                where: {
                    userId,
                },
                take: rewardTake,
                orderBy: {
                    createdAt: "desc",
                },
            }),

            prisma.order.count({
                where: completedOrderWhere,
            }),

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
`,
        ]);

        const completedMatches = completedOrdersStats._count._all || 0;

        const hasVerifiedEmail = Boolean(user?.emailVerifiedAt);
        const hasEnoughCompletedOrders = completedMatches >= 3;
        const hasReferralLink = Boolean(user?.referralCode);

        const referralEligible =
            hasVerifiedEmail && hasEnoughCompletedOrders && hasReferralLink;

        const totalCompletedSpend = Number(completedOrdersStats._sum.totalPrice || 0);


        const completedOrderGold = Number(completedOrderGoldRows?.[0]?.totalGold || 0);
        const extraRewardGold = Number(rewardGoldStats?._sum?.goldAmount || 0);

        const totalGold = completedOrderGold + extraRewardGold;

        const tierInfo = getTierInfo(totalCompletedSpend);
        const progressPercent = getTierProgressPercent(
            totalCompletedSpend,
            tierInfo
        );

        const completedOrderRewards = recentCompletedOrders.map((order) => ({
            id: `order-${order.id}`,
            type: "COMPLETED_ORDER",
            title: order.service?.title || order.boostType || "Completed Order",
            description: `#${String(order.id).slice(0, 8)} • Completed match reward`,
            goldEarned: getGoldFromOrder(order),
            createdAt: order.updatedAt || order.createdAt,
        }));

        const bonusRewards = rewardRecords.map((reward) => ({
            id: `reward-${reward.id}`,
            type: reward.type,
            title: reward.title,
            description: reward.description || "Reward added to your account.",
            goldEarned: reward.goldAmount,
            createdAt: reward.createdAt,
        }));

        const allRewardHistory = [...completedOrderRewards, ...bonusRewards]
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

        const totalRewardItems = completedOrderRewardCount + rewardRecordCount;
        const totalRewardPages = Math.max(1, Math.ceil(totalRewardItems / rewardLimit));

        const rewardHistory = allRewardHistory.slice(
            rewardStartIndex,
            rewardStartIndex + rewardLimit
        );

        return res.json({
            ok: true,
            loyalty: {
                tier: tierInfo.name,
                tierKey: tierInfo.key,
                icon: tierInfo.icon,
                bonusCoins: tierInfo.bonusCoins,
                topUpBonusPercent: tierInfo.topUpBonusPercent,
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
                    page: rewardPage,
                    limit: rewardLimit,
                    totalItems: totalRewardItems,
                    totalPages: totalRewardPages,
                },

                referralCode: user?.referralCode || null,
                referralLink:
                    referralEligible && user?.referralCode
                        ? `${process.env.APP_BASE_URL}/r/${user.referralCode}`
                        : null,
                referralCount: user?._count?.referrals || 0,

                referralEligibility: {
                    eligible: referralEligible,
                    discountAmount: 5,
                    conditions: {
                        emailVerified: {
                            passed: hasVerifiedEmail,
                            label: "Email verified",
                            helpText: hasVerifiedEmail
                                ? "Your email is verified."
                                : "Verify your email in Account Settings first.",
                        },
                        completedOrders: {
                            passed: hasEnoughCompletedOrders,
                            label: "At least 3 completed orders",
                            current: Math.min(completedMatches, 3),
                            required: 3,
                            helpText: hasEnoughCompletedOrders
                                ? "You have enough completed orders."
                                : `Complete ${Math.max(0, 3 - completedMatches)} more order(s) to unlock referrals.`,
                        },
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
        console.error("getMyLoyalty error:", error);

        return res.status(500).json({
            ok: false,
            message: "Failed to load loyalty data",
            error: error.message,
        });
    }
};