CREATE TABLE "ManagementAuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "actorName" TEXT NOT NULL,
    "actorRole" TEXT NOT NULL,
    "actorIsOwner" BOOLEAN NOT NULL DEFAULT false,
    "category" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT,
    "targetLabel" TEXT,
    "requested" JSONB,
    "before" JSONB,
    "after" JSONB,
    "outcome" TEXT NOT NULL DEFAULT 'STARTED',
    "statusCode" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    CONSTRAINT "ManagementAuditLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ManagementAuditLog_createdAt_id_idx" ON "ManagementAuditLog"("createdAt", "id");
CREATE INDEX "ManagementAuditLog_actorId_createdAt_idx" ON "ManagementAuditLog"("actorId", "createdAt");
CREATE INDEX "ManagementAuditLog_category_createdAt_idx" ON "ManagementAuditLog"("category", "createdAt");
CREATE INDEX "ManagementAuditLog_outcome_createdAt_idx" ON "ManagementAuditLog"("outcome", "createdAt");
INSERT INTO "ManagementAuditLog" ("id", "actorName", "actorRole", "category", "action", "targetType", "outcome", "finishedAt")
VALUES ('management-audit-enabled', 'System', 'SYSTEM', 'system', 'logging.enabled', 'audit', 'SUCCEEDED', CURRENT_TIMESTAMP);
