-- Opening baseline and subsequent recognition adjustments are retained
-- independently of operational account/order deletion. No historical data is
-- backfilled here; explicit activation captures the opening balance atomically.
CREATE TABLE "BoosterEarningsLedgerState" (
  "id" TEXT NOT NULL PRIMARY KEY CHECK ("id" = 'global'),
  "activatedAt" TIMESTAMP(3) NOT NULL
);

CREATE TABLE "BoosterEarningsBalance" (
  "orderId" TEXT NOT NULL,
  "boosterId" TEXT NOT NULL,
  "currency" TEXT NOT NULL,
  "amountCents" INTEGER NOT NULL CHECK ("amountCents" >= 0),
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BoosterEarningsBalance_pkey" PRIMARY KEY ("orderId", "boosterId", "currency")
);
CREATE INDEX "BoosterEarningsBalance_boosterId_currency_idx" ON "BoosterEarningsBalance"("boosterId", "currency");

CREATE TABLE "BoosterEarningsEntry" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "boosterId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "orderNumber" TEXT NOT NULL,
  "serviceTitle" TEXT NOT NULL,
  "currency" TEXT NOT NULL,
  "amountCents" INTEGER NOT NULL CHECK ("amountCents" <> 0),
  "recognizedAt" TIMESTAMP(3) NOT NULL,
  "period" TEXT,
  "kind" TEXT NOT NULL CHECK ("kind" IN ('OPENING', 'EARNED', 'ADJUSTMENT')),
  CONSTRAINT "BoosterEarningsEntry_period_check" CHECK (
    ("kind" = 'OPENING' AND "period" IS NULL) OR
    ("kind" <> 'OPENING' AND "period" IS NOT NULL AND "period" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
  )
);
CREATE INDEX "BoosterEarningsEntry_boosterId_period_recognizedAt_id_idx" ON "BoosterEarningsEntry"("boosterId", "period", "recognizedAt", "id");
CREATE INDEX "BoosterEarningsEntry_orderId_recognizedAt_idx" ON "BoosterEarningsEntry"("orderId", "recognizedAt");
