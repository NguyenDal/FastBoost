-- Transactional delivery outbox only; no backfill and no existing rows changed.
CREATE TABLE "BoosterOrderEmail" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "boosterId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claim" TEXT,
    "sentAt" TIMESTAMP(3),
    "skippedAt" TIMESTAMP(3),
    "lastError" TEXT,
    CONSTRAINT "BoosterOrderEmail_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "BoosterOrderEmail_event_check" CHECK ("event" IN ('ASSIGNED', 'UNASSIGNED', 'COMPLETED', 'CANCELLED', 'PAYMENT_CONFIRMED')),
    CONSTRAINT "BoosterOrderEmail_attempts_check" CHECK ("attempts" >= 0)
);

CREATE INDEX "BoosterOrderEmail_sentAt_skippedAt_nextAttemptAt_idx" ON "BoosterOrderEmail"("sentAt", "skippedAt", "nextAttemptAt");
CREATE INDEX "BoosterOrderEmail_orderId_boosterId_idx" ON "BoosterOrderEmail"("orderId", "boosterId");

ALTER TABLE "BoosterOrderEmail" ADD CONSTRAINT "BoosterOrderEmail_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BoosterOrderEmail" ADD CONSTRAINT "BoosterOrderEmail_boosterId_fkey" FOREIGN KEY ("boosterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
