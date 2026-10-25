CREATE TABLE "NativeContractEmail" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "recipientRole" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "skippedAt" TIMESTAMP(3),
    "claim" TEXT,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NativeContractEmail_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "NativeContractEmail_sentAt_skippedAt_nextAttemptAt_idx" ON "NativeContractEmail"("sentAt", "skippedAt", "nextAttemptAt");
CREATE INDEX "NativeContractEmail_contractId_event_idx" ON "NativeContractEmail"("contractId", "event");
ALTER TABLE "NativeContractEmail" ADD CONSTRAINT "NativeContractEmail_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "BoosterContract"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
