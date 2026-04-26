const prisma = require("../prisma");

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

const getOrderById = async (req, res) => {
    try {
        const order = await prisma.order.findUnique({
            where: {
                id: req.params.id,
            },
            include: {
                service: true,
            },
        });

        if (!order) {
            return res.status(404).json({
                ok: false,
                message: "Order not found",
            });
        }

        const customerId = req.user.id || req.user.userId;

        if (order.customerId !== customerId && req.user.role !== "ADMIN") {
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
        });
    }
};

module.exports = {
    createOrder,
    getMyOrders,
    getOrderById,
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
                    customer: { select: { id: true, email: true, role: true } },
                    assignments: {
                        include: { booster: { select: { id: true, email: true, role: true } } },
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
                customer: { select: { id: true, email: true, role: true } },
                assignments: {
                    include: { booster: { select: { id: true, email: true, role: true } } },
                },
                conversation: {
                    include: {
                        participants: {
                            include: { user: { select: { id: true, email: true, role: true } } },
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

// Admin: update order status
module.exports.updateOrderStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body || {};

        const allowed = ["PENDING", "IN_PROGRESS", "COMPLETED", "CANCELLED"];
        if (!allowed.includes(status)) {
            return res.status(400).json({ ok: false, message: "Invalid status" });
        }

        const updated = await prisma.order.update({
            where: { id },
            data: { status },
            include: {
                service: true,
                customer: { select: { id: true, email: true, role: true } },
            },
        });

        return res.json({ ok: true, order: updated });
    } catch (error) {
        console.error("updateOrderStatus error:", error);
        if (String(error?.code || "").includes("P2025")) {
            return res.status(404).json({ ok: false, message: "Order not found" });
        }
        return res.status(500).json({ ok: false, message: "Failed to update order status" });
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
        } catch {}

        const participants = await prisma.conversationParticipant.findMany({
            where: { conversationId: convo.id },
            include: { user: { select: { id: true, email: true, role: true } } },
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

        await prisma.orderAssignment.deleteMany({ where: { orderId, boosterId } });

        // Optionally remove from conversation participants (keep history intact)
        const convo = await prisma.conversation.findUnique({ where: { orderId } });
        if (convo) {
            await prisma.conversationParticipant.deleteMany({
                where: { conversationId: convo.id, userId: boosterId },
            });
        }

        return res.json({ ok: true, message: "Booster unassigned" });
    } catch (error) {
        return res.status(500).json({ ok: false, message: "Failed to unassign booster" });
    }
};

// Admin: list booster assignments for an order
module.exports.listAssignments = async (req, res) => {
    try {
        const { id: orderId } = req.params;
        const items = await prisma.orderAssignment.findMany({
            where: { orderId },
            include: { booster: { select: { id: true, email: true, role: true } } },
        });
        return res.json({ ok: true, assignments: items });
    } catch (error) {
        return res.status(500).json({ ok: false, message: "Failed to list assignments" });
    }
};