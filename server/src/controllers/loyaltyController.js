const prisma = require("../prisma");

function getUserId(req) {
    return req.user?.id || req.user?.userId;
}

const LOYALTY_TIERS = [
    {
        key: "bronze",
        name: "Bronze",
        icon: "🥉",
        minMatches: 0,
        nextTier: "Silver",
    },
    {
        key: "silver",
        name: "Silver",
        icon: "🥈",
        minMatches: 5,
        nextTier: "Gold",
    },
    {
        key: "gold",
        name: "Gold",
        icon: "🥇",
        minMatches: 15,
        nextTier: "Platinum",
    },
    {
        key: "platinum",
        name: "Platinum",
        icon: "💎",
        minMatches: 30,
        nextTier: null,
    },
];

function getGoldFromOrder(order) {
    return Math.floor(Number(order.totalPrice || 0));
}

function getTierInfo(completedMatches) {
    const currentTier =
        [...LOYALTY_TIERS]
            .reverse()
            .find((tier) => completedMatches >= tier.minMatches) || LOYALTY_TIERS[0];

    if (!currentTier.nextTier) {
        return {
            ...currentTier,
            matchesToNext: 0,
        };
    }

    const nextTier = LOYALTY_TIERS.find(
        (tier) => tier.name === currentTier.nextTier
    );

    return {
        ...currentTier,
        matchesToNext: Math.max(0, nextTier.minMatches - completedMatches),
    };
}

function getTierProgressPercent(completedMatches, tierInfo) {
    if (tierInfo.key === "platinum") return 100;

    const currentMin = tierInfo.minMatches;
    const nextTier = LOYALTY_TIERS.find(
        (tier) => tier.name === tierInfo.nextTier
    );

    if (!nextTier) return 100;

    const range = nextTier.minMatches - currentMin;
    const currentProgress = completedMatches - currentMin;

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

        const completedOrders = await prisma.order.findMany({
            where: {
                customerId: userId,
                status: "COMPLETED",
            },
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
        });

        const completedMatches = completedOrders.length;

        const totalCompletedSpend = completedOrders.reduce((sum, order) => {
            return sum + Number(order.totalPrice || 0);
        }, 0);

        const totalGold = completedOrders.reduce((sum, order) => {
            return sum + getGoldFromOrder(order);
        }, 0);

        const tierInfo = getTierInfo(completedMatches);
        const progressPercent = getTierProgressPercent(completedMatches, tierInfo);

        const rewardHistory = completedOrders.map((order) => ({
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
                completedMatches,
                totalGold,
                totalCompletedSpend,
                nextTier: tierInfo.nextTier,
                matchesToNext: tierInfo.matchesToNext,
                progressPercent,
                tiers: LOYALTY_TIERS,
                completedOrders: rewardHistory,
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