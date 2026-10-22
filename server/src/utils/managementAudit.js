// Explicit route and field allowlists. Never persist request bodies, headers,
// passwords, signed URLs, file bytes, message contents or payment credentials.
const categories = { accounts: 'Accounts', orders: 'Orders', pricing: 'Pricing & sales', boosters: 'Boosters & contracts', earnings: 'Earnings & reviews', support: 'Support' };
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
    ['PATCH', '/orders/:id/login-info', 'orders', 'order.login-info', 'order', []],
    ['PATCH', '/orders/:id/provider-complete', 'orders', 'order.complete', 'order', []],
    ['DELETE', '/orders/:id/provider-leave', 'orders', 'order.leave', 'order', []],
    ['POST', '/assignment-requests/orders/:id/boosters/:boosterId', 'orders', 'assignment.invite', 'order', []],
    ['PATCH', '/assignment-requests/:id/cancel', 'orders', 'assignment.cancel', 'assignment', []],
    ['PATCH', '/assignment-requests/:id/accept', 'orders', 'assignment.accept', 'assignment', []],
    ['PATCH', '/assignment-requests/:id/decline', 'orders', 'assignment.decline', 'assignment', []],
    ['PATCH', '/operations/boosters/:id', 'boosters', 'booster.start-date', 'booster', ['startedAt']],
    ['POST', '/operations/earnings/export', 'earnings', 'earnings.export', 'report', ['exportType', 'from', 'to', 'rowCount', 'query', 'reviewStatus', 'boosterId']],
    ['POST', '/operations/boosters/:boosterId/contracts', 'boosters', 'contract.create', 'contract', ['requestId', 'title', 'startsAt']],
    ['POST', '/operations/contracts/:id/retry', 'boosters', 'contract.retry', 'contract', []],
    ['POST', '/operations/contracts/:id/sync', 'boosters', 'contract.sync', 'contract', []],
    ['POST', '/operations/contracts/:id/signing-view', 'boosters', 'contract.signing-view', 'contract', []],
    ['GET', '/operations/contracts/:id/signing', 'boosters', 'contract.signing-view', 'contract', []],
    ['POST', '/operations/contracts/:id/prepare', 'boosters', 'contract.prepare', 'contract', []],
    ['POST', '/operations/contracts/:id/sign', 'boosters', 'contract.sign', 'contract', ['requestId', 'documentHash']],
    ['POST', '/operations/contracts/:id/native-replacement', 'boosters', 'contract.native-replacement', 'contract', ['requestId']],
    ['GET', '/operations/contracts/:id/document', 'boosters', 'contract.download', 'contract', []],
    ['POST', '/operations/contributions/:id', 'earnings', 'contribution.submit', 'order', ['matches']],
    ['POST', '/operations/contributions/:id/:boosterId/review', 'earnings', 'contribution.review', 'order', ['revision', 'decision', 'note']],
    ['POST', '/operations/match-history/:id/manual-count', 'earnings', 'matches.manual-count', 'order', ['boosterId', 'matches', 'revision']],
    ['POST', '/operations/match-history/:id/import', 'earnings', 'matches.import', 'order', ['start']],
    ['POST', '/operations/match-history/:id/:matchId/review', 'earnings', 'match.review', 'match', ['decision', 'revision', 'boosterId', 'note']],
    ['POST', '/operations/match-history/:id/confirm', 'earnings', 'matches.confirm', 'order', ['revision']],
    ['POST', '/operations/match-history/:id/reopen', 'earnings', 'matches.reopen', 'order', ['revision']],
    ['POST', '/operations/match-history/:id/submit', 'earnings', 'matches.submit', 'order', ['mode', 'revision', 'matches', 'estimatedCents']],
    ['POST', '/support/threads/:id/messages', 'support', 'support.reply', 'supportThread', []],
    ['GET', '/support/attachments/:id', 'support', 'support.attachment-view', 'supportMessage', []],
    ['POST', '/chats/conversations/:id/messages', 'orders', 'order.message', 'conversation', []],
    ['POST', '/chats/conversations/:id/attachments', 'orders', 'order.attachment', 'conversation', []],
    ['GET', '/chats/messages/:id/attachment', 'orders', 'order.attachment-view', 'message', []],
];
const actions = {
    'account.role': 'Changed account role', 'account.suspension': 'Changed account suspension',
    'account.booster-access': 'Changed booster access', 'service.availability': 'Changed service availability', 'pricing.update': 'Updated pricing',
    'sale.create': 'Created sale or coupon', 'sale.disable': 'Disabled sale or coupon', 'service.create': 'Created service',
    'order.status': 'Changed order status', 'order.assign': 'Assigned booster', 'order.unassign': 'Unassigned booster',
    'order.login-info': 'Updated order login details', 'order.complete': 'Completed assigned order', 'order.leave': 'Left assigned order',
    'assignment.invite': 'Invited booster to order', 'assignment.cancel': 'Cancelled booster invitation',
    'assignment.accept': 'Accepted booster invitation', 'assignment.decline': 'Declined booster invitation',
    'booster.start-date': 'Changed booster start date', 'contract.create': 'Issued booster contract', 'contract.retry': 'Retried contract delivery',
    'contract.sync': 'Synced contract status', 'contract.signing-view': 'Opened contract signing', 'contract.download': 'Downloaded contract',
    'contract.prepare': 'Prepared agreement for signing', 'contract.sign': 'Signed agreement', 'contract.native-replacement': 'Replaced unsigned sandbox agreement',
    'contribution.submit': 'Submitted match count', 'contribution.review': 'Reviewed match count', 'matches.manual-count': 'Approved manual match count',
    'matches.import': 'Imported match history', 'match.review': 'Reviewed match', 'matches.confirm': 'Confirmed match earnings',
    'matches.reopen': 'Reopened match review', 'matches.submit': 'Submitted match selection', 'support.reply': 'Replied to support chat',
    'support.attachment-view': 'Viewed support attachment', 'order.message': 'Sent order message', 'order.attachment': 'Sent order attachment',
    'order.attachment-view': 'Viewed order attachment', 'earnings.export': 'Requested earnings export',
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
    priceRule: ['id', 'serviceId', 'game', 'pricingType', 'active', 'config'],
    sale: ['id', 'title', 'scope', 'serviceId', 'active', 'discountPercent', 'startsAt', 'endsAt', 'appliesTo', 'couponCode', 'couponServiceIds', 'recipientAccountId', 'recipientAccountIds', 'personalReason', 'footerDecoration', 'footerTimer'],
    service: ['id', 'title', 'description'],
    assignment: ['id', 'orderId', 'boosterId', 'status'],
    contract: ['id', 'boosterId', 'title', 'startsAt', 'status', 'signedAt', 'companySignedAt', 'boosterSignedAt', 'revokedAt', 'archivedAt', 'signingProvider', 'nativePreparedAt', 'nativeCompletedAt', 'nativeDocumentHash', 'replacesContractId'],
    match: ['id', 'orderId', 'externalId', 'status', 'boosterId', 'revision'],
    supportThread: ['id', 'customerId'], supportMessage: ['id', 'threadId', 'senderId'],
    conversation: ['id', 'orderId'], message: ['id', 'conversationId', 'senderId'],
};
const models = { user: 'user', order: 'order', priceRule: 'servicePriceRule', sale: 'serviceSale', service: 'service',
    assignment: 'assignmentRequest', contract: 'boosterContract', match: 'orderMatch', supportThread: 'supportThread', supportMessage: 'supportMessage', conversation: 'conversation', message: 'message' };
async function snapshot(db, route, id) {
    if (!id || route.targetType === 'report') return null;
    if (route.targetType === 'booster') {
        const [user, profile] = await Promise.all([db.user.findUnique({ where: { id }, select: { id: true, username: true } }), db.boosterProfile.findUnique({ where: { userId: id }, select: { startedAt: true } })]);
        return user ? { ...user, startedAt: profile?.startedAt?.toISOString() || null } : null;
    }
    const fields = selectors[route.targetType];
    const select = Object.fromEntries(fields.map(field => [field, true]));
    if (route.targetType === 'order') {
        select.assignments = { select: { boosterId: true, booster: { select: { username: true } } } };
        if (route.category === 'earnings') {
            select.contributions = { select: { boosterId: true, submittedMatches: true, approvedMatches: true, revision: true } };
        }
    }
    const result = await db[models[route.targetType]].findUnique({ where: { id }, select });
    if (result?.discountPercent != null) result.discountPercent = String(result.discountPercent);
    return result ? safe(result) : null;
}
function requestDetails(route, req) {
    const details = { ...pick(req.body, route.fields), ...pick(route.params, ['boosterId', 'matchId']) };
    if (route.targetType === 'match') details.orderId = route.params.id;
    if (route.action === 'order.login-info') details.loginDetailsChanged = true;
    return details;
}
function responseDetails(route, body) {
    const result = pick(body, ['imported', 'submitted', 'addedCount', 'removedCount', 'pending']);
    if (['support.reply', 'order.message', 'order.attachment'].includes(route.action)) {
        const message = body?.message;
        if (message && typeof message === 'object') Object.assign(result, pick(message, ['id', 'createdAt']), { hasAttachment: Boolean(message.attachmentKey || message.attachmentName) });
    }
    return result;
}
function resultId(route, body) {
    if (route.action === 'sale.create') return body?.sale?.id;
    if (route.action === 'service.create') return body?.service?.id;
    if (route.action === 'contract.create') return body?.id;
    return undefined;
}
module.exports = { categories, actions, definitions, routeFor, safe, snapshot, requestDetails, responseDetails, resultId };
