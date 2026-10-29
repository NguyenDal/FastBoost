-- New paid-order notifications only. No backfill and no customer/order changes.
CREATE TABLE "AdminOrderEmail" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "orderId" TEXT NOT NULL,
  "adminId" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "claim" TEXT,
  "sentAt" TIMESTAMP(3),
  "skippedAt" TIMESTAMP(3),
  "lastError" TEXT,
  CONSTRAINT "AdminOrderEmail_attempts_check" CHECK ("attempts" >= 0),
  CONSTRAINT "AdminOrderEmail_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AdminOrderEmail_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "AdminOrderEmail_orderId_adminId_key" ON "AdminOrderEmail"("orderId", "adminId");
CREATE INDEX "AdminOrderEmail_sentAt_skippedAt_nextAttemptAt_idx" ON "AdminOrderEmail"("sentAt", "skippedAt", "nextAttemptAt");
