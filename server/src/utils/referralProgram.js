const prisma = require("../prisma");

const REFERRAL_FIRST_PURCHASE_DISCOUNT_PERCENT = 10;
const REFERRAL_QUALIFYING_PURCHASE_MINIMUM_CENTS = 5000;
const REFERRAL_REWARD_GOLD = 50;

function roundMoney(value) {
    return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function getReferralProgramDetails() {
    return {
        firstPurchaseDiscountPercent:
            REFERRAL_FIRST_PURCHASE_DISCOUNT_PERCENT,
        qualifyingPurchaseMinimum:
            REFERRAL_QUALIFYING_PURCHASE_MINIMUM_CENTS / 100,
        rewardGold: REFERRAL_REWARD_GOLD,
        rewardDollarValue: REFERRAL_REWARD_GOLD / 10,
    };
}

async function getReferralFirstPurchaseOffer(customerId) {
    const program = getReferralProgramDetails();

    if (!customerId) {
        return {
            ...program,
            eligible: false,
        };
    }

    const [customer, firstPaidOrder] = await Promise.all([
        prisma.user.findUnique({
            where: {
                id: customerId,
            },
            select: {
                referredById: true,
            },
        }),
        prisma.order.findFirst({
            where: {
                customerId,
                paymentStatus: "PAID",
            },
            orderBy: [
                {
                    paidAt: "asc",
                },
                {
                    createdAt: "asc",
                },
            ],
            select: {
                id: true,
            },
        }),
    ]);

    return {
        ...program,
        eligible: Boolean(customer?.referredById && !firstPaidOrder),
    };
}

function applyReferralFirstPurchaseDiscount(totalPrice, referralOffer) {
    const originalTotalPrice = Math.max(0, roundMoney(totalPrice));
    const discountPercent = Number(
        referralOffer?.firstPurchaseDiscountPercent || 0
    );

    const referralDiscount = referralOffer?.eligible
        ? roundMoney(
            originalTotalPrice * (discountPercent / 100)
        )
        : 0;

    return {
        referralDiscount,
        totalPrice: Math.max(
            0,
            roundMoney(originalTotalPrice - referralDiscount)
        ),
    };
}

async function grantReferralCompletionRewards(orderId) {
    const order = await prisma.order.findUnique({
        where: {
            id: orderId,
        },
        select: {
            id: true,
            customerId: true,
            status: true,
            paymentStatus: true,
            totalPrice: true,
            referralDiscount: true,
            customer: {
                select: {
                    referredById: true,
                },
            },
        },
    });

    if (
        !order ||
        order.status !== "COMPLETED" ||
        order.paymentStatus !== "PAID" ||
        Number(order.referralDiscount || 0) <= 0 ||
        !order.customer?.referredById
    ) {
        return {
            granted: false,
        };
    }

    const firstPaidOrder = await prisma.order.findFirst({
        where: {
            customerId: order.customerId,
            paymentStatus: "PAID",
        },
        orderBy: [
            {
                paidAt: "asc",
            },
            {
                createdAt: "asc",
            },
        ],
        select: {
            id: true,
        },
    });

    const originalPurchaseCents = Math.round(
        (Number(order.totalPrice || 0) +
            Number(order.referralDiscount || 0)) *
        100
    );

    if (
        firstPaidOrder?.id !== order.id ||
        originalPurchaseCents <
        REFERRAL_QUALIFYING_PURCHASE_MINIMUM_CENTS
    ) {
        return {
            granted: false,
        };
    }

    const inviterId = order.customer.referredById;
    const rewardDetails = getReferralProgramDetails();

    const legacyInvitedReward = await prisma.rewardHistory.findFirst({
        where: {
            userId: order.customerId,
            type: "REFERRAL_INVITED",
            sourceUserId: inviterId,
        },
        select: {
            id: true,
        },
    });

    if (legacyInvitedReward) {
        return {
            granted: false,
        };
    }

    await prisma.$transaction([
        prisma.rewardHistory.upsert({
            where: {
                userId_type_sourceUserId: {
                    userId: inviterId,
                    type: "REFERRAL_INVITER",
                    sourceUserId: order.id,
                },
            },
            update: {},
            create: {
                userId: inviterId,
                type: "REFERRAL_INVITER",
                goldAmount: REFERRAL_REWARD_GOLD,
                title: "Referral purchase reward",
                description: `You earned ${REFERRAL_REWARD_GOLD} gold ($${rewardDetails.rewardDollarValue}) because your referral completed their first qualifying purchase.`,
                sourceUserId: order.id,
            },
        }),
        prisma.rewardHistory.upsert({
            where: {
                userId_type_sourceUserId: {
                    userId: order.customerId,
                    type: "REFERRAL_INVITED",
                    sourceUserId: order.id,
                },
            },
            update: {},
            create: {
                userId: order.customerId,
                type: "REFERRAL_INVITED",
                goldAmount: REFERRAL_REWARD_GOLD,
                title: "Referral next-purchase reward",
                description: `You earned ${REFERRAL_REWARD_GOLD} gold ($${rewardDetails.rewardDollarValue}) for a future purchase after completing your qualifying first order.`,
                sourceUserId: order.id,
            },
        }),
        ...[inviterId, order.customerId].map((userId) => prisma.notification.upsert({
            where: { id: `referral-reward-${order.id}-${userId}` },
            update: {},
            create: {
                id: `referral-reward-${order.id}-${userId}`,
                userId,
                type: "REFERRAL_REWARD",
                title: `$${rewardDetails.rewardDollarValue} off your next purchase`,
                message: userId === inviterId
                    ? `Your friend completed their qualifying first order. You both earned ${REFERRAL_REWARD_GOLD} gold ($${rewardDetails.rewardDollarValue}) for a future purchase.`
                    : `You completed your qualifying first order. You and your friend both earned ${REFERRAL_REWARD_GOLD} gold ($${rewardDetails.rewardDollarValue}) for a future purchase.`,
                data: { targetPath: "/account/loyalty", goldAmount: REFERRAL_REWARD_GOLD },
            },
        })),
    ]);

    return {
        granted: true,
        goldAmount: REFERRAL_REWARD_GOLD,
    };
}

module.exports = {
    applyReferralFirstPurchaseDiscount,
    getReferralFirstPurchaseOffer,
    getReferralProgramDetails,
    grantReferralCompletionRewards,
};
