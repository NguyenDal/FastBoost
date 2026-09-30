// Select one preview per sender before applying the dashboard's three-row limit.
// Prefer their oldest unread message; otherwise keep their latest read message.
async function dashboardMessages(db, userId) {
    return db.$queryRaw`
        WITH ranked AS (
            SELECT n.*, ROW_NUMBER() OVER (
                PARTITION BY COALESCE(n.data->>'senderId', n.title, n.id)
                ORDER BY n.read ASC,
                    CASE WHEN NOT n.read THEN n."createdAt" END ASC,
                    n."createdAt" DESC, n.id DESC
            ) AS position, MAX(n."createdAt") OVER (
                PARTITION BY COALESCE(n.data->>'senderId', n.title, n.id)
            ) AS latest
            FROM "Notification" n
            WHERE n."userId" = ${userId} AND n.active = true AND n.type = 'CHAT_MESSAGE'
        )
        SELECT id, "userId", type, title, message, data, read, active, "createdAt"
        FROM ranked WHERE position = 1 ORDER BY read ASC, latest DESC, id DESC LIMIT 3
    `;
}
module.exports = { dashboardMessages };
