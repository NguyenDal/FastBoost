// Activity logs retain stable IDs internally. This projection supplies names
// for the owner view without rewriting historical audit records.
const userReferences = {
    actorId: 'actorName',
    boosterId: 'boosterName',
    customerId: 'customerName',
    senderId: 'senderName',
    issuedById: 'issuerName',
    nativeCompanySignerId: 'companySignerName',
    recipientAccountId: 'recipientName',
    reviewedBy: 'reviewerName',
    matchHistoryConfirmedBy: 'confirmerName',
};
const userReferenceLists = { recipientAccountIds: 'recipientNames' };
const name = value => typeof value === 'string' && value.trim() ? value.trim() : null;
const isOpaqueId = value => typeof value === 'string' && /^(?:c[a-z0-9]{20,}|[0-9a-f]{8}-[0-9a-f-]{27,}|(?:user|booster|admin|owner)-[\w-]+)$/i.test(value);

function visit(value, onPair, onReference) {
    if (Array.isArray(value)) return value.forEach(item => visit(item, onPair, onReference));
    if (!value || typeof value !== 'object') return;
    if (typeof value.id === 'string' && name(value.username)) onPair(value.id, value.username);
    for (const [key, item] of Object.entries(value)) {
        if (userReferences[key] && typeof item === 'string') onReference(item);
        if (userReferenceLists[key] && Array.isArray(item)) item.forEach(id => { if (typeof id === 'string') onReference(id); });
        visit(item, onPair, onReference);
    }
}

function presentDetails(value, names) {
    if (Array.isArray(value)) return value.map(item => presentDetails(item, names));
    if (!value || typeof value !== 'object') return value;
    const shown = {};
    for (const [key, item] of Object.entries(value)) {
        if (userReferences[key]) {
            shown[userReferences[key]] = names.get(item) || 'Unknown user';
        } else if (userReferenceLists[key]) {
            shown[userReferenceLists[key]] = Array.isArray(item) ? item.map(id => names.get(id) || 'Unknown user') : [];
        } else if (key === 'id' || /Ids?$/.test(key)) {
            // Record, service, and user IDs are available for links internally,
            // but do not help the owner understand the change.
            continue;
        } else {
            shown[key] = presentDetails(item, names);
        }
    }
    return shown;
}

function label(item, names, services, orders) {
    const recorded = name(item.targetLabel);
    if (item.targetType === 'user' || item.targetType === 'booster') {
        return recorded && recorded !== item.targetId && !isOpaqueId(recorded)
            ? recorded : names.get(item.targetId) || 'Unknown user';
    }
    if (item.targetType === 'contract') {
        const title = recorded && recorded !== item.targetId && !isOpaqueId(recorded)
            ? recorded : item.after?.title || item.before?.title || 'Agreement';
        const booster = names.get(item.after?.boosterId || item.before?.boosterId);
        return booster && !title.includes(booster) ? `${title} · ${booster}` : title;
    }
    if (recorded && recorded !== item.targetId && !isOpaqueId(recorded)) return recorded;
    if (item.targetType === 'priceRule') {
        const id = item.after?.serviceId || item.before?.serviceId || item.requested?.serviceId;
        return services.get(id) || 'Pricing rule';
    }
    if (item.targetType === 'match') {
        const id = item.after?.orderId || item.before?.orderId || item.requested?.orderId;
        return orders.get(id) || 'Match review';
    }
    if (item.targetType === 'order') return item.after?.orderNumber || item.before?.orderNumber || 'Order';
    if (item.targetType === 'sale') return item.after?.title || item.before?.title || 'Sale or coupon';
    if (item.targetType === 'service') return item.after?.title || item.before?.title || 'Service';
    return 'Management change';
}

async function presentActivityLogItems(db, items) {
    if (!items.length) return [];
    const userIds = new Set();
    const serviceIds = new Set();
    const orderIds = new Set();
    for (const item of items) {
        if (item.actorId) userIds.add(item.actorId);
        if (item.targetId && ['user', 'booster'].includes(item.targetType)) userIds.add(item.targetId);
        for (const value of [item.before, item.requested, item.after]) {
            visit(value, () => {}, id => userIds.add(id));
        }
        if (item.targetType === 'priceRule') {
            const id = item.after?.serviceId || item.before?.serviceId || item.requested?.serviceId;
            if (id) serviceIds.add(id);
        }
        if (item.targetType === 'match') {
            const id = item.after?.orderId || item.before?.orderId || item.requested?.orderId;
            if (id) orderIds.add(id);
        }
    }
    const [users, services, orders] = await Promise.all([
        userIds.size && db.user?.findMany ? db.user.findMany({ where: { id: { in: [...userIds].slice(0, 500) } }, select: { id: true, username: true } }) : [],
        serviceIds.size && db.service?.findMany ? db.service.findMany({ where: { id: { in: [...serviceIds] } }, select: { id: true, title: true } }) : [],
        orderIds.size && db.order?.findMany ? db.order.findMany({ where: { id: { in: [...orderIds] } }, select: { id: true, orderNumber: true } }) : [],
    ]);
    const currentNames = new Map(users.map(user => [user.id, name(user.username) || 'Unknown user']));
    const serviceLabels = new Map(services.map(service => [service.id, name(service.title) || 'Service']));
    const orderLabels = new Map(orders.map(order => [order.id, name(order.orderNumber) || 'Order']));
    return items.map(item => {
        // Names captured with an event belong only to that event. A shared map
        // would let an older row overwrite a renamed user's newer display name.
        const names = new Map(currentNames);
        if (item.actorId && name(item.actorName) && item.actorName !== 'Admin' && !isOpaqueId(item.actorName)) {
            names.set(item.actorId, item.actorName);
        }
        if (item.targetId && ['user', 'booster'].includes(item.targetType) && name(item.targetLabel)
            && item.targetLabel !== item.targetId && !isOpaqueId(item.targetLabel)) {
            names.set(item.targetId, item.targetLabel);
        }
        for (const value of [item.before, item.requested, item.after]) {
            visit(value, (id, username) => names.set(id, username), () => {});
        }
        return {
            ...item,
            actorName: item.actorId ? names.get(item.actorId) || 'Unknown user' : name(item.actorName) || 'Unknown user',
            targetLabel: label(item, names, serviceLabels, orderLabels),
            before: presentDetails(item.before, names),
            requested: presentDetails(item.requested, names),
            after: presentDetails(item.after, names),
        };
    });
}

module.exports = { presentActivityLogItems, presentDetails };
