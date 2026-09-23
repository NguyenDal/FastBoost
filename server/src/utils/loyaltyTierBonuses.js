const LOYALTY_TIER_BONUS_REWARDS = [
    {
        key: "silver",
        name: "Silver",
        minSpend: 200,
        bonusGold: 200,
    },
    {
        key: "gold",
        name: "Gold",
        minSpend: 500,
        bonusGold: 500,
    },
    {
        key: "platinum",
        name: "Platinum",
        minSpend: 1000,
        bonusGold: 1000,
    },
    {
        key: "diamond",
        name: "Diamond",
        minSpend: 1500,
        bonusGold: 1500,
    },
];

async function reconcile(db, customerId) {
    if (!customerId) {
        return {
            createdBonuses: [],
            removedBonuses: [],
        };
    }

    const completedStats = await db.order.aggregate({
        where: {
            customerId,
            status: "COMPLETED",
            paymentStatus: "PAID",
        },
        _sum: {
            totalPrice: true,
        },
    });

    const totalCompletedSpend = Number(completedStats._sum.totalPrice || 0);

    const reachedTiers = LOYALTY_TIER_BONUS_REWARDS.filter(
        (tier) => totalCompletedSpend >= tier.minSpend
    );

    const reachedSourceKeys = reachedTiers.map(
        (tier) => `LOYALTY_TIER_${tier.key.toUpperCase()}`
    );

    const existingRewards = await db.rewardHistory.findMany({
        where: {
            userId: customerId,
            type: "LOYALTY_TIER_BONUS",
        },
        select: {
            id: true,
            sourceUserId: true,
            title: true,
            goldAmount: true,
        },
    });

    const existingSourceKeys = new Set(
        existingRewards.map((reward) => reward.sourceUserId)
    );

    const rewardsToRemove = existingRewards.filter(
        (reward) => !reachedSourceKeys.includes(reward.sourceUserId)
    );

    if (rewardsToRemove.length > 0) {
        await db.rewardHistory.deleteMany({
            where: {
                id: {
                    in: rewardsToRemove.map((reward) => reward.id),
                },
            },
        });
    }

    const rewardsToCreate = reachedTiers
        .filter((tier) => {
            const sourceKey = `LOYALTY_TIER_${tier.key.toUpperCase()}`;
            return !existingSourceKeys.has(sourceKey);
        })
        .map((tier) => ({
            userId: customerId,
            type: "LOYALTY_TIER_BONUS",
            goldAmount: tier.bonusGold,
            title: `${tier.name} Account Bonus`,
            description: `You reached ${tier.name} account status and earned ${tier.bonusGold} bonus gold.`,
            sourceUserId: `LOYALTY_TIER_${tier.key.toUpperCase()}`,
        }));

    if (rewardsToCreate.length > 0) {
        await db.rewardHistory.createMany({
            data: rewardsToCreate,
            skipDuplicates: true,
        });
    }

    return {
        createdBonuses: rewardsToCreate,
        removedBonuses: rewardsToRemove,
    };
}

async function syncLoyaltyTierBonuses(prisma, customerId) {
    if (!customerId) return { createdBonuses: [], removedBonuses: [] };
    return prisma.$transaction(async db => {
        await db.$queryRaw`SELECT id FROM "User" WHERE id = ${customerId} FOR UPDATE`;
        return reconcile(db, customerId);
    });
}
module.exports = { syncLoyaltyTierBonuses };
