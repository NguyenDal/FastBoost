async function auditActors(db) {
    // Prisma's distinct post-processing can transfer the whole audit history.
    // Return only the most recently recorded name for each actor from Postgres.
    return db.$queryRaw`
        SELECT "actorId", "actorName" FROM (
            SELECT DISTINCT ON ("actorId") "actorId", "actorName", "createdAt", id
            FROM "ManagementAuditLog"
            WHERE "actorId" IS NOT NULL AND action <> 'logging.enabled'
            ORDER BY "actorId", "createdAt" DESC, id DESC
        ) actors ORDER BY "createdAt" DESC, id DESC
    `;
}

module.exports = { auditActors };
