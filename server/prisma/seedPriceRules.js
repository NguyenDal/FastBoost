require("dotenv").config();

const prisma = require("../src/prisma");

const rankOptions = [
    "Iron IV",
    "Iron III",
    "Iron II",
    "Iron I",
    "Bronze IV",
    "Bronze III",
    "Bronze II",
    "Bronze I",
    "Silver IV",
    "Silver III",
    "Silver II",
    "Silver I",
    "Gold IV",
    "Gold III",
    "Gold II",
    "Gold I",
    "Platinum IV",
    "Platinum III",
    "Platinum II",
    "Platinum I",
    "Emerald IV",
    "Emerald III",
    "Emerald II",
    "Emerald I",
    "Diamond IV",
    "Diamond III",
    "Diamond II",
    "Diamond I",
];

const lolDivisionStepPrices = {
    "Iron IV": 8,
    "Iron III": 8,
    "Iron II": 8,
    "Iron I": 8,
    "Bronze IV": 8,
    "Bronze III": 8,
    "Bronze II": 8,
    "Bronze I": 8,
    "Silver IV": 10,
    "Silver III": 10,
    "Silver II": 10,
    "Silver I": 10,
    "Gold IV": 12,
    "Gold III": 14,
    "Gold II": 16,
    "Gold I": 18,
    "Platinum IV": 20,
    "Platinum III": 22,
    "Platinum II": 24,
    "Platinum I": 26,
    "Emerald IV": 30,
    "Emerald III": 35,
    "Emerald II": 40,
    "Emerald I": 45,
    "Diamond IV": 59,
    "Diamond III": 69,
    "Diamond II": 79,
    "Diamond I": 120,
};

const tftDivisionStepPrices = {
    "Iron IV": 4,
    "Iron III": 4,
    "Iron II": 4,
    "Iron I": 4,

    "Bronze IV": 4,
    "Bronze III": 4,
    "Bronze II": 4,
    "Bronze I": 4,

    "Silver IV": 5,
    "Silver III": 6,
    "Silver II": 7,
    "Silver I": 7,

    "Gold IV": 7,
    "Gold III": 8,
    "Gold II": 9,
    "Gold I": 10,

    "Platinum IV": 10,
    "Platinum III": 11,
    "Platinum II": 12,
    "Platinum I": 13,

    "Emerald IV": 13,
    "Emerald III": 15,
    "Emerald II": 17,
    "Emerald I": 20,

    "Diamond IV": 22,
    "Diamond III": 27,
    "Diamond II": 32,
    "Diamond I": 40,
};

const lolPlacementPrices = {
    Unranked: 24,
    Iron: 15,
    Bronze: 15,
    Silver: 21,
    Gold: 25,
    Platinum: 30,
    Emerald: 38,

    // Tier fallback
    Diamond: 45,

    // Exact Diamond division prices
    "Diamond IV": 45,
    "Diamond III": 45,
    "Diamond II": 45,
    "Diamond I": 60,

    Master: 60,
    Grandmaster: 88,
    Challenger: 88,
};

const tftPlacementPrices = {
    Unranked: 15,
    Iron: 15,
    Bronze: 15,
    Silver: 15,
    Gold: 17,
    Platinum: 20,
    Emerald: 25,
    "Diamond IV": 30,
    "Diamond III": 32,
    "Diamond II": 37,
    "Diamond I": 40,
    Master: 49,
    Grandmaster: 49,
    Challenger: 49,
};

const lolWinBoostPrices = {
    Iron: 3,
    Bronze: 3,
    Silver: 3,
    Gold: 5,
    Platinum: 6,
    "Emerald IV": 7,
    "Emerald III": 8,
    "Emerald II": 9,
    "Emerald I": 10,
    "Diamond IV": 12,
    "Diamond III": 14,
    "Diamond II": 18,
    "Diamond I": 22,
    Master: 30,
    Grandmaster: 40,
};

const tftWinBoostPrices = {
    Iron: 3,
    Bronze: 3,
    Silver: 3,
    Gold: 4,
    Platinum: 5,
    Emerald: 6,
    Diamond: 8,
    Master: 18,
    Grandmaster: 22,
};

const sharedModifiers = {
    currentLpProgress: {
        "0-20 LP": 1,
        "21-40 LP": 0.8,
        "41-60 LP": 0.6,
        "61-80 LP": 0.4,
        "81-99 LP": 0.2,
    },
    divisionLpGain: {
        "0-18 LP / win": 1.1,
        "18-23 LP / win": 1,
        "23-28 LP / win": 0.95,
        "28+ LP / win": 0.9,
    },
    netWinLpGain: {
        "0-18 LP / win": 1,
        "18-23 LP / win": 1,
        "23-28 LP / win": 1.05,
        "28+ LP / win": 1.1,
    },
};

const addonRules = {
    duoModeMultiplier: 1.4,
    duoExtraPercent: 0.4,
    expressPercent: 0.15,
    premiumCoachingPercent: 0.4,
    soloOnlyPercent: 0.3,
    highMmrDuoPercent: 0.2,
    untrackableDuoPercent: 0.3,
    championPreference: {
        "1": 0.1,
        "2-3": 0.05,
        "4+": 0,
    },
    bonusWin: {
        solo: "same as win boost price by rank",
        duoMultiplier: 1.4,
    },
};

const pricingRuleMap = {
    "Rank Boost": {
        game: "LoL",
        pricingType: "RANK_BASED",
        basePrice: null,
        config: {
            rankOptions,
            divisionStepPrices: lolDivisionStepPrices,
            masterLpPricing: {
                first100LpPerLp: 1,
                above100LpPerLp: 1.5,
            },
            modifiers: {
                currentLpProgress: sharedModifiers.currentLpProgress,
                lpGain: sharedModifiers.divisionLpGain,
            },
            addons: addonRules,
        },
    },

    "Placement Boost": {
        game: "LoL",
        pricingType: "PLACEMENT_BASED",
        basePrice: null,
        config: {
            fullSetGames: 5,
            fullSetPrices: lolPlacementPrices,
            formula:
                "price = (exactRankPrice or tierPrice) / 5 * selectedGames",
            addons: addonRules,
        },
    },

    "Win Boost": {
        game: "LoL",
        pricingType: "PER_WIN",
        basePrice: null,
        config: {
            perWinPrices: lolWinBoostPrices,
            modifiers: {
                lpGain: sharedModifiers.netWinLpGain,
            },
            formula: "price = perWinPrice * lpGainModifier * desiredWins",
            addons: addonRules,
        },
    },

    "Pro Duo": {
        game: "LoL",
        pricingType: "DUO_ADDON",
        basePrice: null,
        config: {
            source: "LoL Win Boost",
            multiplier: 0.75,
            formula: "price = calculateWinBoostPrice(currentRank, lpGain, 1) * 0.75 * numberOfGames",
            perWinPrices: lolWinBoostPrices,
            modifiers: {
                lpGain: sharedModifiers.netWinLpGain,
            },
            addons: addonRules,
        },
    },

    "TFT Rank Boost": {
        game: "TFT",
        pricingType: "RANK_BASED",
        basePrice: null,
        config: {
            rankOptions,
            divisionStepPrices: tftDivisionStepPrices,
            masterLpPricing: {
                perLp: 1.3,
            },
            modifiers: {
                currentLpProgress: sharedModifiers.currentLpProgress,
            },
            addons: addonRules,
        },
    },

    "TFT Win Boost": {
        game: "TFT",
        pricingType: "PER_WIN",
        basePrice: null,
        config: {
            perWinPrices: tftWinBoostPrices,
            formula: "price = perWinPrice * desiredWins",
            addons: addonRules,
        },
    },

    "TFT Placement Boost": {
        game: "TFT",
        pricingType: "PLACEMENT_BASED",
        basePrice: null,
        config: {
            fullSetGames: 5,
            fullSetPrices: tftPlacementPrices,
            formula: "price = fullSetPrice / 5 * selectedGames",
            addons: addonRules,
        },
    },
};

async function main() {
    const services = await prisma.service.findMany();

    console.log(`Found ${services.length} services.`);

    for (const service of services) {
        const rule = pricingRuleMap[service.title];

        if (!rule) {
            console.log(`Skipped: ${service.title}`);
            continue;
        }

        await prisma.servicePriceRule.upsert({
            where: {
                id: `${service.id}-price-rule`,
            },
            update: {
                game: rule.game,
                pricingType: rule.pricingType,
                basePrice: rule.basePrice,
                config: rule.config,
                active: true,
            },
            create: {
                id: `${service.id}-price-rule`,
                serviceId: service.id,
                game: rule.game,
                pricingType: rule.pricingType,
                basePrice: rule.basePrice,
                config: rule.config,
                active: true,
            },
        });

        console.log(`Seeded real price rule: ${service.title}`);
    }

    console.log("Done seeding real service price rules.");
}

main()
    .catch((error) => {
        console.error("Seed price rules error:", error);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });