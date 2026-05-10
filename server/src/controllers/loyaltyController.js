const prisma = require("../prisma");

function getUserId(req) {
    return req.user?.id || req.user?.userId;
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

        const tierInfo = getTierInfo(totalCompletedSpend);
        const progressPercent = getTierProgressPercent(
            totalCompletedSpend,
            tierInfo
        );

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

                // Keep this for stats only, not tier calculation.
                completedMatches,

                totalGold,
                totalCompletedSpend,

                nextTier: tierInfo.nextTier,
                spendToNext: tierInfo.spendToNext,
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