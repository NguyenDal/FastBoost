const prisma = require("../prisma");

function getSaleStatus(sale) {
    if (!sale || !sale.active) return "NONE";

    const now = new Date();

    if (sale.startsAt && sale.startsAt > now) {
        return "SCHEDULED";
    }

    if (sale.endsAt && sale.endsAt < now) {
        return "EXPIRED";
    }

    return "ACTIVE";
}

exports.listPriceRules = async (req, res) => {
    try {
        const rules = await prisma.servicePriceRule.findMany({
            orderBy: [
                { game: "asc" },
                { pricingType: "asc" },
            ],
            include: {
                service: {
                    select: {
                        id: true,
                        title: true,
                        description: true,
                    },
                },
            },
        });

        const sales = await prisma.serviceSale.findMany({
            where: {
                active: true,
            },
            orderBy: {
                createdAt: "desc",
            },
        });

        const salesByServiceId = new Map();

        for (const sale of sales) {
            if (!salesByServiceId.has(sale.serviceId)) {
                salesByServiceId.set(sale.serviceId, sale);
            }
        }

        const items = rules.map((rule) => {
            const sale = salesByServiceId.get(rule.serviceId) || null;

            return {
                id: rule.id,
                serviceId: rule.serviceId,
                service: rule.service,
                game: rule.game,
                pricingType: rule.pricingType,
                basePrice: rule.basePrice,
                config: rule.config,
                active: rule.active,
                sale: sale
                    ? {
                        id: sale.id,
                        title: sale.title,
                        discountPercent: sale.discountPercent,
                        appliesTo: sale.appliesTo,
                        startsAt: sale.startsAt,
                        endsAt: sale.endsAt,
                        active: sale.active,
                        status: getSaleStatus(sale),
                    }
                    : null,
            };
        });

        return res.json({
            ok: true,
            items,
        });
    } catch (error) {
        console.error("listPriceRules error:", error);
        return res.status(500).json({
            ok: false,
            message: "Failed to load price rules.",
        });
    }
};

exports.createSale = async (req, res) => {
    try {
        const {
            serviceId,
            title,
            discountPercent,
            appliesTo,
            startsAt,
            endsAt,
        } = req.body || {};

        if (!serviceId) {
            return res.status(400).json({
                ok: false,
                message: "serviceId is required.",
            });
        }

        const discount = Number(discountPercent);

        if (!Number.isFinite(discount) || discount <= 0 || discount > 90) {
            return res.status(400).json({
                ok: false,
                message: "discountPercent must be between 1 and 90.",
            });
        }

        const service = await prisma.service.findUnique({
            where: {
                id: serviceId,
            },
        });

        if (!service) {
            return res.status(404).json({
                ok: false,
                message: "Service not found.",
            });
        }

        const sale = await prisma.serviceSale.create({
            data: {
                serviceId,
                title: title || `${discount}% off ${service.title}`,
                discountPercent: discount,
                appliesTo: appliesTo || "BASE_PRICE",
                startsAt: startsAt ? new Date(startsAt) : null,
                endsAt: endsAt ? new Date(endsAt) : null,
                active: true,
            },
        });

        return res.status(201).json({
            ok: true,
            sale,
        });
    } catch (error) {
        console.error("createSale error:", error);
        return res.status(500).json({
            ok: false,
            message: "Failed to create sale.",
        });
    }
};

exports.updatePriceRule = async (req, res) => {
    try {
        const { id } = req.params;
        const { config } = req.body || {};

        if (!config || typeof config !== "object") {
            return res.status(400).json({
                ok: false,
                message: "Pricing config is required.",
            });
        }

        const existingRule = await prisma.servicePriceRule.findUnique({
            where: { id },
        });

        if (!existingRule) {
            return res.status(404).json({
                ok: false,
                message: "Price rule not found.",
            });
        }

        const currentConfig = existingRule.config || {};
        const nextConfig = {
            ...currentConfig,
        };

        const validatePriceMap = (map, name) => {
            if (!map || typeof map !== "object") {
                throw new Error(`${name} is invalid.`);
            }

            const result = {};

            for (const [key, rawValue] of Object.entries(map)) {
                const value = Number(rawValue);

                if (!Number.isFinite(value) || value < 0) {
                    throw new Error(
                        `${name}: ${key} must be a valid non-negative number.`
                    );
                }

                result[key] = value;
            }

            return result;
        };

        switch (existingRule.pricingType) {
            case "RANK_BASED": {
                if (config.divisionStepPrices) {
                    nextConfig.divisionStepPrices = validatePriceMap(
                        config.divisionStepPrices,
                        "Division prices"
                    );
                }

                if (config.masterLpPricing) {
                    nextConfig.masterLpPricing = validatePriceMap(
                        config.masterLpPricing,
                        "Master LP pricing"
                    );
                }

                break;
            }

            case "PLACEMENT_BASED": {
                if (config.fullSetPrices) {
                    nextConfig.fullSetPrices = validatePriceMap(
                        config.fullSetPrices,
                        "Placement prices"
                    );
                }

                break;
            }

            case "PER_WIN": {
                if (config.perWinPrices) {
                    nextConfig.perWinPrices = validatePriceMap(
                        config.perWinPrices,
                        "Win prices"
                    );
                }

                break;
            }

            case "DUO_ADDON": {
                if (config.multiplier !== undefined) {
                    const multiplier = Number(config.multiplier);

                    if (
                        !Number.isFinite(multiplier) ||
                        multiplier <= 0 ||
                        multiplier > 5
                    ) {
                        return res.status(400).json({
                            ok: false,
                            message:
                                "Pro Duo multiplier must be greater than 0 and no more than 5.",
                        });
                    }

                    nextConfig.multiplier = multiplier;
                }

                break;
            }

            default:
                return res.status(400).json({
                    ok: false,
                    message: "Unsupported pricing type.",
                });
        }

        const updatedRule = await prisma.servicePriceRule.update({
            where: { id },
            data: {
                config: nextConfig,
            },
            include: {
                service: {
                    select: {
                        id: true,
                        title: true,
                        description: true,
                    },
                },
            },
        });

        return res.json({
            ok: true,
            message: "Pricing updated successfully.",
            rule: updatedRule,
        });
    } catch (error) {
        console.error("updatePriceRule error:", error);

        return res.status(400).json({
            ok: false,
            message:
                error.message || "Failed to update pricing rule.",
        });
    }
};

exports.disableSale = async (req, res) => {
    try {
        const { id } = req.params;

        const sale = await prisma.serviceSale.update({
            where: {
                id,
            },
            data: {
                active: false,
            },
        });

        return res.json({
            ok: true,
            sale,
        });
    } catch (error) {
        console.error("disableSale error:", error);
        return res.status(500).json({
            ok: false,
            message: "Failed to disable sale.",
        });
    }
};