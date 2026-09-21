const prisma = require("../prisma");

const PRICING_CATALOG_TTL_MS = 15 * 1000;
const pricingCatalogCache = new Map();
const pendingCatalogLoads = new Map();
let catalogGeneration = 0;

function getSaleTimeWindow(now) {
    return {
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
}

function getCachedCatalog(cacheKey) {
    const cached = pricingCatalogCache.get(cacheKey);

    if (!cached) {
        return null;
    }

    if (cached.expiresAt <= Date.now()) {
        pricingCatalogCache.delete(cacheKey);
        return null;
    }

    return cached.catalog;
}

function getCatalogExpiry(catalog) {
    const ttlExpiry = Date.now() + PRICING_CATALOG_TTL_MS;
    const saleEnd = catalog.activeSale?.endsAt
        ? new Date(catalog.activeSale.endsAt).getTime()
        : Infinity;

    return Math.min(ttlExpiry, saleEnd);
}

async function loadPricingCatalog(boostType) {
    const priceRule = await prisma.servicePriceRule.findFirst({
        where: {
            active: true,
            service: {
                title: boostType,
            },
        },
        orderBy: {
            updatedAt: "desc",
        },
    });

    if (!priceRule) {
        return null;
    }

    const now = new Date();
    const saleTimeWindow = getSaleTimeWindow(now);

    const [serviceSale, globalSale, referenceWinRule] = await Promise.all([
        prisma.serviceSale.findFirst({
            where: {
                ...saleTimeWindow,
                scope: "SERVICE",
                serviceId: priceRule.serviceId,
            },
            orderBy: {
                createdAt: "desc",
            },
        }),
        prisma.serviceSale.findFirst({
            where: {
                ...saleTimeWindow,
                scope: "GLOBAL",
                serviceId: null,
            },
            orderBy: {
                createdAt: "desc",
            },
        }),
        priceRule.pricingType === "PER_WIN"
            ? Promise.resolve(priceRule)
            : prisma.servicePriceRule.findFirst({
                where: {
                    game: priceRule.game,
                    pricingType: "PER_WIN",
                    active: true,
                },
                orderBy: {
                    updatedAt: "desc",
                },
            }),
    ]);

    return {
        priceRule,
        activeSale: serviceSale || globalSale,
        referenceRules: referenceWinRule
            ? [referenceWinRule]
            : [],
    };
}

async function getPricingCatalog(boostType) {
    const cacheKey = String(boostType);
    const cached = getCachedCatalog(cacheKey);

    if (cached) {
        return cached;
    }

    const pendingLoad = pendingCatalogLoads.get(cacheKey);

    if (pendingLoad) {
        return pendingLoad;
    }

    const loadGeneration = catalogGeneration;
    const loadPromise = loadPricingCatalog(boostType)
        .then((catalog) => {
            if (catalog && loadGeneration === catalogGeneration) {
                pricingCatalogCache.set(cacheKey, {
                    catalog,
                    expiresAt: getCatalogExpiry(catalog),
                });
            }

            return catalog;
        })
        .finally(() => {
            if (pendingCatalogLoads.get(cacheKey) === loadPromise) {
                pendingCatalogLoads.delete(cacheKey);
            }
        });

    pendingCatalogLoads.set(cacheKey, loadPromise);

    return loadPromise;
}

function invalidatePricingCatalog() {
    catalogGeneration += 1;
    pricingCatalogCache.clear();
    pendingCatalogLoads.clear();
}

module.exports = {
    getPricingCatalog,
    invalidatePricingCatalog,
};