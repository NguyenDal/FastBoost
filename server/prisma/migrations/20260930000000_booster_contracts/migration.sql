ALTER TYPE "NotificationType" ADD VALUE 'BOOSTER_CONTRACT';
CREATE TABLE "BoosterProfile" (
  "userId" TEXT PRIMARY KEY REFERENCES "User"("id") ON DELETE CASCADE,
  "startedAt" TIMESTAMP(3)
);
CREATE TABLE "BoosterContract" (
  "id" TEXT PRIMARY KEY,
  "boosterId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT,
  "issuedById" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT,
  "title" TEXT NOT NULL, "templateId" TEXT NOT NULL, "accountId" TEXT NOT NULL,
  "environment" TEXT NOT NULL, "envelopeId" TEXT UNIQUE,
  "signerName" TEXT NOT NULL, "signerEmail" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending', "sendAttemptAt" TIMESTAMP(3),
  "sendError" TEXT, "lastSyncedAt" TIMESTAMP(3), "startsAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "signedAt" TIMESTAMP(3), "signedName" TEXT, "viewedAt" TIMESTAMP(3), "revokedAt" TIMESTAMP(3)
);
CREATE INDEX "BoosterContract_boosterId_createdAt_idx" ON "BoosterContract"("boosterId", "createdAt");
CREATE TABLE "BoosterContribution" (
  "orderId" TEXT NOT NULL REFERENCES "Order"("id") ON DELETE RESTRICT,
  "boosterId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT,
  "submittedMatches" INTEGER NOT NULL CHECK ("submittedMatches" >= 0),
  "approvedMatches" INTEGER CHECK ("approvedMatches" >= 0),
  "revision" INTEGER NOT NULL DEFAULT 1,
  "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewedAt" TIMESTAMP(3), "reviewedBy" TEXT, "reviewNote" TEXT,
  PRIMARY KEY ("orderId", "boosterId")
);
CREATE INDEX "BoosterContribution_boosterId_idx" ON "BoosterContribution"("boosterId");
