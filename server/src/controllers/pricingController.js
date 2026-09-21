const {
    calculateOrderPrice,
} = require("../utils/pricingCalculator");
const {
    getPricingCatalog,
} = require("../utils/pricingCatalogCache");

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

        const pricingCatalog = await getPricingCatalog(boostType);

        if (!pricingCatalog) {
            return res.status(404).json({
                ok: false,
                message:
                    "No active pricing rule found for this service.",
            });
        }

        const {
            priceRule,
            activeSale,
            referenceRules,
        } = pricingCatalog;

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