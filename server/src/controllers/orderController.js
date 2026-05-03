const prisma = require("../prisma");

const createOrder = async (req, res) => {
    try {
        const {
            serviceId,
            boostType,
            inGameName,
            accountPassword,
            currentRank,
            desiredRank,
            currentLP,
            currentMasterLp,
            desiredMasterLp,
            lpGain,
            peakRank,
            desiredWins,
            placementGames,
            firstRole,
            secondRole,
            selectedChampions,
            numberOfGames,
            region,
            queueType,
            playMode,
            priorityOrder,
            premiumCoaching,
            liveStream,
            appearOffline,
            bonusWin,
            soloOnly,
            highMMRDuo,
            basePrice,
            addonPrice,
            totalPrice,
        } = req.body;

        if (!serviceId || !boostType) {
            return res.status(400).json({
                ok: false,
                message: "serviceId and boostType are required",
            });
        }

        const service = await prisma.service.findUnique({
            where: { id: serviceId },
        });

        if (!service) {
            return res.status(404).json({
                ok: false,
                message: "Service not found",
            });
        }

        const customerId = req.user.id || req.user.userId;

        if (!customerId) {
            return res.status(401).json({
                ok: false,
                message: "Invalid user token: missing user id",
            });
        }

        const order = await prisma.order.create({
            data: {
                customerId,
                serviceId,

                boostType,
                currentRank: currentRank || null,
                desiredRank: desiredRank || null,
                currentLP: currentLP || null,
                currentMasterLp: currentMasterLp !== null && currentMasterLp !== undefined
                    ? Number(currentMasterLp)
                    : null,
                desiredMasterLp: desiredMasterLp !== null && desiredMasterLp !== undefined
                    ? Number(desiredMasterLp)
                    : null,
                lpGain: lpGain || null,
                peakRank: peakRank || null,
                desiredWins: desiredWins ? Number(desiredWins) : null,
                placementGames: placementGames ? Number(placementGames) : null,
                firstRole: firstRole || null,
                secondRole: secondRole || null,
                selectedChampions: selectedChampions || [],
                numberOfGames: numberOfGames ? Number(numberOfGames) : null,
                region: region || null,
                queueType: queueType || null,
                playMode: playMode || null,

                priorityOrder: Boolean(priorityOrder),
                premiumCoaching: Boolean(premiumCoaching),
                liveStream: Boolean(liveStream),
                appearOffline: Boolean(appearOffline),
                bonusWin: Boolean(bonusWin),
                soloOnly: Boolean(soloOnly),
                highMMRDuo: Boolean(highMMRDuo),

                basePrice: Number(basePrice || 0),
                addonPrice: Number(addonPrice || 0),
                totalPrice: Number(totalPrice || 0),
            },
        });

        return res.status(201).json({
            ok: true,
            message: "Order created successfully",
            order,
        });
    } catch (error) {
        console.error("createOrder error:", error);

        return res.status(500).json({
            ok: false,
            message: "Server error while creating order",
        });
    }
};

const getMyOrders = async (req, res) => {
    try {
        const orders = await prisma.order.findMany({
            where: {
                customerId: req.user.id || req.user.userId,
            },
            include: {
                service: true,
            },
            orderBy: {
                createdAt: "desc",
            },
        });

        return res.json({
            ok: true,
            orders,
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
        const userId = req.user.id || req.user.userId;
        const { id: orderId } = req.params;
        const { inGameName, accountPassword } = req.body || {};

        if (!userId) {
            return res.status(401).json({
                ok: false,
                message: "Invalid user token: missing user id",
            });
        }

        const order = await prisma.order.findUnique({
            where: { id: orderId },
            select: {
                id: true,
                customerId: true,
            },
        });

        if (!order) {
            return res.status(404).json({
                ok: false,
                message: "Order not found",
            });
        }

        if (order.customerId !== userId) {
            return res.status(403).json({
                ok: false,
                message: "Only the customer who owns this order can update login info",
            });
        }

        const updated = await prisma.order.update({
            where: { id: orderId },
            data: {
                inGameName: inGameName?.trim() || null,
                accountPassword: accountPassword?.trim() || null,
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

        return res.json({
            ok: true,
            message: "Login info updated",
            order: updated,
        });
    } catch (error) {
        console.error("updateOrderLoginInfo error:", error);

        return res.status(500).json({
            ok: false,
            message: "Failed to update login info",
            error: error.message,
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

        return res.json({
            ok: true,
            order,
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

module.exports = {
    createOrder,
    getMyOrders,
    getOrderById,
    updateOrderLoginInfo,
};

// Admin: list all orders with filters/pagination
module.exports.listAllOrders = async (req, res) => {
    try {
        const page = Math.max(parseInt(req.query.page ?? "1", 10), 1);
        const pageSize = Math.min(Math.max(parseInt(req.query.pageSize ?? "20", 10), 1), 100);
        const status = req.query.status;
        const serviceId = req.query.serviceId;
        const q = (req.query.q || "").toString().trim();

        const where = {};
        if (status) where.status = status;
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

        return res.json({
            ok: true,
            page,
            pageSize,
            total,
            items,
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

        return res.json({ ok: true, order });
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

        return res.json({
            ok: true,
            order: updated,
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
            order: updatedOrder,
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
            ...(status ? { status } : {}),
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

        return res.json({
            ok: true,
            items,
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

        return res.json({
            ok: true,
            message: "Order marked as completed",
            order: updated,
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