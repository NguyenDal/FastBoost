const { Prisma } = require('../generated/prisma/client');

async function unreadSupportThreads(db, threads) {
    if (!threads.length) return new Set();
    // EXISTS stops at the first unread customer message. Use the page's read
    // watermark so a concurrent read cannot disagree with the returned thread.
    const page = Prisma.join(threads.map(thread => Prisma.sql`(
        ${thread.id}::text, ${thread.customerId}::text, ${thread.adminReadAt}::timestamp
    )`));
    const rows = await db.$queryRaw(Prisma.sql`
        SELECT t.id FROM (VALUES ${page}) AS t(id, customer_id, read_at)
        WHERE EXISTS (
            SELECT 1 FROM "SupportMessage" m
            WHERE m."threadId" = t.id AND m."senderId" = t.customer_id
                AND m."createdAt" > t.read_at
        )
    `);
    return new Set(rows.map(row => row.id));
}

module.exports = { unreadSupportThreads };
