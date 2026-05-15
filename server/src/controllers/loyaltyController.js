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
    },
    {
        key: "silver",
        name: "Silver",
        icon: "🥈",
        minSpend: 200,
        nextTier: "Gold",
    },
    {
        key: "gold",
        name: "Gold",
        icon: "🥇",
        minSpend: 500,
        nextTier: "Platinum",
    },
    {
        key: "platinum",
        name: "Platinum",
        icon: "💎",
        minSpend: 1000,
        nextTier: null,
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
    if (tierInfo.key === "platinum") return 100;

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

        const user = await ensureReferralCode(userId);

        const completedOrderWhere = {
            customerId: userId,
            status: "COMPLETED",
        };

        const [completedOrdersStats, recentCompletedOrders] = await Promise.all([
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
                take: 10,
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
        ]);

        const completedMatches = completedOrdersStats._count._all || 0;

        const hasVerifiedEmail = Boolean(user?.emailVerifiedAt);
        const hasEnoughCompletedOrders = completedMatches >= 3;
        const hasReferralLink = Boolean(user?.referralCode);

        const referralEligible =
            hasVerifiedEmail && hasEnoughCompletedOrders && hasReferralLink;

        const totalCompletedSpend = Number(completedOrdersStats._sum.totalPrice || 0);


        const totalGold = Math.floor(totalCompletedSpend);

        const tierInfo = getTierInfo(totalCompletedSpend);
        const progressPercent = getTierProgressPercent(
            totalCompletedSpend,
            tierInfo
        );

        const rewardHistory = recentCompletedOrders.map((order) => ({
            id: order.id,
            service: order.service,
            boostType: order.boostType,
            status: order.status,
            totalPrice: order.totalPrice,
            goldEarned: getGoldFromOrder(order),
            completedAt: order.updatedAt,
            createdAt: order.createdAt,
            updatedAt: order.updatedAt,
        }));

        return res.json({
            ok: true,
            loyalty: {
                tier: tierInfo.name,
                tierKey: tierInfo.key,
                icon: tierInfo.icon,

                // Keep this for stats only, not tier calculation.
                completedMatches,

                totalGold,
                totalCompletedSpend,

                nextTier: tierInfo.nextTier,
                spendToNext: tierInfo.spendToNext,
                progressPercent,

                tiers: LOYALTY_TIERS,
                completedOrders: rewardHistory,

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