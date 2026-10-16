const preferenceSelect = { firstRole: true, secondRole: true, championIds: true };
const roles = new Set(['Top', 'Jungle', 'Middle', 'Bottom', 'Support']);
const invalid = message => { throw Object.assign(new Error(message), { status: 400 }); };
const emptyPreferences = () => ({ firstRole: null, secondRole: null, championIds: [] });

function validatePreferences(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body) ||
        Object.keys(body).length !== 3 || Object.keys(preferenceSelect).some(key => !Object.hasOwn(body, key))) {
        invalid('Choose your roles and preferred champions.');
    }
    const { firstRole, secondRole, championIds } = body;
    if (firstRole !== null && !roles.has(firstRole)) invalid('Choose a valid first role.');
    if (secondRole !== null && secondRole !== 'Fill' && !roles.has(secondRole)) invalid('Choose a valid second role.');
    if (secondRole !== null && (firstRole === null || firstRole === secondRole)) invalid('Choose a different second role or Fill.');
    // Data Dragon IDs, rather than user-supplied image URLs or display markup.
    // The client selects from Riot's roster; format validation also permits new
    // champions without tying profile saves to an external network request.
    if (!Array.isArray(championIds) || championIds.length > 5 || championIds.some(id =>
        typeof id !== 'string' || !/^[A-Za-z][A-Za-z0-9]{0,31}$/.test(id))) {
        invalid('Choose up to 5 valid preferred champions.');
    }
    if (new Set(championIds).size !== championIds.length) invalid('Choose each champion only once.');
    return { firstRole, secondRole, championIds: [...championIds] };
}

function missingPreferencesTable(error) {
    const cause = error?.meta?.driverAdapterError?.cause || error?.cause;
    if (![error?.code, error?.meta?.code, cause?.originalCode, cause?.code].some(code => code === 'P2021' || code === '42P01')) return false;
    if ([error?.meta?.table, error?.table, cause?.table].some(table => typeof table === 'string' &&
        /^(?:[\w]+\.)?BoosterPreferences$/.test(table.replace(/["`]/g, '')))) return true;
    return [error?.message, error?.meta?.message, cause?.originalMessage].some(message => typeof message === 'string' &&
        /relation ["`](?:[\w]+\.)?BoosterPreferences["`] does not exist/i.test(message));
}

async function loadPreferences(db, userId) {
    try {
        const preferences = await db.boosterPreferences.findUnique({ where: { userId }, select: preferenceSelect });
        return { preferences: preferences || emptyPreferences(), preferencesAvailable: true };
    } catch (error) {
        // Keep the existing portal available while this additive migration is
        // pending. Do not hide unrelated database failures as empty preferences.
        if (!missingPreferencesTable(error)) throw error;
        return { preferences: emptyPreferences(), preferencesAvailable: false };
    }
}

module.exports = { preferenceSelect, validatePreferences, missingPreferencesTable, loadPreferences };
