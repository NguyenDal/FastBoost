const { Prisma } = require('../generated/prisma/client');
const { visibleActions } = require('./managementAudit');

async function auditActors(db) {
    // Prisma's distinct post-processing can transfer the whole audit history.
    // Return only actors in the same critical-change scope as the owner list.
    return db.$queryRaw`
        SELECT actors."actorId",
            CASE WHEN NULLIF(BTRIM(actors."actorName"), '') IS NULL OR actors."actorName" = 'Admin'
                THEN COALESCE(users.username, 'Unknown user') ELSE actors."actorName" END AS "actorName"
        FROM (
            SELECT DISTINCT ON ("actorId") "actorId", "actorName", "createdAt", id
            FROM "ManagementAuditLog"
            WHERE "actorId" IS NOT NULL AND action IN (${Prisma.join(visibleActions)}) AND outcome = 'SUCCEEDED'
            ORDER BY "actorId", "createdAt" DESC, id DESC
        ) actors LEFT JOIN "User" users ON users.id = actors."actorId"
        ORDER BY actors."createdAt" DESC, actors.id DESC
    `;
}

module.exports = { auditActors };
