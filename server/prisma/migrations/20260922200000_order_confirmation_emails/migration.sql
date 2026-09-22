CREATE TABLE "OrderConfirmationEmail" (
    "orderId" TEXT NOT NULL PRIMARY KEY REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "payload" JSONB NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "claim" TEXT,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "OrderConfirmationEmail_sentAt_nextAttemptAt_idx" ON "OrderConfirmationEmail"("sentAt", "nextAttemptAt");
