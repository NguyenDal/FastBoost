function toNumber(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
}

function roundMoney(value) {
    return Math.round((toNumber(value) + Number.EPSILON) * 100) / 100;
}

function getTier(rank) {
    return String(rank || "").split(" ")[0];
}

function getExactOrTierPrice(priceMap, rank) {
    const prices = priceMap || {};
    const tier = getTier(rank);

    if (prices[rank] !== undefined) {
        return toNumber(prices[rank]);
    }

    if (prices[tier] !== undefined) {
        return toNumber(prices[tier]);
    }

    return 0;
}

function clampMasterLp(value) {
    return Math.max(0, Math.min(999, toNumber(value)));
}

function calculateMasterLpPrice(masterPricing, startLp, endLp) {
    const pricing = masterPricing || {};

    const start = clampMasterLp(startLp);
    const end = clampMasterLp(endLp);

    if (end <= start) {
        return 0;
    }

    // TFT-style flat Master LP price
    if (pricing.perLp !== undefined) {
        return (end - start) * toNumber(pricing.perLp);
    }

    // LoL-style first 100 / above 100 pricing
    const first100Price = toNumber(pricing.first100LpPerLp);
    const above100Price = toNumber(pricing.above100LpPerLp);

    const lpTo100 =
        Math.max(0, Math.min(end, 100) - Math.min(start, 100));

    const lpAbove100 =
        Math.max(0, end - Math.max(start, 100));

    return (
        lpTo100 * first100Price +
        lpAbove100 * above100Price
    );
}

function calculateRankBasedPrice(rule, options) {
    const config = rule.config || {};

    const rankOptions = config.rankOptions || [];
    const stepPrices = config.divisionStepPrices || {};

    const currentTier = getTier(options.currentRank);
    const desiredTier = getTier(options.desiredRank);

    const currentLpModifier = toNumber(
        config.modifiers?.currentLpProgress?.[options.currentLP],
        1
    );

    const lpGainModifier = toNumber(
        config.modifiers?.lpGain?.[options.lpGain],
        1
    );

    // Master → Master
    if (currentTier === "Master" && desiredTier === "Master") {
        const masterPrice = calculateMasterLpPrice(
            config.masterLpPricing,
            options.currentMasterLp,
            options.desiredMasterLp
        );

        return masterPrice * lpGainModifier;
    }

    // Master cannot currently boost downward.
    if (currentTier === "Master" && desiredTier !== "Master") {
        return 0;
    }

    const currentIndex = rankOptions.indexOf(options.currentRank);

    if (currentIndex === -1) {
        return 0;
    }

    /*
     * Division → Master
     *
     * Finish every division step, including Diamond I → Master,
     * then add the requested Master LP.
     */
    if (desiredTier === "Master") {
        let total = 0;

        for (let i = currentIndex; i < rankOptions.length; i += 1) {
            const rank = rankOptions[i];
            const stepPrice = toNumber(stepPrices[rank]);

            if (i === currentIndex) {
                total +=
                    stepPrice *
                    currentLpModifier *
                    lpGainModifier;
            } else {
                total += stepPrice * lpGainModifier;
            }
        }

        total +=
            calculateMasterLpPrice(
                config.masterLpPricing,
                0,
                options.desiredMasterLp
            ) * lpGainModifier;

        return total;
    }

    const desiredIndex = rankOptions.indexOf(options.desiredRank);

    if (
        desiredIndex === -1 ||
        desiredIndex <= currentIndex
    ) {
        return 0;
    }

    let total = 0;

    for (let i = currentIndex; i < desiredIndex; i += 1) {
        const rank = rankOptions[i];
        const stepPrice = toNumber(stepPrices[rank]);

        if (i === currentIndex) {
            total +=
                stepPrice *
                currentLpModifier *
                lpGainModifier;
        } else {
            total += stepPrice * lpGainModifier;
        }
    }

    return total;
}

function calculatePlacementPrice(rule, options) {
    const config = rule.config || {};

    const fullSetGames = Math.max(
        1,
        toNumber(config.fullSetGames, 5)
    );

    const fullSetPrice = getExactOrTierPrice(
        config.fullSetPrices,
        options.peakRank
    );

    const requestedGames = Math.max(
        1,
        Math.min(
            fullSetGames,
            toNumber(options.placementGames, 1)
        )
    );

    return (fullSetPrice / fullSetGames) * requestedGames;
}

function calculatePerWinPrice(rule, options) {
    const config = rule.config || {};

    const pricePerWin = getExactOrTierPrice(
        config.perWinPrices,
        options.currentRank
    );

    const lpGainModifier = toNumber(
        config.modifiers?.lpGain?.[options.lpGain],
        1
    );

    const desiredWins = Math.max(
        1,
        toNumber(options.desiredWins, 1)
    );

    return (
        pricePerWin *
        lpGainModifier *
        desiredWins
    );
}

function calculateDuoAddonPrice(rule, options) {
    const config = rule.config || {};

    const pricePerGame = getExactOrTierPrice(
        config.perWinPrices,
        options.currentRank
    );

    const lpGainModifier = toNumber(
        config.modifiers?.lpGain?.[options.lpGain],
        1
    );

    const multiplier = toNumber(config.multiplier, 1);

    const games = Math.max(
        1,
        toNumber(options.numberOfGames, 1)
    );

    return (
        pricePerGame *
        lpGainModifier *
        multiplier *
        games
    );
}

function calculateBasePrice(rule, options) {
    switch (rule.pricingType) {
        case "RANK_BASED":
            return calculateRankBasedPrice(rule, options);

        case "PLACEMENT_BASED":
            return calculatePlacementPrice(rule, options);

        case "PER_WIN":
            return calculatePerWinPrice(rule, options);

        case "DUO_ADDON":
            return calculateDuoAddonPrice(rule, options);

        default:
            return toNumber(rule.basePrice);
    }
}

function findReferenceWinRule(rule, referenceRules = []) {
    return referenceRules.find(
        (candidate) =>
            candidate.active !== false &&
            candidate.game === rule.game &&
            candidate.pricingType === "PER_WIN"
    );
}

function calculateAddonPrice({
    rule,
    options,
    basePrice,
    referenceRules = [],
}) {
    const addons = rule.config?.addons || {};

    const isProDuo = rule.pricingType === "DUO_ADDON";
    const isDuo =
        options.playMode === "Duo" && !isProDuo;

    const duoMultiplier = toNumber(
        addons.duoModeMultiplier,
        1.4
    );

    const duoExtraPercent = toNumber(
        addons.duoExtraPercent,
        Math.max(0, duoMultiplier - 1)
    );

    /*
     * Preserve the existing FastBoost behavior:
     *
     * basePrice stays the original calculated price.
     * The Duo surcharge is counted in addonPrice.
     * Other Duo add-ons use the Duo-adjusted base.
     */
    const adjustedBaseForAddons = isDuo
        ? basePrice * duoMultiplier
        : basePrice;

    let addonPrice = 0;

    if (isDuo) {
        addonPrice += basePrice * duoExtraPercent;
    }

    if (options.priorityOrder) {
        addonPrice +=
            adjustedBaseForAddons *
            toNumber(addons.expressPercent);
    }

    if (
        options.playMode === "Duo" &&
        options.premiumCoaching
    ) {
        addonPrice +=
            adjustedBaseForAddons *
            toNumber(addons.premiumCoachingPercent);
    }

    if (
        options.playMode === "Solo" &&
        options.soloOnly
    ) {
        addonPrice +=
            adjustedBaseForAddons *
            toNumber(addons.soloOnlyPercent);
    }

    if (
        options.playMode === "Duo" &&
        options.highMMRDuo
    ) {
        addonPrice +=
            adjustedBaseForAddons *
            toNumber(addons.highMmrDuoPercent);
    }

    if (
        options.playMode === "Duo" &&
        options.untrackableDuo
    ) {
        addonPrice +=
            adjustedBaseForAddons *
            toNumber(addons.untrackableDuoPercent);
    }

    if (options.bonusWin) {
        /*
         * Bonus Win always follows the current Win Boost
         * rule for the same game.
         *
         * This means editing Win Boost through Admin also
         * updates Bonus Win automatically.
         */
        const winRule = findReferenceWinRule(
            rule,
            referenceRules
        );

        const winPrice = getExactOrTierPrice(
            winRule?.config?.perWinPrices,
            options.currentRank
        );

        const bonusDuoMultiplier = toNumber(
            addons.bonusWin?.duoMultiplier,
            duoMultiplier
        );

        addonPrice +=
            options.playMode === "Duo"
                ? winPrice * bonusDuoMultiplier
                : winPrice;
    }

    const championPercent = toNumber(
        addons.championPreference?.[
            options.championPreferenceTier
        ]
    );

    addonPrice +=
        adjustedBaseForAddons *
        championPercent;

    return addonPrice;
}

function isSaleActive(sale, now = new Date()) {
    if (!sale || !sale.active) {
        return false;
    }

    if (
        sale.startsAt &&
        new Date(sale.startsAt) > now
    ) {
        return false;
    }

    if (
        sale.endsAt &&
        new Date(sale.endsAt) < now
    ) {
        return false;
    }

    return true;
}

function calculateSaleDiscount({
    sale,
    basePrice,
    subtotal,
}) {
    if (!isSaleActive(sale)) {
        return 0;
    }

    const discountPercent = Math.max(
        0,
        Math.min(90, toNumber(sale.discountPercent))
    );

    const appliesTo = String(
        sale.appliesTo || "BASE_PRICE"
    ).toUpperCase();

    const appliesToWholeOrder = [
        "TOTAL",
        "ORDER_TOTAL",
        "WHOLE_ORDER",
        "WHOLE_ORDER_TOTAL",
    ].includes(appliesTo);

    const discountSource = appliesToWholeOrder
        ? subtotal
        : basePrice;

    return (
        discountSource *
        (discountPercent / 100)
    );
}

function calculateOrderPrice({
    rule,
    options,
    sale = null,
    referenceRules = [],
}) {
    if (!rule || rule.active === false) {
        throw new Error(
            "No active pricing rule is available for this service."
        );
    }

    const basePrice = calculateBasePrice(
        rule,
        options
    );

    const addonPrice = calculateAddonPrice({
        rule,
        options,
        basePrice,
        referenceRules,
    });

    const subtotal = basePrice + addonPrice;

    const saleDiscount = calculateSaleDiscount({
        sale,
        basePrice,
        subtotal,
    });

    const totalPrice = Math.max(
        0,
        subtotal - saleDiscount
    );

    return {
        basePrice: roundMoney(basePrice),
        addonPrice: roundMoney(addonPrice),
        subtotal: roundMoney(subtotal),
        saleDiscount: roundMoney(saleDiscount),
        totalPrice: roundMoney(totalPrice),
    };
}

module.exports = {
    calculateOrderPrice,
    isSaleActive,
};