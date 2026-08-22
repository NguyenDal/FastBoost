const prisma = require("../prisma");
const { sendTrustpilotReviewInvite } = require("../utils/trustpilotEmail");
const { calculateOrderPrice } = require("../utils/pricingCalculator");

const {
    encryptOrderPassword,
    decryptOrderPassword,
    hasEncryptedPasswordFields,
    stripEncryptedPasswordFields,
} = require("../utils/orderPasswordCrypto");

function getUserId(req) {
    return req.user?.id || req.user?.userId;
}

function isAdminUser(req) {
    return req.user?.role === "ADMIN";
}

function isAssignedProvider(order, userId) {
    return order.assignments?.some(
        (assignment) => String(assignment.boosterId) === String(userId)
    );
}

function canViewOrderLoginInfo(order, req) {
    const userId = getUserId(req);

    const isCustomer = String(order.customerId) === String(userId);
    const assignedProvider = isAssignedProvider(order, userId);

    return isCustomer || isAdminUser(req) || assignedProvider;
}

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
        bonusGold: 800,
    },
    {
        key: "diamond",
        name: "Diamond",
        minSpend: 1500,
        bonusGold: 1500,
    },
];

async function syncLoyaltyTierBonuses(customerId) {
    if (!customerId) {
        return {
            createdBonuses: [],
            removedBonuses: [],
        };
    }

    const completedStats = await prisma.order.aggregate({
        where: {
            customerId,
            status: "COMPLETED",
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

    const existingRewards = await prisma.rewardHistory.findMany({
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
        await prisma.rewardHistory.deleteMany({
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
        await prisma.rewardHistory.createMany({
            data: rewardsToCreate,
            skipDuplicates: true,
        });
    }

    return {
        createdBonuses: rewardsToCreate,
        removedBonuses: rewardsToRemove,
    };
}

async function formatOrderForDetailResponse(order, req, options = {}) {
    const { includeDecryptedLoginPassword = false } = options;

    const safeOrder = stripEncryptedPasswordFields(order);

    safeOrder.hasAccountPassword = hasEncryptedPasswordFields(order);

    if (includeDecryptedLoginPassword && canViewOrderLoginInfo(order, req)) {
        safeOrder.accountPassword = await decryptOrderPassword(order);
    }

    return safeOrder;
}

function formatOrderForListResponse(order) {
    const safeOrder = stripEncryptedPasswordFields(order);
    safeOrder.hasAccountPassword = hasEncryptedPasswordFields(order);
    return safeOrder;
}

const createOrder = async (req, res) => {
    try {
        const {
            serviceId,
            boostType,

            currentRank,
            desiredRank,
            currentLP,
            currentMasterLp,
            desiredMasterLp,
            lpGain,
            peakRank,
            desiredWins,
            placementGames,
            numberOfGames,

            firstRole,
            secondRole,
            selectedChampions,

            region,
            queueType,
            playMode,

            priorityOrder,
            premiumCoaching,
            liveStream,
            appearOffline,
            untrackableDuo,
            bonusWin,
            soloOnly,
            highMMRDuo,
            championPreferenceTier,
        } = req.body || {};

        if (!serviceId || !boostType) {
            return res.status(400).json({
                ok: false,
                message: "serviceId and boostType are required",
            });
        }

        const customerId = req.user?.id || req.user?.userId;

        if (!customerId) {
            return res.status(401).json({
                ok: false,
                message: "Invalid user token: missing user id",
            });
        }

        /*
         * The Order Page allows switching between:
         *
         * Rank Boost
         * Placement Boost
         * Win Boost
         * Pro Duo
         *
         * without changing the URL serviceId.
         *
         * Because of that, boostType is the selected service that
         * actually needs to be priced.
         */
        const selectedService = await prisma.service.findFirst({
            where: {
                title: boostType,
            },
        });

        if (!selectedService) {
            return res.status(404).json({
                ok: false,
                message: "Selected service not found",
            });
        }

        /*
         * Load the LIVE pricing rule from PostgreSQL.
         *
         * This is now the source of truth.
         */
        const priceRule = await prisma.servicePriceRule.findFirst({
            where: {
                serviceId: selectedService.id,
                active: true,
            },
            orderBy: {
                updatedAt: "desc",
            },
        });

        if (!priceRule) {
            return res.status(400).json({
                ok: false,
                message: "No active pricing rule is configured for this service.",
            });
        }

        /*
         * Load other active rules for the same game.
         *
         * This is needed for linked pricing such as Bonus Win,
         * which follows the game's Win Boost pricing.
         */
        const referenceRules = await prisma.servicePriceRule.findMany({
            where: {
                game: priceRule.game,
                active: true,
            },
        });

        const now = new Date();

        /*
         * Load only a sale that is active RIGHT NOW.
         *
         * Scheduled future sales are not applied yet.
         * Expired sales are not applied.
         */
        const saleTimeWindow = {
            active: true,

            AND: [
                {
                    OR: [
                        { startsAt: null },
                        { startsAt: { lte: now } },
                    ],
                },
                {
                    OR: [
                        { endsAt: null },
                        { endsAt: { gte: now } },
                    ],
                },
            ],
        };

        const serviceSale = await prisma.serviceSale.findFirst({
            where: {
                ...saleTimeWindow,
                scope: "SERVICE",
                serviceId: selectedService.id,
            },

            orderBy: {
                createdAt: "desc",
            },
        });

        const globalSale = serviceSale
            ? null
            : await prisma.serviceSale.findFirst({
                where: {
                    ...saleTimeWindow,
                    scope: "GLOBAL",
                    serviceId: null,
                },

                orderBy: {
                    createdAt: "desc",
                },
            });

        const activeSale = serviceSale || globalSale;

        /*
         * These are the CUSTOMER'S selections.
         *
         * The customer is allowed to control these options.
         * They are NOT allowed to control the resulting dollar price.
         */
        const pricingOptions = {
            currentRank: currentRank || null,
            desiredRank: desiredRank || null,
            currentLP: currentLP || null,

            currentMasterLp:
                currentMasterLp !== null &&
                    currentMasterLp !== undefined
                    ? Number(currentMasterLp)
                    : 0,

            desiredMasterLp:
                desiredMasterLp !== null &&
                    desiredMasterLp !== undefined
                    ? Number(desiredMasterLp)
                    : 0,

            lpGain: lpGain || null,
            peakRank: peakRank || null,

            desiredWins: desiredWins
                ? Number(desiredWins)
                : 1,

            placementGames: placementGames
                ? Number(placementGames)
                : 1,

            numberOfGames: numberOfGames
                ? Number(numberOfGames)
                : 1,

            playMode: playMode || "Solo",

            priorityOrder: Boolean(priorityOrder),
            premiumCoaching: Boolean(premiumCoaching),
            untrackableDuo: Boolean(untrackableDuo),
            bonusWin: Boolean(bonusWin),
            soloOnly: Boolean(soloOnly),
            highMMRDuo: Boolean(highMMRDuo),

            championPreferenceTier:
                championPreferenceTier || "4+",
        };

        /*
         * IMPORTANT:
         *
         * The server calculates the price.
         *
         * basePrice / addonPrice / totalPrice sent by the browser
         * are completely ignored.
         */
        const calculatedPrice = calculateOrderPrice({
            rule: priceRule,
            options: pricingOptions,
            sale: activeSale,
            referenceRules,
        });

        if (
            !Number.isFinite(calculatedPrice.totalPrice) ||
            calculatedPrice.totalPrice <= 0
        ) {
            return res.status(400).json({
                ok: false,
                message:
                    "Unable to calculate a valid price for the selected configuration.",
            });
        }

        const order = await prisma.order.create({
            data: {
                customerId,

                /*
                 * Use the service matching the selected boost type,
                 * not necessarily the service originally in the URL.
                 */
                serviceId: selectedService.id,
                boostType: selectedService.title,

                currentRank: currentRank || null,
                desiredRank: desiredRank || null,
                currentLP: currentLP || null,

                currentMasterLp:
                    currentMasterLp !== null &&
                        currentMasterLp !== undefined
                        ? Number(currentMasterLp)
                        : null,

                desiredMasterLp:
                    desiredMasterLp !== null &&
                        desiredMasterLp !== undefined
                        ? Number(desiredMasterLp)
                        : null,

                lpGain: lpGain || null,
                peakRank: peakRank || null,

                desiredWins: desiredWins
                    ? Number(desiredWins)
                    : null,

                placementGames: placementGames
                    ? Number(placementGames)
                    : null,

                numberOfGames: numberOfGames
                    ? Number(numberOfGames)
                    : null,

                firstRole: firstRole || null,
                secondRole: secondRole || null,
                selectedChampions: Array.isArray(selectedChampions)
                    ? selectedChampions
                    : [],

                region: region || null,
                queueType: queueType || null,
                playMode: playMode || null,

                priorityOrder: Boolean(priorityOrder),
                premiumCoaching: Boolean(premiumCoaching),
                liveStream: Boolean(liveStream),
                appearOffline: Boolean(appearOffline),
                untrackableDuo: Boolean(untrackableDuo),
                bonusWin: Boolean(bonusWin),
                soloOnly: Boolean(soloOnly),
                highMMRDuo: Boolean(highMMRDuo),
                championPreferenceTier:
                    championPreferenceTier || "4+",

                /*
                 * PRICE SNAPSHOT
                 *
                 * These values are calculated by the server and stored
                 * permanently with the order.
                 *
                 * If an admin changes prices tomorrow, an old paid order
                 * keeps the amount it was originally created with.
                 */
                basePrice: calculatedPrice.basePrice,
                addonPrice: calculatedPrice.addonPrice,
                totalPrice: calculatedPrice.totalPrice,

                paymentStatus: "PENDING",
                currency: "cad",

                amountCents: Math.round(
                    calculatedPrice.totalPrice * 100
                ),
            },
        });

        return res.status(201).json({
            ok: true,
            message: "Order created successfully",

            order: formatOrderForListResponse(order),

            /*
             * Useful temporarily while we convert OrderPage
             * to live database pricing.
             */
            pricing: {
                basePrice: calculatedPrice.basePrice,
                addonPrice: calculatedPrice.addonPrice,
                subtotal: calculatedPrice.subtotal,
                saleDiscount: calculatedPrice.saleDiscount,
                totalPrice: calculatedPrice.totalPrice,

                sale: activeSale
                    ? {
                        id: activeSale.id,
                        title: activeSale.title,
                        discountPercent: Number(
                            activeSale.discountPercent
                        ),
                        appliesTo: activeSale.appliesTo,
                    }
                    : null,
            },
        });
    } catch (error) {
        console.error("createOrder error:", error);

        return res.status(500).json({
            ok: false,
            message: "Server error while creating order",
            error:
                process.env.NODE_ENV === "development"
                    ? error.message
                    : undefined,
        });
    }
};

const getMyOrders = async (req, res) => {
    try {
        const orders = await prisma.order.findMany({
            where: {
                customerId: req.user.id || req.user.userId,
                paymentStatus: "PAID",
            },
            include: {
                service: true,
            },
            orderBy: {
                createdAt: "desc",
            },
        });

        const safeOrders = orders.map(formatOrderForListResponse);

        return res.json({
            ok: true,
            orders: safeOrders,
        });
    } catch (error) {
        console.error("getMyOrders error:", error);

        return res.status(500).json({
            ok: false,
            message: "Server error while fetching orders",
        });
    }
};

const updateOrderLoginInfo = async (req, res) => {
    try {
        const userId = getUserId(req);
        const { id } = req.params;
        const { inGameName, accountPassword, clearPassword } = req.body;

        const order = await prisma.order.findUnique({
            where: { id },
            include: {
                assignments: true,
            },
        });

        if (!order) {
            return res.status(404).json({ message: "Order not found" });
        }

        const isCustomer = String(order.customerId) === String(userId);

        if (!isCustomer) {
            return res.status(403).json({
                message: "Only the customer can update login information for this order.",
            });
        }

        const updateData = {
            inGameName: typeof inGameName === "string" ? inGameName.trim() || null : order.inGameName,
        };

        if (clearPassword === true) {
            Object.assign(updateData, {
                accountPasswordCiphertext: null,
                accountPasswordEncryptedKey: null,
                accountPasswordIv: null,
                accountPasswordAuthTag: null,
                accountPasswordUpdatedAt: null,
            });
        } else if (typeof accountPassword === "string" && accountPassword.trim()) {
            const encryptedPasswordFields = await encryptOrderPassword(accountPassword);

            Object.assign(updateData, encryptedPasswordFields);
        }

        const updatedOrder = await prisma.order.update({
            where: { id },
            data: updateData,
            include: {
                customer: {
                    select: {
                        id: true,
                        email: true,
                        username: true,
                        profile: {
                            select: {
                                displayName: true,
                            },
                        },
                    },
                },
                service: true,
                assignments: {
                    include: {
                        booster: {
                            select: {
                                id: true,
                                email: true,
                                username: true,
                                profile: {
                                    select: {
                                        displayName: true,
                                    },
                                },
                            },
                        },
                    },
                },
            },
        });

        const safeOrder = await formatOrderForDetailResponse(updatedOrder, req, {
            includeDecryptedLoginPassword: false,
        });

        return res.json({
            message: "Login information updated securely.",
            order: safeOrder,
        });
    } catch (error) {
        console.error("Update order login info error:", error);
        return res.status(500).json({
            message: "Failed to update order login information.",
        });
    }
};

const getOrderById = async (req, res) => {
    try {
        const userId = req.user.id || req.user.userId;
        const userRole = req.user.role;

        if (!userId) {
            return res.status(401).json({
                ok: false,
                message: "Invalid user token: missing user id",
            });
        }

        const order = await prisma.order.findUnique({
            where: {
                id: req.params.id,
            },
            include: {
                service: true,
                customer: {
                    select: {
                        id: true,
                        email: true,
                        username: true,
                        role: true,
                        profile: {
                            select: {
                                displayName: true,
                            },
                        },
                    },
                },
                assignments: {
                    include: {
                        booster: {
                            select: {
                                id: true,
                                email: true,
                                username: true,
                                role: true,
                                profile: {
                                    select: {
                                        displayName: true,
                                    },
                                },
                            },
                        },
                    },
                },
                conversation: {
                    select: {
                        id: true,
                        lastMessageAt: true,
                    },
                },
            },
        });

        if (!order) {
            return res.status(404).json({
                ok: false,
                message: "Order not found",
            });
        }

        const isCustomer = order.customerId === userId;
        const isAdmin = userRole === "ADMIN";
        const isAssignedBooster = order.assignments.some(
            (assignment) => assignment.boosterId === userId
        );

        if (!isCustomer && !isAdmin && !isAssignedBooster) {
            return res.status(403).json({
                ok: false,
                message: "Access denied",
            });
        }

        const safeOrder = await formatOrderForDetailResponse(order, req, {
            includeDecryptedLoginPassword: true,
        });

        return res.json({
            ok: true,
            order: safeOrder,
        });
    } catch (error) {
        console.error("getOrderById error:", error);

        return res.status(500).json({
            ok: false,
            message: "Server error while fetching order",
            error: error.message,
        });
    }
};

const deleteUnpaidCheckoutOrder = async (req, res) => {
    try {
        const userId = req.user.id || req.user.userId;
        const { id } = req.params;

        if (!userId) {
            return res.status(401).json({
                ok: false,
                message: "Invalid user token",
            });
        }

        const order = await prisma.order.findUnique({
            where: { id },
            select: {
                id: true,
                customerId: true,
                status: true,
                paymentStatus: true,
                paidAt: true,
                stripePaymentIntentId: true,
            },
        });

        if (!order) {
            return res.json({
                ok: true,
                deleted: false,
                message: "Unpaid checkout order already removed.",
            });
        }

        if (String(order.customerId) !== String(userId)) {
            return res.status(403).json({
                ok: false,
                message: "You can only remove your own unpaid checkout order.",
            });
        }

        const isPaid =
            order.paymentStatus === "PAID" ||
            Boolean(order.paidAt) ||
            Boolean(order.stripePaymentIntentId);

        if (isPaid) {
            return res.status(400).json({
                ok: false,
                deleted: false,
                message: "Paid orders cannot be removed.",
            });
        }

        const canDeleteStatus = ["PENDING", "CANCELLED"].includes(order.status);

        if (!canDeleteStatus) {
            return res.status(400).json({
                ok: false,
                deleted: false,
                message: "Only pending or cancelled unpaid checkout orders can be removed.",
            });
        }

        const deleteResult = await prisma.order.deleteMany({
            where: {
                id: order.id,
                customerId: order.customerId,
                paymentStatus: {
                    not: "PAID",
                },
                paidAt: null,
                stripePaymentIntentId: null,
            },
        });

        return res.json({
            ok: true,
            deleted: deleteResult.count > 0,
            message:
                deleteResult.count > 0
                    ? "Unpaid checkout order removed."
                    : "Unpaid checkout order already removed or not eligible for removal.",
        });
    } catch (error) {
        console.error("deleteUnpaidCheckoutOrder error:", error);

        return res.status(500).json({
            ok: false,
            message: "Failed to remove unpaid checkout order.",
            error: error.message,
        });
    }
};

module.exports = {
    createOrder,
    getMyOrders,
    getOrderById,
    updateOrderLoginInfo,
    deleteUnpaidCheckoutOrder,
};

// Admin: list all orders with filters/pagination
module.exports.listAllOrders = async (req, res) => {
    try {
        const page = Math.max(parseInt(req.query.page ?? "1", 10), 1);
        const pageSize = Math.min(Math.max(parseInt(req.query.pageSize ?? "20", 10), 1), 100);
        const status = req.query.status;
        const serviceId = req.query.serviceId;
        const q = (req.query.q || "").toString().trim();

        const includeUnpaidCheckout = req.query.includeUnpaidCheckout === "true";

        const where = includeUnpaidCheckout
            ? {}
            : {
                paymentStatus: "PAID",
            };

        if (status === "CURRENT") {
            where.status = {
                in: ["PENDING", "IN_PROGRESS"],
            };
        } else if (status) {
            where.status = status;
        }
        if (serviceId) where.serviceId = serviceId;
        if (q) {
            where.OR = [
                { id: { contains: q, mode: "insensitive" } },
                { customer: { email: { contains: q, mode: "insensitive" } } },
            ];
        }

        const [total, items] = await Promise.all([
            prisma.order.count({ where }),
            prisma.order.findMany({
                where,
                orderBy: { createdAt: "desc" },
                skip: (page - 1) * pageSize,
                take: pageSize,
                include: {
                    service: true,
                    customer: { select: { id: true, email: true, username: true, role: true, profile: { select: { displayName: true } } } },
                    assignments: {
                        include: { booster: { select: { id: true, email: true, username: true, role: true, profile: { select: { displayName: true } } } } },
                    },
                    conversation: { select: { id: true, lastMessageAt: true } },
                },
            }),
        ]);

        const safeItems = items.map(formatOrderForListResponse);

        return res.json({
            ok: true,
            page,
            pageSize,
            total,
            items: safeItems,
        });
    } catch (error) {
        console.error("listAllOrders error:", error);
        return res.status(500).json({ ok: false, message: "Failed to list orders" });
    }
};

// Admin: get an order with admin details
module.exports.getOrderAdminById = async (req, res) => {
    try {
        const { id } = req.params;
        const order = await prisma.order.findUnique({
            where: { id },
            include: {
                service: true,
                customer: { select: { id: true, email: true, username: true, role: true, profile: { select: { displayName: true } } } },
                assignments: {
                    include: { booster: { select: { id: true, email: true, username: true, role: true, profile: { select: { displayName: true } } } } },
                },
                conversation: {
                    include: {
                        participants: {
                            include: { user: { select: { id: true, email: true, username: true, role: true, profile: { select: { displayName: true } } } } },
                        },
                        _count: { select: { messages: true } },
                    },
                },
            },
        });

        if (!order) return res.status(404).json({ ok: false, message: "Order not found" });

        const safeOrder = await formatOrderForDetailResponse(order, req, {
            includeDecryptedLoginPassword: true,
        });

        return res.json({
            ok: true,
            order: safeOrder,
        });
    } catch (error) {
        console.error("getOrderAdminById error:", error);
        return res.status(500).json({ ok: false, message: "Failed to get order" });
    }
};

// Admin: manually complete or cancel an order.
// PENDING and IN_PROGRESS are automatic based on assignments.
module.exports.updateOrderStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body || {};

        const allowed = ["COMPLETED", "CANCELLED"];

        if (!allowed.includes(status)) {
            return res.status(400).json({
                ok: false,
                message:
                    "Admin can only manually set COMPLETED or CANCELLED. PENDING and IN_PROGRESS are automatic.",
            });
        }

        const existingOrder = await prisma.order.findUnique({
            where: { id },
            select: {
                id: true,
                customerId: true,
                status: true,
                paymentStatus: true,
                trustpilotReviewSentAt: true,
            },
        });

        if (!existingOrder) {
            return res.status(404).json({
                ok: false,
                message: "Order not found",
            });
        }

        const updated = await prisma.order.update({
            where: { id },
            data: { status },
            include: {
                service: true,
                customer: {
                    select: {
                        id: true,
                        email: true,
                        username: true,
                        role: true,
                        profile: {
                            select: {
                                displayName: true,
                            },
                        },
                    },
                },
                assignments: {
                    include: {
                        booster: {
                            select: {
                                id: true,
                                email: true,
                                username: true,
                                role: true,
                                profile: {
                                    select: {
                                        displayName: true,
                                    },
                                },
                            },
                        },
                    },
                },
                conversation: true,
            },
        });

        let loyaltyBonusSync = {
            createdBonuses: [],
            removedBonuses: [],
        };

        if (
            status === "COMPLETED" &&
            existingOrder.status !== "COMPLETED" &&
            existingOrder.paymentStatus === "PAID" &&
            !existingOrder.trustpilotReviewSentAt
        ) {
            try {
                const sent = await sendTrustpilotReviewInvite(updated);

                if (sent) {
                    await prisma.order.update({
                        where: { id },
                        data: {
                            trustpilotReviewSentAt: new Date(),
                        },
                    });

                    updated.trustpilotReviewSentAt = new Date();
                }
            } catch (emailError) {
                console.error("Trustpilot review invite error:", emailError);
            }
        }

        return res.json({
            ok: true,
            message:
                status === "COMPLETED"
                    ? "Order marked as completed"
                    : "Order cancelled",
            order: formatOrderForListResponse(updated),
            loyaltyBonusSync,
        });
    } catch (error) {
        console.error("updateOrderStatus error:", error);

        if (String(error?.code || "").includes("P2025")) {
            return res.status(404).json({
                ok: false,
                message: "Order not found",
            });
        }

        return res.status(500).json({
            ok: false,
            message: "Failed to update order status",
            error: error.message,
        });
    }
};

// Admin: assign a booster (provider) to an order
module.exports.assignBooster = async (req, res) => {
    try {
        const { id: orderId, boosterId } = req.params;

        const order = await prisma.order.findUnique({ where: { id: orderId } });
        if (!order) return res.status(404).json({ ok: false, message: "Order not found" });

        const booster = await prisma.user.findUnique({ where: { id: boosterId } });
        if (!booster) return res.status(404).json({ ok: false, message: "User not found" });
        if (booster.role !== "PROVIDER") {
            return res.status(400).json({ ok: false, message: "User is not a provider" });
        }

        try {
            await prisma.orderAssignment.create({ data: { orderId, boosterId } });
        } catch (e) {
            // ignore unique violation if already assigned
            if (!String(e?.code || "").includes("P2002")) {
                throw e;
            }
        }

        // Ensure conversation exists and booster is a participant
        const convo = await prisma.conversation.upsert({
            where: { orderId },
            create: { orderId },
            update: {},
        });

        try {
            await prisma.conversationParticipant.create({
                data: { conversationId: convo.id, userId: boosterId, roleAtJoin: booster.role },
            });
        } catch { }

        const participants = await prisma.conversationParticipant.findMany({
            where: { conversationId: convo.id },
            include: { user: { select: { id: true, email: true, username: true, role: true, profile: { select: { displayName: true } } } } },
        });

        return res.json({ ok: true, message: "Booster assigned", conversationId: convo.id, participants });
    } catch (error) {
        return res.status(500).json({ ok: false, message: "Failed to assign booster" });
    }
};

// Admin: unassign a booster from an order
module.exports.unassignBooster = async (req, res) => {
    try {
        const { id: orderId, boosterId } = req.params;

        const assignment = await prisma.orderAssignment.findFirst({
            where: {
                orderId,
                boosterId,
            },
            include: {
                booster: {
                    select: {
                        id: true,
                        email: true,
                        username: true,
                    },
                },
                order: {
                    include: {
                        service: true,
                    },
                },
            },
        });

        await prisma.orderAssignment.deleteMany({
            where: {
                orderId,
                boosterId,
            },
        });

        const convo = await prisma.conversation.findUnique({
            where: { orderId },
        });

        if (convo) {
            await prisma.conversationParticipant.deleteMany({
                where: {
                    conversationId: convo.id,
                    userId: boosterId,
                },
            });
        }

        const remainingAssignments = await prisma.orderAssignment.count({
            where: {
                orderId,
            },
        });

        let updatedOrder = null;

        if (remainingAssignments === 0) {
            updatedOrder = await prisma.order.update({
                where: { id: orderId },
                data: {
                    status: "PENDING",
                },
                include: {
                    service: true,
                    customer: {
                        select: {
                            id: true,
                            email: true,
                            username: true,
                            role: true,
                            profile: {
                                select: {
                                    displayName: true,
                                },
                            },
                        },
                    },
                    assignments: {
                        include: {
                            booster: {
                                select: {
                                    id: true,
                                    email: true,
                                    username: true,
                                    role: true,
                                    profile: {
                                        select: {
                                            displayName: true,
                                        },
                                    },
                                },
                            },
                        },
                    },
                    conversation: true,
                },
            });
        }

        if (assignment) {
            const shortOrderId = orderId.slice(0, 8).toUpperCase();

            await prisma.notification.create({
                data: {
                    userId: boosterId,
                    type: "ASSIGNMENT_REMOVED",
                    title: `Removed from order`,
                    message: `You were removed from ${assignment.order?.service?.title ||
                        assignment.order?.boostType ||
                        "an order"
                        } for order #${shortOrderId}.`,
                    data: {
                        orderId,
                        shortOrderId,
                        boosterId,
                    },
                },
            });
        }

        return res.json({
            ok: true,
            message: "Booster unassigned",
            order: updatedOrder ? formatOrderForListResponse(updatedOrder) : null,
            remainingAssignments,
        });
    } catch (error) {
        console.error("unassignBooster error:", error);

        return res.status(500).json({
            ok: false,
            message: "Failed to unassign booster",
            error: error.message,
        });
    }
};

// Admin: list booster assignments for an order
module.exports.listAssignments = async (req, res) => {
    try {
        const { id: orderId } = req.params;
        const items = await prisma.orderAssignment.findMany({
            where: { orderId },
            include: { booster: { select: { id: true, email: true, username: true, role: true, profile: { select: { displayName: true } } } } },
        });
        return res.json({ ok: true, assignments: items });
    } catch (error) {
        return res.status(500).json({ ok: false, message: "Failed to list assignments" });
    }
};

// Provider: list orders assigned to the logged-in booster/provider
module.exports.listAssignedOrdersForProvider = async (req, res) => {
    try {
        const providerId = req.user.id || req.user.userId;

        if (!providerId) {
            return res.status(401).json({
                ok: false,
                message: "Invalid user token: missing user id",
            });
        }

        if (req.user.role !== "PROVIDER" && req.user.role !== "ADMIN") {
            return res.status(403).json({
                ok: false,
                message: "Only providers can view assigned orders",
            });
        }

        const page = Math.max(parseInt(req.query.page || "1", 10), 1);
        const pageSize = Math.min(
            Math.max(parseInt(req.query.pageSize || "20", 10), 1),
            100
        );

        const status = req.query.status || undefined;
        const q = req.query.q?.trim();

        const where = {
            assignments: {
                some: {
                    boosterId: providerId,
                },
            },
            ...(status === "CURRENT"
                ? { status: { in: ["PENDING", "IN_PROGRESS"] } }
                : status
                    ? { status }
                    : {}),
            ...(q
                ? {
                    OR: [
                        { id: { contains: q, mode: "insensitive" } },
                        { customer: { email: { contains: q, mode: "insensitive" } } },
                        { customer: { username: { contains: q, mode: "insensitive" } } },
                        { service: { title: { contains: q, mode: "insensitive" } } },
                        { boostType: { contains: q, mode: "insensitive" } },
                    ],
                }
                : {}),
        };

        const [items, total] = await Promise.all([
            prisma.order.findMany({
                where,
                orderBy: {
                    createdAt: "desc",
                },
                skip: (page - 1) * pageSize,
                take: pageSize,
                include: {
                    service: true,
                    customer: {
                        select: {
                            id: true,
                            email: true,
                            username: true,
                            role: true,
                            profile: {
                                select: {
                                    displayName: true,
                                },
                            },
                        },
                    },
                    assignments: {
                        include: {
                            booster: {
                                select: {
                                    id: true,
                                    email: true,
                                    username: true,
                                    role: true,
                                    profile: {
                                        select: {
                                            displayName: true,
                                        },
                                    },
                                },
                            },
                        },
                    },
                    conversation: {
                        select: {
                            id: true,
                            lastMessageAt: true,
                        },
                    },
                },
            }),
            prisma.order.count({ where }),
        ]);

        const safeItems = items.map(formatOrderForListResponse);

        return res.json({
            ok: true,
            items: safeItems,
            total,
            page,
            pageSize,
        });
    } catch (error) {
        console.error("listAssignedOrdersForProvider error:", error);

        return res.status(500).json({
            ok: false,
            message: "Server error while loading assigned orders",
            error: error.message,
        });
    }
};

// Provider: complete an assigned order
module.exports.providerCompleteAssignedOrder = async (req, res) => {
    try {
        const providerId = req.user.id || req.user.userId;
        const { id: orderId } = req.params;

        if (!providerId) {
            return res.status(401).json({
                ok: false,
                message: "Invalid user token",
            });
        }

        const isAdmin = req.user.role === "ADMIN";

        const assignment = await prisma.orderAssignment.findFirst({
            where: {
                orderId,
                boosterId: providerId,
            },
        });

        if (!assignment && !isAdmin) {
            return res.status(403).json({
                ok: false,
                message: "You are not assigned to this order",
            });
        }

        const existingOrder = await prisma.order.findUnique({
            where: { id: orderId },
            select: {
                id: true,
                customerId: true,
                status: true,
                paymentStatus: true,
                trustpilotReviewSentAt: true,
            },
        });

        if (!existingOrder) {
            return res.status(404).json({
                ok: false,
                message: "Order not found",
            });
        }

        const updated = await prisma.order.update({
            where: { id: orderId },
            data: {
                status: "COMPLETED",
            },
            include: {
                service: true,
                customer: {
                    select: {
                        id: true,
                        email: true,
                        username: true,
                        role: true,
                        profile: {
                            select: {
                                displayName: true,
                            },
                        },
                    },
                },
                assignments: {
                    include: {
                        booster: {
                            select: {
                                id: true,
                                email: true,
                                username: true,
                                role: true,
                                profile: {
                                    select: {
                                        displayName: true,
                                    },
                                },
                            },
                        },
                    },
                },
                conversation: true,
            },
        });

        let loyaltyBonusSync = {
            createdBonuses: [],
            removedBonuses: [],
        };

        if (
            existingOrder.status !== "COMPLETED" &&
            existingOrder.paymentStatus === "PAID" &&
            !existingOrder.trustpilotReviewSentAt
        ) {
            try {
                const sent = await sendTrustpilotReviewInvite(updated);

                if (sent) {
                    await prisma.order.update({
                        where: { id: orderId },
                        data: {
                            trustpilotReviewSentAt: new Date(),
                        },
                    });

                    updated.trustpilotReviewSentAt = new Date();
                }
            } catch (emailError) {
                console.error("Trustpilot review invite error:", emailError);
            }
        }
        return res.json({
            ok: true,
            message: "Order marked as completed",
            order: formatOrderForListResponse(updated),
            loyaltyBonusSync,
        });
    } catch (error) {
        console.error("providerCompleteAssignedOrder error:", error);

        return res.status(500).json({
            ok: false,
            message: "Failed to complete order",
            error: error.message,
        });
    }
};

// Provider: leave/unassign themselves from an order
module.exports.providerLeaveAssignedOrder = async (req, res) => {
    try {
        const providerId = req.user.id || req.user.userId;
        const { id: orderId } = req.params;

        if (!providerId) {
            return res.status(401).json({
                ok: false,
                message: "Invalid user token",
            });
        }

        if (req.user.role !== "PROVIDER") {
            return res.status(403).json({
                ok: false,
                message: "Only providers can leave assigned orders",
            });
        }

        const assignment = await prisma.orderAssignment.findFirst({
            where: {
                orderId,
                boosterId: providerId,
            },
            include: {
                booster: {
                    select: {
                        id: true,
                        email: true,
                        username: true,
                    },
                },
                order: {
                    include: {
                        service: true,
                    },
                },
            },
        });

        if (!assignment) {
            return res.status(404).json({
                ok: false,
                message: "Assignment not found",
            });
        }

        await prisma.orderAssignment.delete({
            where: {
                orderId_boosterId: {
                    orderId,
                    boosterId: providerId,
                },
            },
        });

        const convo = await prisma.conversation.findUnique({
            where: { orderId },
        });

        if (convo) {
            await prisma.conversationParticipant.deleteMany({
                where: {
                    conversationId: convo.id,
                    userId: providerId,
                },
            });
        }

        const remainingAssignments = await prisma.orderAssignment.count({
            where: {
                orderId,
            },
        });

        if (remainingAssignments === 0) {
            await prisma.order.update({
                where: { id: orderId },
                data: {
                    status: "PENDING",
                },
            });
        }

        const admins = await prisma.user.findMany({
            where: {
                role: "ADMIN",
            },
            select: {
                id: true,
            },
        });

        const boosterName =
            assignment.booster?.username ||
            assignment.booster?.email ||
            "A booster";

        const orderTitle =
            assignment.order?.service?.title ||
            assignment.order?.boostType ||
            "an order";

        if (admins.length > 0) {
            await prisma.notification.createMany({
                data: admins.map((admin) => ({
                    userId: admin.id,
                    type: "BOOSTER_LEFT_ORDER",
                    title: "Booster left order",
                    message: `${boosterName} left ${orderTitle} for order #${orderId.slice(0, 8).toUpperCase()}.`,
                    data: {
                        orderId,
                        shortOrderId: orderId.slice(0, 8).toUpperCase(),
                        boosterId: providerId,
                    },
                })),
            });
        }

        return res.json({
            ok: true,
            message: "You left the order",
            remainingAssignments,
        });
    } catch (error) {
        console.error("providerLeaveAssignedOrder error:", error);

        return res.status(500).json({
            ok: false,
            message: "Failed to leave assigned order",
            error: error.message,
        });
    }
};