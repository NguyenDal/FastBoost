-- Nullable fields preserve existing single-signer envelopes and their audit history.
ALTER TABLE "BoosterContract"
  ADD COLUMN "companySignerName" TEXT,
  ADD COLUMN "companySignerEmail" TEXT,
  ADD COLUMN "boosterSignedAt" TIMESTAMP(3),
  ADD COLUMN "companySignedAt" TIMESTAMP(3);
