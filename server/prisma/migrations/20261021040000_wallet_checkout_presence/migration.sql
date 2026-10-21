-- Presence is per browser view, including closed tombstones. Financial holds
-- remain separate and are released only after the server safely closes payment.
CREATE TABLE "WalletCheckoutPresence" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "closedAt" TIMESTAMP(3),
  "paymentProtectedUntil" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WalletCheckoutPresence_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "WalletCheckoutPresence_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "WalletCheckoutPresence_orderId_expiresAt_idx" ON "WalletCheckoutPresence"("orderId", "expiresAt");
CREATE INDEX "WalletCheckoutPresence_expiresAt_idx" ON "WalletCheckoutPresence"("expiresAt");
