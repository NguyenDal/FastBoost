function rewardPagination(query) {
    const page = Number(query.rewardPage || 1);
    const requestedLimit = Number(query.rewardLimit || 5);
    if (!Number.isSafeInteger(page) || page < 1 || page > 1000000 ||
        !Number.isSafeInteger(requestedLimit) || requestedLimit < 1 ||
        (query.rewardPage != null && typeof query.rewardPage !== 'string') ||
        (query.rewardLimit != null && typeof query.rewardLimit !== 'string')) {
        throw Object.assign(new Error('Choose a valid reward page and limit.'), { status: 400 });
    }
    const limit = Math.min(10, requestedLimit);
    return { page, limit, offset: (page - 1) * limit };
}

async function rewardPage(db, userId, offset, limit) {
    // Page the combined feed in Postgres. Only `limit` rows cross the connection,
    // even for deep pages. Preserve order rewards first on timestamp ties, with
    // an explicit ID tie-breaker to keep adjacent pages deterministic.
    const sourceLimit = offset + limit;
    return db.$queryRaw`
        WITH reward_page AS (
            (SELECT o.id, 'COMPLETED_ORDER' AS type, o."boostType" AS title, o."serviceId",
                '#' || o."orderNumber" || ' • Completed match reward' AS description,
                FLOOR(o."totalPrice") AS "goldEarned", o."updatedAt" AS "createdAt", 0 AS source
            FROM "Order" o
            WHERE o."customerId" = ${userId} AND o.status = 'COMPLETED' AND o."paymentStatus" = 'PAID'
            ORDER BY o."updatedAt" DESC, o.id DESC LIMIT ${sourceLimit})
            UNION ALL
            (SELECT r.id, r.type::text, r.title, NULL::text,
                COALESCE(NULLIF(r.description, ''), 'Reward added to your account.'),
                r."goldAmount"::double precision, r."createdAt", 1
            FROM "RewardHistory" r WHERE r."userId" = ${userId}
            ORDER BY r."createdAt" DESC, r.id DESC LIMIT ${sourceLimit})
            ORDER BY "createdAt" DESC, source ASC, id DESC
            LIMIT ${limit} OFFSET ${offset}
        )
        SELECT (CASE p.source WHEN 0 THEN 'order-' ELSE 'reward-' END) || p.id AS id,
            p.type, CASE p.source WHEN 0
                THEN COALESCE(NULLIF(s.title, ''), NULLIF(p.title, ''), 'Completed Order')
                ELSE p.title END AS title,
            p.description, p."goldEarned", p."createdAt"
        FROM reward_page p LEFT JOIN "Service" s ON s.id = p."serviceId"
        ORDER BY p."createdAt" DESC, p.source ASC, p.id DESC
    `;
}

module.exports = { rewardPage, rewardPagination };
