const prisma = require("../prisma");
const {
    calculateOrderPrice,
} = require("../utils/pricingCalculator");

exports.getPriceQuote = async (req, res) => {
    try {
        const {
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

            playMode,
            priorityOrder,
            premiumCoaching,
            untrackableDuo,
            bonusWin,
            soloOnly,
            highMMRDuo,
            championPreferenceTier,
        } = req.body || {};

        if (!boostType) {
            return res.status(400).json({
                ok: false,
                message: "boostType is required.",
            });
        }

        /*
         * Load the selected pricing rule + service together.
         *
         * Before:
         *   1 query for Service
         *   1 query for ServicePriceRule
         *
         * Now:
         *   1 query total
         */
        const priceRule =
            await prisma.servicePriceRule.findFirst({
                where: {
                    active: true,

                    service: {
                        title: boostType,
                    },
                },

                orderBy: {
                    updatedAt: "desc",
                },

                include: {
                    service: {
                        select: {
                            id: true,
                            title: true,
                        },
                    },
                },
            });

        if (!priceRule) {
            return res.status(404).json({
                ok: false,
                message:
                    "No active pricing rule found for this service.",
            });
        }

        const service = priceRule.service;
        const now = new Date();

        const saleTimeWindow = {
            active: true,

            AND: [
                {
                    OR: [
                        { startsAt: null },
                        {
                            startsAt: {
                                lte: now,
                            },
                        },
                    ],
                },
                {
                    OR: [
                        { endsAt: null },
                        {
                            endsAt: {
                                gte: now,
                            },
                        },
                    ],
                },
            ],
        };

        /*
         * Load service + global sale candidates in one query.
         *
         * Service-specific sale wins over global sale.
         */
        const salePromise =
            prisma.serviceSale.findMany({
                where: {
                    ...saleTimeWindow,

                    OR: [
                        {
                            scope: "SERVICE",
                            serviceId: service.id,
                        },
                        {
                            scope: "GLOBAL",
                            serviceId: null,
                        },
                    ],
                },

                orderBy: {
                    createdAt: "desc",
                },
            });

        /*
         * Reference Win Boost pricing is ONLY needed
         * when Bonus Win is actually selected.
         *
         * Do not load every pricing rule for the game.
         */
        let referenceRulePromise =
            Promise.resolve(null);

        if (Boolean(bonusWin)) {
            if (
                priceRule.pricingType === "PER_WIN"
            ) {
                // The selected rule already IS Win Boost.
                referenceRulePromise =
                    Promise.resolve(priceRule);
            } else {
                referenceRulePromise =
                    prisma.servicePriceRule.findFirst({
                        where: {
                            game: priceRule.game,
                            pricingType: "PER_WIN",
                            active: true,
                        },

                        orderBy: {
                            updatedAt: "desc",
                        },
                    });
            }
        }

        /*
         * Run independent DB work in parallel.
         */
        const [
            saleCandidates,
            referenceWinRule,
        ] = await Promise.all([
            salePromise,
            referenceRulePromise,
        ]);

        const serviceSale =
            saleCandidates.find(
                (sale) =>
                    sale.scope === "SERVICE"
            ) || null;

        const globalSale =
            saleCandidates.find(
                (sale) =>
                    sale.scope === "GLOBAL"
            ) || null;

        const activeSale =
            serviceSale || globalSale;

        const referenceRules =
            referenceWinRule
                ? [referenceWinRule]
                : [];

        const pricingOptions = {
            currentRank:
                currentRank || null,

            desiredRank:
                desiredRank || null,

            currentLP:
                currentLP || null,

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

            lpGain:
                lpGain || null,

            peakRank:
                peakRank || null,

            desiredWins:
                desiredWins !== null &&
                desiredWins !== undefined
                    ? Number(desiredWins)
                    : 0,

            placementGames:
                placementGames !== null &&
                placementGames !== undefined
                    ? Number(placementGames)
                    : 0,

            numberOfGames:
                numberOfGames !== null &&
                numberOfGames !== undefined
                    ? Number(numberOfGames)
                    : 0,

            playMode:
                playMode || "Solo",

            priorityOrder:
                Boolean(priorityOrder),

            premiumCoaching:
                Boolean(premiumCoaching),

            untrackableDuo:
                Boolean(untrackableDuo),

            bonusWin:
                Boolean(bonusWin),

            soloOnly:
                Boolean(soloOnly),

            highMMRDuo:
                Boolean(highMMRDuo),

            championPreferenceTier:
                championPreferenceTier || "4+",
        };

        const quote = calculateOrderPrice({
            rule: priceRule,
            options: pricingOptions,
            sale: activeSale,
            referenceRules,
        });

        return res.json({
            ok: true,
            quote,
            pricingUpdatedAt:
                priceRule.updatedAt,
        });
    } catch (error) {
        console.error(
            "getPriceQuote error:",
            error
        );

        return res.status(500).json({
            ok: false,
            message:
                "Failed to calculate current price.",
        });
    }
};