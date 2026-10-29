// Explicit route and field allowlists. Never persist request bodies, headers,
// passwords, signed URLs, file bytes, message contents or payment credentials.
const categories = { accounts: 'Accounts', orders: 'Orders', pricing: 'Pricing & sales', boosters: 'Boosters & contracts', earnings: 'Earnings & reviews' };
const definitions = [
    ['PATCH', '/admin/users/:id/role', 'accounts', 'account.role', 'user', ['role']],
    ['PATCH', '/admin/users/:id/suspension', 'accounts', 'account.suspension', 'user', ['suspended', 'reason']],
    ['PATCH', '/admin/users/:id/booster-access', 'accounts', 'account.booster-access', 'user', ['hasBoosterAccess']],
    ['PATCH', '/admin/prices/rules/:id/availability', 'pricing', 'service.availability', 'priceRule', ['active']],
    ['PATCH', '/admin/prices/rules/:id', 'pricing', 'pricing.update', 'priceRule', ['config']],
    ['POST', '/admin/prices/sales', 'pricing', 'sale.create', 'sale', ['serviceId', 'scope', 'title', 'discountPercent', 'startsAt', 'endsAt', 'appliesTo', 'couponCode', 'couponServiceIds', 'personalCoupon', 'recipientAccountId', 'recipientAccountIds', 'personalReason', 'footerDecoration', 'footerTimer']],
    ['PATCH', '/admin/prices/sales/:id/disable', 'pricing', 'sale.disable', 'sale', []],
    ['POST', '/services', 'pricing', 'service.create', 'service', ['title', 'description']],
    ['PATCH', '/orders/admin/:id/status', 'orders', 'order.status', 'order', ['status']],
    ['POST', '/orders/:id/assign/:boosterId', 'orders', 'order.assign', 'order', []],
    ['DELETE', '/orders/:id/assign/:boosterId', 'orders', 'order.unassign', 'order', []],
    ['PATCH', '/orders/:id/provider-complete', 'orders', 'order.complete', 'order', []],
    ['POST', '/operations/boosters/:boosterId/contracts', 'boosters', 'contract.create', 'contract', ['requestId', 'title', 'startsAt']],
    ['POST', '/operations/contracts/:id/retry', 'boosters', 'contract.retry', 'contract', []],
    ['POST', '/operations/contracts/:id/prepare', 'boosters', 'contract.prepare', 'contract', []],
    ['POST', '/operations/contracts/:id/sign', 'boosters', 'contract.sign', 'contract', ['requestId', 'documentHash']],
    ['POST', '/operations/contracts/:id/native-replacement', 'boosters', 'contract.native-replacement', 'contract', ['requestId']],
    ['POST', '/operations/contributions/:id/:boosterId/review', 'earnings', 'contribution.review', 'order', ['revision', 'decision', 'note']],
    ['POST', '/operations/match-history/:id/manual-count', 'earnings', 'matches.manual-count', 'order', ['boosterId', 'matches', 'revision']],
    ['POST', '/operations/match-history/:id/:matchId/review', 'earnings', 'match.review', 'match', ['decision', 'revision', 'boosterId', 'note']],
    ['POST', '/operations/match-history/:id/confirm', 'earnings', 'matches.confirm', 'order', ['revision']],
    ['POST', '/operations/match-history/:id/reopen', 'earnings', 'matches.reopen', 'order', ['revision']],
];
// These events use their own transaction-bound, metadata-only journal rather
// than the ADMIN-only HTTP middleware. Keep them visible in the owner feed.
const visibleActions = Object.freeze([...new Set([...definitions.map(([, , , action]) => action), 'assignment.accept', 'order.leave',
    'payout.request', 'payout.submit', 'payout.review', 'payout.reveal', 'payout.country'])]);
const actions = {
    'account.role': 'Changed account role', 'account.suspension': 'Changed account suspension',
    'account.booster-access': 'Changed booster access', 'service.availability': 'Changed service availability', 'pricing.update': 'Updated pricing',
    'sale.create': 'Created sale or coupon', 'sale.disable': 'Disabled sale or coupon', 'service.create': 'Created service',
    'order.status': 'Changed order status', 'order.assign': 'Assigned booster', 'order.unassign': 'Unassigned booster',
    'order.complete': 'Completed assigned order', 'order.leave': 'Left assigned order',
    'assignment.accept': 'Accepted order assignment',
    'payout.request': 'Requested payout information', 'payout.submit': 'Submitted payout information',
    'payout.review': 'Reviewed payout information', 'payout.reveal': 'Viewed private payout details',
    'payout.country': 'Changed payout country',
    'contract.create': 'Issued booster contract', 'contract.retry': 'Delivered booster contract',
    'contract.prepare': 'Prepared agreement for signing', 'contract.sign': 'Signed agreement', 'contract.native-replacement': 'Replaced unsigned sandbox agreement',
    'contribution.review': 'Reviewed match count', 'matches.manual-count': 'Approved manual match count',
    'match.review': 'Reviewed match', 'matches.confirm': 'Confirmed match earnings',
    'matches.reopen': 'Reopened match review',
};
const routes = definitions.map(([method, path, category, action, targetType, fields]) => {
    const names = [...path.matchAll(/:(\w+)/g)].map(match => match[1]);
    return { method, category, action, targetType, fields, names, pattern: new RegExp(`^${path.replace(/:\w+/g, '([^/]+)')}/?$`, 'i') };
});
function routeFor(method, path) {
    for (const route of routes) {
        if (route.method !== method) continue;
        const match = path.match(route.pattern);
        if (match) return { ...route, params: Object.fromEntries(route.names.map((name, i) => [name, decodeURIComponent(match[i + 1])])) };
    }
    return null;
}
// Recursively keep data bounded and reject unexpected secret-shaped keys, even
// inside allowed pricing config. No arbitrary request object reaches this helper.
function safe(value, depth = 0) {
    if (value == null || typeof value === 'boolean') return value ?? null;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value === 'string') return value.slice(0, 1000);
    if (value instanceof Date) return value.toISOString();
    if (depth > 8) return '[Additional detail omitted]';
    if (Array.isArray(value)) return value.slice(0, 1000).map(item => safe(item, depth + 1));
    if (typeof value === 'object') return Object.fromEntries(Object.entries(value).slice(0, 200)
        .filter(([key]) => !/password|token|secret|authorization|cookie|cipher|encrypted|authTag|privateKey|signedUrl/i.test(key))
        .map(([key, item]) => [key, safe(item, depth + 1)]));
    return null;
}
const pick = (value, fields) => Object.fromEntries(fields.filter(key => value?.[key] !== undefined).map(key => [key, safe(value[key])]));
const selectors = {
    user: ['id', 'username', 'role', 'isOwner', 'hasBoosterAccess', 'suspendedAt', 'suspendedReason'],
    order: ['id', 'orderNumber', 'status', 'paymentStatus', 'matchHistoryRevision', 'matchHistoryConfirmedAt'],
    priceRule: ['id', 'serviceId', 'game', 'pricingType', 'active', 'basePrice', 'config'],
    sale: ['id', 'title', 'scope', 'serviceId', 'active', 'discountPercent', 'startsAt', 'endsAt', 'appliesTo', 'couponCode', 'couponServiceIds', 'recipientAccountId', 'recipientAccountIds', 'personalReason', 'footerDecoration', 'footerTimer'],
    service: ['id', 'title', 'description'],
    contract: ['id', 'boosterId', 'title', 'startsAt', 'status', 'signedAt', 'companySignedAt', 'boosterSignedAt', 'revokedAt', 'archivedAt', 'signingProvider', 'nativePreparedAt', 'nativeCompletedAt', 'nativeDocumentHash', 'replacesContractId'],
    match: ['id', 'orderId', 'externalId', 'status', 'boosterId', 'revision'],
};
const models = { user: 'user', order: 'order', priceRule: 'servicePriceRule', sale: 'serviceSale', service: 'service',
    contract: 'boosterContract', match: 'orderMatch' };
async function snapshot(db, route, id) {
    if (!id) return null;
    const fields = selectors[route.targetType];
    const select = Object.fromEntries(fields.map(field => [field, true]));
    if (route.targetType === 'order') {
        select.assignments = { select: { boosterId: true, booster: { select: { username: true } } }, orderBy: { boosterId: 'asc' } };
        if (route.category === 'earnings') {
            select.contributions = { select: { boosterId: true, booster: { select: { username: true } }, submittedMatches: true, approvedMatches: true, reviewedAt: true, revision: true }, orderBy: { boosterId: 'asc' } };
        }
    }
    if (route.targetType === 'priceRule' || route.targetType === 'sale') select.service = { select: { title: true } };
    if (route.targetType === 'sale') select.recipientAccount = { select: { username: true } };
    if (route.targetType === 'contract') select.booster = { select: { username: true } };
    if (route.targetType === 'match') {
        select.order = { select: { orderNumber: true } };
        select.booster = { select: { username: true } };
    }
    const result = await db[models[route.targetType]].findUnique({ where: { id }, select });
    if (result?.discountPercent != null) result.discountPercent = String(result.discountPercent);
    if (result?.basePrice != null) result.basePrice = String(result.basePrice);
    if (route.targetType === 'sale' && result?.recipientAccountIds?.length) {
        result.recipientAccounts = await db.user.findMany({ where: { id: { in: result.recipientAccountIds } }, select: { id: true, username: true } });
    }
    return result ? safe(result) : null;
}
function labelFor(route, state) {
    if (!state) return null;
    switch (route.targetType) {
        case 'user': return state.username || 'Unknown user';
        case 'order': return state.orderNumber || 'Order';
        case 'priceRule': return [state.service?.title || state.game || 'Pricing', state.pricingType].filter(Boolean).join(' · ');
        case 'sale': case 'service': return state.title || null;
        case 'contract': return [state.title || 'Agreement', state.booster?.username].filter(Boolean).join(' · ');
        case 'match': return [state.order?.orderNumber || 'Order match', state.booster?.username].filter(Boolean).join(' · ');
        default: return null;
    }
}
function normalized(value) {
    if (Array.isArray(value)) return value.map(normalized);
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, normalized(value[key])]));
    return value ?? null;
}
const same = (a, b) => JSON.stringify(normalized(a)) === JSON.stringify(normalized(b));
function materialChange(route, before, after) {
    const fields = {
        'account.role': ['role'], 'account.suspension': ['suspendedAt', 'suspendedReason'], 'account.booster-access': ['hasBoosterAccess'],
        'service.availability': ['active'], 'pricing.update': ['basePrice', 'config'], 'sale.disable': ['active'],
        'order.status': ['status'], 'order.assign': ['assignments', 'status'], 'order.unassign': ['assignments', 'status'],
        'order.complete': ['status'], 'contract.retry': ['status'], 'contract.prepare': ['nativeDocumentHash'],
        'contract.sign': ['companySignedAt', 'boosterSignedAt', 'signedAt', 'status'],
        'contract.native-replacement': ['revokedAt', 'status'],
        'contribution.review': ['contributions'], 'matches.manual-count': ['contributions'],
        'match.review': ['status', 'boosterId', 'revision'],
        'matches.confirm': ['matchHistoryConfirmedAt', 'matchHistoryRevision'],
        'matches.reopen': ['matchHistoryConfirmedAt', 'matchHistoryRevision'],
    }[route.action];
    if (['sale.create', 'service.create'].includes(route.action)) return !before && Boolean(after?.id);
    if (route.action === 'contract.create') return !same(before, after) && Boolean(after?.id);
    if (!before || !after || !fields) return false;
    return fields.some(field => !same(before[field], after[field]));
}
function requestDetails(route, req) {
    const details = { ...pick(req.body, route.fields), ...pick(route.params, ['boosterId', 'matchId']) };
    if (route.targetType === 'match') details.orderId = route.params.id;
    return details;
}
function responseDetails(route, body) {
    return pick(body, ['addedCount', 'removedCount']);
}
function resultId(route, body) {
    if (route.action === 'sale.create') return body?.sale?.id;
    if (route.action === 'service.create') return body?.service?.id;
    if (route.action === 'contract.create') return body?.id;
    return undefined;
}
module.exports = { categories, actions, definitions, visibleActions, routeFor, safe, snapshot, labelFor, materialChange, requestDetails, responseDetails, resultId };
