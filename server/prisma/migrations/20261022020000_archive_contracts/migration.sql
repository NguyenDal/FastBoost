-- Archiving hides previous agreements without removing signing evidence or tenure.
-- No records are archived by this schema migration.
ALTER TABLE "BoosterContract" ADD COLUMN "archivedAt" TIMESTAMP(3);
CREATE INDEX "BoosterContract_boosterId_archivedAt_createdAt_idx"
  ON "BoosterContract"("boosterId", "archivedAt", "createdAt");
