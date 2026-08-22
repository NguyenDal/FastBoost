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

        const now = new Date();

        const globalSale =
            sales.find(
                (sale) =>
                    sale.scope === "GLOBAL" &&
                    getSaleStatus(sale) !== "EXPIRED"
            ) || null;

        const salesByServiceId = new Map();

        for (const sale of sales) {
            if (
                sale.scope !== "SERVICE" ||
                getSaleStatus(sale) === "EXPIRED"
            ) {
                continue;
            }

            if (!salesByServiceId.has(sale.serviceId)) {
                salesByServiceId.set(
                    sale.serviceId,
                    sale
                );
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

            globalSale: globalSale
                ? {
                    id: globalSale.id,
                    title: globalSale.title,
                    discountPercent:
                        globalSale.discountPercent,
                    appliesTo:
                        globalSale.appliesTo,
                    startsAt:
                        globalSale.startsAt,
                    endsAt:
                        globalSale.endsAt,
                    active:
                        globalSale.active,
                    scope:
                        globalSale.scope,
                    status:
                        getSaleStatus(globalSale),
                }
                : null,
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
            scope = "SERVICE",
            title,
            discountPercent,
            appliesTo,
            startsAt,
            endsAt,
        } = req.body || {};

        if (!["SERVICE", "GLOBAL"].includes(scope)) {
            return res.status(400).json({
                ok: false,
                message: "Invalid sale scope.",
            });
        }

        if (scope === "SERVICE" && !serviceId) {
            return res.status(400).json({
                ok: false,
                message: "serviceId is required for a service sale.",
            });
        }

        if (scope === "GLOBAL" && serviceId) {
            return res.status(400).json({
                ok: false,
                message: "Global sales must not have a serviceId.",
            });
        }

        const discount = Number(discountPercent);

        if (
            !Number.isFinite(discount) ||
            discount <= 0 ||
            discount > 90
        ) {
            return res.status(400).json({
                ok: false,
                message: "discountPercent must be between 1 and 90.",
            });
        }

        let service = null;

        if (scope === "SERVICE") {
            service = await prisma.service.findUnique({
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
        }

        if (scope === "GLOBAL") {
            const now = new Date();

            const existingGlobalSale =
                await prisma.serviceSale.findFirst({
                    where: {
                        scope: "GLOBAL",
                        active: true,

                        OR: [
                            { endsAt: null },
                            { endsAt: { gt: now } },
                        ],
                    },
                });

            if (existingGlobalSale) {
                return res.status(409).json({
                    ok: false,
                    message:
                        "A global sale is already active or scheduled. End it before creating another one.",
                });
            }
        }

        const sale = await prisma.serviceSale.create({
            data: {
                scope,

                serviceId:
                    scope === "SERVICE"
                        ? serviceId
                        : null,

                title:
                    title ||
                    (
                        scope === "GLOBAL"
                            ? `${discount}% off all services`
                            : `${discount}% off ${service.title}`
                    ),

                discountPercent: discount,
                appliesTo: appliesTo || "BASE_PRICE",

                startsAt:
                    startsAt
                        ? new Date(startsAt)
                        : null,

                endsAt:
                    endsAt
                        ? new Date(endsAt)
                        : null,

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

        if (
            !config ||
            typeof config !== "object" ||
            Array.isArray(config)
        ) {
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

        const currentConfig =
            existingRule.config &&
                typeof existingRule.config === "object"
                ? existingRule.config
                : {};

        const nextConfig = JSON.parse(JSON.stringify(currentConfig));

        const validateNumber = (
            rawValue,
            name,
            min = 0,
            max = Number.POSITIVE_INFINITY
        ) => {
            const value = Number(rawValue);

            if (
                !Number.isFinite(value) ||
                value < min ||
                value > max
            ) {
                throw new Error(
                    `${name} must be a valid number between ${min} and ${Number.isFinite(max) ? max : "any positive value"
                    }.`
                );
            }

            return value;
        };

        const validatePriceMap = (
            map,
            name,
            min = 0,
            max = Number.POSITIVE_INFINITY
        ) => {
            if (
                !map ||
                typeof map !== "object" ||
                Array.isArray(map)
            ) {
                throw new Error(`${name} is invalid.`);
            }

            const result = {};

            for (const [key, rawValue] of Object.entries(map)) {
                result[key] = validateNumber(
                    rawValue,
                    `${name}: ${key}`,
                    min,
                    max
                );
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
                if (config.perWinPrices) {
                    nextConfig.perWinPrices = validatePriceMap(
                        config.perWinPrices,
                        "Pro Duo source prices"
                    );
                }

                if (config.multiplier !== undefined) {
                    nextConfig.multiplier = validateNumber(
                        config.multiplier,
                        "Pro Duo multiplier",
                        0.01,
                        5
                    );
                }

                break;
            }

            default:
                return res.status(400).json({
                    ok: false,
                    message: "Unsupported pricing type.",
                });
        }

        if (
            config.modifiers &&
            typeof config.modifiers === "object" &&
            !Array.isArray(config.modifiers)
        ) {
            nextConfig.modifiers = {
                ...(nextConfig.modifiers || {}),
            };

            if (config.modifiers.currentLpProgress) {
                nextConfig.modifiers.currentLpProgress = validatePriceMap(
                    config.modifiers.currentLpProgress,
                    "Current LP modifiers",
                    0,
                    5
                );
            }

            if (config.modifiers.lpGain) {
                nextConfig.modifiers.lpGain = validatePriceMap(
                    config.modifiers.lpGain,
                    "LP gain modifiers",
                    0,
                    5
                );
            }
        }

        if (
            config.addons &&
            typeof config.addons === "object" &&
            !Array.isArray(config.addons)
        ) {
            const currentAddons = nextConfig.addons || {};
            const incomingAddons = config.addons;

            const nextAddons = {
                ...currentAddons,
            };

            if (incomingAddons.duoModeMultiplier !== undefined) {
                nextAddons.duoModeMultiplier = validateNumber(
                    incomingAddons.duoModeMultiplier,
                    "Duo mode multiplier",
                    0,
                    5
                );
            }

            const percentageKeys = [
                "duoExtraPercent",
                "expressPercent",
                "premiumCoachingPercent",
                "soloOnlyPercent",
                "highMmrDuoPercent",
                "untrackableDuoPercent",
            ];

            for (const key of percentageKeys) {
                if (incomingAddons[key] === undefined) continue;

                nextAddons[key] = validateNumber(
                    incomingAddons[key],
                    key,
                    0,
                    5
                );
            }

            if (
                incomingAddons.championPreference &&
                typeof incomingAddons.championPreference === "object" &&
                !Array.isArray(incomingAddons.championPreference)
            ) {
                nextAddons.championPreference = validatePriceMap(
                    incomingAddons.championPreference,
                    "Champion preference",
                    0,
                    5
                );
            }

            if (
                incomingAddons.bonusWin &&
                typeof incomingAddons.bonusWin === "object" &&
                !Array.isArray(incomingAddons.bonusWin)
            ) {
                nextAddons.bonusWin = {
                    ...(currentAddons.bonusWin || {}),
                };

                if (
                    incomingAddons.bonusWin.duoMultiplier !== undefined
                ) {
                    nextAddons.bonusWin.duoMultiplier = validateNumber(
                        incomingAddons.bonusWin.duoMultiplier,
                        "Bonus Win Duo multiplier",
                        0,
                        5
                    );
                }
            }

            nextConfig.addons = nextAddons;
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
