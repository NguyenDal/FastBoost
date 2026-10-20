CREATE TABLE "WalletAccount" (
  "userId" TEXT NOT NULL PRIMARY KEY,
  "purchasedBalanceCents" INTEGER NOT NULL DEFAULT 0,
  "promotionalBalanceCents" INTEGER NOT NULL DEFAULT 0,
  "frozenAt" TIMESTAMP(3),
  "freezeReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WalletAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "WalletTopUp" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "packageId" TEXT NOT NULL,
  "amountCents" INTEGER NOT NULL,
  "bonusPercent" INTEGER NOT NULL,
  "bonusCents" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'usd',
  "status" TEXT NOT NULL DEFAULT 'CREATING',
  "clientUrl" TEXT NOT NULL,
  "stripeCheckoutSessionId" TEXT,
  "stripePaymentIntentId" TEXT,
  "paidAt" TIMESTAMP(3),
  "reversedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WalletTopUp_userId_fkey" FOREIGN KEY ("userId") REFERENCES "WalletAccount"("userId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "WalletTopUp_currency_check" CHECK ("currency" = 'usd'),
  CONSTRAINT "WalletTopUp_status_check" CHECK ("status" IN ('CREATING', 'PENDING', 'PAID', 'EXPIRED', 'REVERSED')),
  CONSTRAINT "WalletTopUp_package_check" CHECK (
    ("packageId" = 'usd-5' AND "amountCents" = 500 AND "bonusPercent" = 10 AND "bonusCents" = 50) OR
    ("packageId" = 'usd-10' AND "amountCents" = 1000 AND "bonusPercent" = 10 AND "bonusCents" = 100) OR
    ("packageId" = 'usd-25' AND "amountCents" = 2500 AND "bonusPercent" = 12 AND "bonusCents" = 300) OR
    ("packageId" = 'usd-50' AND "amountCents" = 5000 AND "bonusPercent" = 13 AND "bonusCents" = 650) OR
    ("packageId" = 'usd-100' AND "amountCents" = 10000 AND "bonusPercent" = 15 AND "bonusCents" = 1500)
  )
);
CREATE UNIQUE INDEX "WalletTopUp_stripeCheckoutSessionId_key" ON "WalletTopUp"("stripeCheckoutSessionId");
CREATE UNIQUE INDEX "WalletTopUp_stripePaymentIntentId_key" ON "WalletTopUp"("stripePaymentIntentId");
CREATE INDEX "WalletTopUp_userId_status_createdAt_idx" ON "WalletTopUp"("userId", "status", "createdAt");

CREATE TABLE "WalletEntry" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "topUpId" TEXT,
  "orderId" TEXT,
  "key" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "amountCents" INTEGER NOT NULL,
  "purchasedCents" INTEGER NOT NULL,
  "promotionalCents" INTEGER NOT NULL,
  "description" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WalletEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "WalletAccount"("userId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "WalletEntry_topUpId_fkey" FOREIGN KEY ("topUpId") REFERENCES "WalletTopUp"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "WalletEntry_amount_check" CHECK ("amountCents"::BIGINT = "purchasedCents"::BIGINT + "promotionalCents"::BIGINT),
  CONSTRAINT "WalletEntry_type_check" CHECK (
    ("type" = 'TOP_UP' AND "topUpId" IS NOT NULL AND "orderId" IS NULL AND "purchasedCents" > 0 AND "promotionalCents" >= 0) OR
    ("type" = 'ORDER_PAYMENT' AND "orderId" IS NOT NULL AND "topUpId" IS NULL AND "purchasedCents" <= 0 AND "promotionalCents" <= 0 AND "amountCents" < 0) OR
    ("type" = 'TOP_UP_REVERSAL' AND "topUpId" IS NOT NULL AND "orderId" IS NULL AND "purchasedCents" < 0 AND "promotionalCents" <= 0)
  )
);
CREATE UNIQUE INDEX "WalletEntry_key_key" ON "WalletEntry"("key");
CREATE INDEX "WalletEntry_userId_createdAt_id_idx" ON "WalletEntry"("userId", "createdAt", "id");

CREATE FUNCTION "wallet_entry_immutable"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Wallet entries are immutable; append a reversal instead';
END;
$$;
CREATE TRIGGER "WalletEntry_immutable" BEFORE UPDATE OR DELETE ON "WalletEntry"
  FOR EACH ROW EXECUTE FUNCTION "wallet_entry_immutable"();

ALTER TABLE "Order" ADD COLUMN "walletAmountCents" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "walletPurchasedCents" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "walletPromotionalCents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Order" ADD CONSTRAINT "Order_wallet_amount_check" CHECK (
  "walletAmountCents" >= 0 AND "walletPurchasedCents" >= 0 AND "walletPromotionalCents" >= 0 AND
  "walletAmountCents"::BIGINT = "walletPurchasedCents"::BIGINT + "walletPromotionalCents"::BIGINT
);
