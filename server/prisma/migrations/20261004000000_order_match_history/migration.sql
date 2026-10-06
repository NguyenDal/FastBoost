ALTER TABLE "Order"
ADD COLUMN "matchHistoryEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "matchHistoryRevision" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "matchHistoryConfirmedAt" TIMESTAMP(3),
ADD COLUMN "matchHistoryConfirmedBy" TEXT,
ADD COLUMN "matchHistorySyncedAt" TIMESTAMP(3);

-- Keep historical allocations; only open/new orders move to match-based review.
UPDATE "Order" SET "matchHistoryEnabled" = false WHERE "status" IN ('COMPLETED', 'CANCELLED') OR "boostType" LIKE 'TFT %';

CREATE TABLE "OrderMatch" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "orderId" TEXT NOT NULL REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "game" TEXT NOT NULL CHECK ("game" IN ('LOL', 'TFT')),
  "externalId" TEXT NOT NULL,
  "participantId" TEXT NOT NULL,
  "playedAt" TIMESTAMP(3) NOT NULL,
  "details" JSONB NOT NULL,
  "boosterId" TEXT REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "status" TEXT NOT NULL DEFAULT 'PENDING' CHECK ("status" IN ('PENDING', 'APPROVED', 'REJECTED')),
  "revision" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "approved_match_has_booster" CHECK ("status" <> 'APPROVED' OR "boosterId" IS NOT NULL)
);
CREATE UNIQUE INDEX "OrderMatch_orderId_game_externalId_participantId_key" ON "OrderMatch"("orderId", "game", "externalId", "participantId");
-- The same account's match may be considered for multiple orders, but paid only once.
CREATE UNIQUE INDEX "OrderMatch_approved_participation_key" ON "OrderMatch"("game", "externalId", "participantId") WHERE "status" = 'APPROVED';
CREATE INDEX "OrderMatch_orderId_playedAt_idx" ON "OrderMatch"("orderId", "playedAt");
CREATE INDEX "OrderMatch_boosterId_idx" ON "OrderMatch"("boosterId");
CREATE TABLE "OrderMatchReview" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "matchId" TEXT NOT NULL REFERENCES "OrderMatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "reviewerId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "revision" INTEGER NOT NULL,
  "decision" TEXT NOT NULL,
  "boosterId" TEXT,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "OrderMatchReview_matchId_createdAt_idx" ON "OrderMatchReview"("matchId", "createdAt");
