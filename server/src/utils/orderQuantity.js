const invalid = field => {
    throw Object.assign(new Error(`Please enter a valid ${field}.`), { status: 400 });
};

function integer(value, field, min, max, fallback) {
    if (value == null || value === '') return fallback;
    if (!['string', 'number'].includes(typeof value) || (typeof value === 'string' && !/^\d+$/.test(value))) invalid(field);
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < min || number > max) invalid(field);
    return number;
}

// Price and persist the same validated quantities. The calculator's defensive
// clamping must never let a different service quantity appear on the order.
function orderQuantities(body, rule) {
    const fullSetGames = Number(rule.config?.fullSetGames ?? 5);
    const placementLimit = Number.isSafeInteger(fullSetGames) && fullSetGames > 0 ? fullSetGames : 5;
    const result = {
        currentMasterLp: integer(body.currentMasterLp, 'current Master LP', 0, 999, 0),
        desiredMasterLp: integer(body.desiredMasterLp, 'desired Master LP', 0, 999, 0),
        desiredWins: integer(body.desiredWins, 'win count', 1, 2147483647, rule.pricingType === 'PER_WIN' ? 1 : null),
        placementGames: integer(body.placementGames, 'placement game count', 1, placementLimit, rule.pricingType === 'PLACEMENT_BASED' ? 1 : null),
        numberOfGames: integer(body.numberOfGames, 'game count', 1, 2147483647, rule.pricingType === 'DUO_ADDON' ? 1 : null),
    };
    return result;
}

function orderChampionPreferences(value) {
    if (value == null) value = [];
    if (!Array.isArray(value) || value.length > 256) invalid('champion selection');
    const selectedChampions = [];
    const seen = new Set();
    for (const name of value) {
        if (typeof name !== 'string' || !name.trim() || name.length > 100) invalid('champion selection');
        const normalized = name.normalize('NFKC').replace(/\p{Cf}/gu, '').trim();
        if (!normalized) invalid('champion selection');
        const key = normalized.toLowerCase();
        if (!seen.has(key)) { seen.add(key); selectedChampions.push(normalized); }
    }
    const count = selectedChampions.length;
    return { selectedChampions, championPreferenceTier: !count || count >= 4 ? '4+' : count === 1 ? '1' : '2-3' };
}

module.exports = { orderQuantities, orderChampionPreferences };
