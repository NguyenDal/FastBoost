const { matchScope } = require('./orderMatchScope');
const { Prisma } = require('../generated/prisma/client');

const ratingSelect = { stars: true, createdAt: true };
const orderSelect = {
    id: true, customerId: true, status: true, paymentStatus: true,
    boostType: true, queueType: true, matchHistoryEnabled: true,
    rating: { select: ratingSelect },
    assignments: { select: { boosterId: true } },
    contributions: { where: { approvedMatches: { gt: 0 } }, select: { boosterId: true } },
};

async function ratingRecipientIds(db, order) {
    const recipients = new Set(order.assignments.map(row => row.boosterId));
    if (order.matchHistoryEnabled) {
        const scope = matchScope(order);
        if (scope) {
            // Group in the database: only recipient IDs cross the connection,
            // not every match or its private evidence/details.
            const matches = await db.orderMatch.groupBy({
                by: ['boosterId'],
                where: { orderId: order.id, boosterId: { not: null }, status: 'APPROVED',
                    game: scope.game, details: { path: ['queueId'], equals: scope.queueId } },
            });
            for (const match of matches) recipients.add(match.boosterId);
        }
    } else {
        for (const contribution of order.contributions) recipients.add(contribution.boosterId);
    }
    recipients.delete(order.customerId);
    recipients.delete(null);
    recipients.delete(undefined);
    return [...recipients].sort();
}

async function boosterRating(db, boosterId) {
    try {
        const stats = await db.orderRating.aggregate({
            where: { recipients: { some: { boosterId } } },
            _avg: { stars: true }, _count: { _all: true },
        });
        return { average: stats._avg.stars, count: stats._count._all, available: true };
    } catch (error) {
        // A staged rollout must not hide the existing portal while its additive
        // migration is pending. Other database failures remain visible errors.
        if (!missingRatingTable(error)) throw error;
        return { average: null, count: 0, available: false };
    }
}

async function boosterRatings(db, boosterIds) {
    const ratings = new Map(boosterIds.map(id => [id, { average: null, count: 0, available: true }]));
    if (!ratings.size) return ratings;
    try {
        // Eligibility is checked when a review is created. Use the same immutable
        // recipient snapshots as boosterRating, not current assignments/status.
        // Aggregate in one query so neither per-booster queries nor individual
        // reviews and customer identities cross the database connection.
        const rows = await db.$queryRaw(Prisma.sql`
            SELECT recipient."boosterId", AVG(rating.stars)::double precision AS average,
                COUNT(*)::integer AS count
            FROM "OrderRatingRecipient" AS recipient
            JOIN "OrderRating" AS rating ON rating."orderId" = recipient."orderId"
            WHERE recipient."boosterId" IN (${Prisma.join([...ratings.keys()])})
            GROUP BY recipient."boosterId"
        `);
        for (const row of rows) ratings.set(row.boosterId, { average: Number(row.average), count: Number(row.count), available: true });
        return ratings;
    } catch (error) {
        if (!missingRatingTable(error)) throw error;
        for (const id of ratings.keys()) ratings.set(id, { average: null, count: 0, available: false });
        return ratings;
    }
}

function missingRatingTable(error) {
    const cause = error?.meta?.driverAdapterError?.cause || error?.cause;
    if (![error?.code, error?.meta?.code, cause?.originalCode, cause?.code].some(code => code === 'P2021' || code === '42P01')) return false;
    const tables = [error?.meta?.table, error?.table, cause?.table];
    // Match the exact table name, including Prisma's schema-qualified form.
    if (tables.some(table => typeof table === 'string' && /^(?:[\w]+\.)?OrderRating(?:Recipient)?$/.test(table.replace(/["`]/g, '')))) return true;
    return [error?.message, error?.meta?.message, cause?.originalMessage].some(message => typeof message === 'string' &&
        /relation ["`](?:[\w]+\.)?OrderRating(?:Recipient)?["`] does not exist/i.test(message));
}

module.exports = { ratingSelect, orderSelect, ratingRecipientIds, boosterRating, boosterRatings, missingRatingTable };
