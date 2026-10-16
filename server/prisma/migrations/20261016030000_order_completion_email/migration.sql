CREATE TABLE "OrderCompletionEmail" (
  "orderId" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sentAt" TIMESTAMP(3),
  "claim" TEXT,
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrderCompletionEmail_pkey" PRIMARY KEY ("orderId"),
  CONSTRAINT "OrderCompletionEmail_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "OrderCompletionEmail_sentAt_nextAttemptAt_idx" ON "OrderCompletionEmail"("sentAt", "nextAttemptAt");
