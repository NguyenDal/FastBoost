ALTER TABLE "Order" ADD COLUMN "cashbackPercent" INTEGER;
ALTER TABLE "Order" ADD CONSTRAINT "Order_cashback_percent_check"
  CHECK ("cashbackPercent" IS NULL OR "cashbackPercent" IN (0, 3, 5, 10, 15));

CREATE TABLE "WalletCashbackEntitlement" (
  "orderId" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "entitledCents" INTEGER NOT NULL DEFAULT 0,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WalletCashbackEntitlement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "WalletAccount"("userId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "WalletCashbackEntitlement_amount_check" CHECK ("entitledCents" >= 0 AND "revision" >= 0)
);
CREATE INDEX "WalletCashbackEntitlement_userId_idx" ON "WalletCashbackEntitlement"("userId");

ALTER TABLE "WalletEntry" DROP CONSTRAINT "WalletEntry_type_check";
ALTER TABLE "WalletEntry" ADD CONSTRAINT "WalletEntry_type_check" CHECK (
  ("type" = 'TOP_UP' AND "topUpId" IS NOT NULL AND "orderId" IS NULL AND "purchasedCents" > 0 AND "promotionalCents" >= 0) OR
  ("type" = 'ORDER_PAYMENT' AND "orderId" IS NOT NULL AND "topUpId" IS NULL AND "purchasedCents" <= 0 AND "promotionalCents" <= 0 AND "amountCents" < 0) OR
  ("type" = 'TOP_UP_REVERSAL' AND "topUpId" IS NOT NULL AND "orderId" IS NULL AND "purchasedCents" < 0 AND "promotionalCents" <= 0) OR
  ("type" = 'CASHBACK' AND "orderId" IS NOT NULL AND "topUpId" IS NULL AND "purchasedCents" = 0 AND "promotionalCents" > 0) OR
  ("type" = 'CASHBACK_REVERSAL' AND "orderId" IS NOT NULL AND "topUpId" IS NULL AND "purchasedCents" = 0 AND "promotionalCents" < 0)
);
