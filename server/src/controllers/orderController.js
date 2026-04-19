const prisma = require("../prisma");

const createOrder = async (req, res) => {
    try {
        const {
            serviceId,
            boostType,
            currentRank,
            desiredRank,
            currentLP,
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
            duoWithBooster,
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
                duoWithBooster: Boolean(duoWithBooster),
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