const { orderEarnings, estimateMatchEarnings } = require('./earnings');
const { matchesOrder } = require('./orderMatchScope');

const count = value => Number.isInteger(value) && value >= 0 ? value : 0;
const returned = contribution => Boolean(contribution.reviewedAt) && contribution.approvedMatches == null;

function reviewDetails(order, matches) {
    if (order.matchHistoryEnabled) {
        const approved = matches.filter(match => match.boosterId && match.status === 'APPROVED').length;
        const pending = matches.filter(match => match.boosterId && match.status === 'PENDING').length;
        return {
            reviewMode: 'matches',
            reviewStatus: pending ? 'NEEDS_REVIEW' : approved && order.matchHistoryConfirmedAt ? 'CONFIRMED' : approved ? 'READY_TO_CONFIRM' : 'AWAITING_SUBMISSION',
            matchCounts: { total: matches.length, submitted: approved + pending, approved, pending,
                rejected: matches.filter(match => match.status === 'REJECTED').length,
                unsubmitted: matches.filter(match => !match.boosterId && match.status === 'PENDING').length },
        };
    }
    const contributions = order.contributions || [];
    const records = new Map(contributions.map(contribution => [contribution.boosterId, contribution]));
    const missingSubmission = (order.assignments || []).some(assignment => !records.has(assignment.boosterId));
    const pending = contributions.filter(contribution => !returned(contribution) &&
        (!Number.isInteger(contribution.approvedMatches) || contribution.approvedMatches !== contribution.submittedMatches));
    const approved = contributions.reduce((sum, contribution) => sum + count(contribution.approvedMatches), 0);
    const hasReturned = contributions.some(returned);
    return {
        reviewMode: 'contributions',
        reviewStatus: pending.length ? 'NEEDS_REVIEW' : hasReturned ? 'RETURNED' :
            missingSubmission || !approved ? 'AWAITING_SUBMISSION' : 'CONFIRMED',
        // Count-only submissions do not tell us how many account matches were never submitted.
        matchCounts: { total: null, submitted: contributions.reduce((sum, contribution) => sum + count(contribution.submittedMatches), 0),
            approved, pending: pending.reduce((sum, contribution) => sum + count(contribution.submittedMatches), 0),
            rejected: contributions.filter(returned).reduce((sum, contribution) => sum + count(contribution.submittedMatches), 0), unsubmitted: null },
    };
}

function peopleFor(order, matches) {
    const people = new Map();
    const records = [...(order.assignments || []), ...(order.matchHistoryEnabled ? matches : order.contributions || [])];
    for (const record of records) {
        if (!record.boosterId) continue;
        const old = people.get(record.boosterId);
        people.set(record.boosterId, { id: record.boosterId,
            username: record.booster?.username || old?.username || null,
            displayName: record.booster?.profile?.displayName || old?.displayName || null });
    }
    return [...people.values()].sort((a, b) => (a.displayName || a.username || a.id).localeCompare(b.displayName || b.username || b.id));
}

function pendingEstimate(order) {
    if (order.matchHistoryEnabled) return estimateMatchEarnings(order)?.shares || [];
    // Preview only known, active claims. Returned submissions and empty assignments
    // never gain an equal-split fallback, nor does a preview approve any records.
    return orderEarnings({ ...order, assignments: [], contributions: (order.contributions || [])
        .filter(contribution => !returned(contribution))
        .map(contribution => ({ ...contribution, approvedMatches: contribution.submittedMatches })) })?.shares || [];
}

/** Completed, paid orders only. All monetary amounts are service revenue before tax. */
function buildEarningsReport(orders) {
    const totals = new Map();
    const boosters = {};
    let missingAmounts = 0;
    const rows = orders.map(order => {
        const matches = (order.matches || []).filter(match => matchesOrder(order, match));
        const amounts = orderEarnings(order);
        const review = reviewDetails(order, matches);
        const currency = String(order.currency || 'UNKNOWN').toUpperCase();
        const confirmedBoosterCents = amounts ? amounts.shares.reduce((sum, share) => sum + share.cents, 0) : null;
        const unallocatedCents = amounts ? amounts.boosterCents - confirmedBoosterCents : null;
        if (amounts) {
            const total = totals.get(currency) || { currency, revenueCents: 0, boosterCents: 0, platformCents: 0, unallocatedCents: 0, orders: 0 };
            for (const key of ['revenueCents', 'boosterCents', 'platformCents']) total[key] += amounts[key];
            total.unallocatedCents += unallocatedCents;
            total.orders++;
            totals.set(currency, total);
            for (const share of amounts.shares) {
                const amount = boosters[share.boosterId] ||= {};
                amount[currency] = (amount[currency] || 0) + share.cents;
            }
        } else missingAmounts++;
        return { ...order, assignments: undefined, matches: undefined, currency, paidAt: order.paidAt || null,
            ...(amounts || { revenueCents: null, boosterCents: null, platformCents: null, shares: [] }),
            amountKnown: Boolean(amounts), ...review, boosters: peopleFor(order, matches), confirmedBoosterCents, unallocatedCents,
            estimatedShares: amounts && review.reviewStatus !== 'CONFIRMED' ? pendingEstimate(order) : [] };
    });
    return { totals: [...totals.values()], boosters, rows, missingAmounts };
}

module.exports = { buildEarningsReport };
