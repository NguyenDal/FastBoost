-- Holds reserve existing USD credit without posting a debit before payment.
-- Only the server releases a hold after its Stripe session is no longer payable
-- or consumes it atomically with the paid order and immutable wallet entry.
CREATE TABLE "WalletCheckoutHold" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "amountCents" INTEGER NOT NULL,
  "purchasedCents" INTEGER NOT NULL,
  "promotionalCents" INTEGER NOT NULL,
  "cashAmountCents" INTEGER NOT NULL,
  "orderAmountCents" INTEGER NOT NULL,
  "goldRedeemed" INTEGER NOT NULL,
  "goldDiscountCents" INTEGER NOT NULL,
  "stripeParametersJson" JSONB NOT NULL,
  "stripeCheckoutSessionId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WalletCheckoutHold_userId_fkey" FOREIGN KEY ("userId") REFERENCES "WalletAccount"("userId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "WalletCheckoutHold_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "WalletCheckoutHold_amount_check" CHECK (
    "amountCents" > 0 AND "purchasedCents" >= 0 AND "promotionalCents" >= 0 AND
    "amountCents"::BIGINT = "purchasedCents"::BIGINT + "promotionalCents"::BIGINT
  ),
  CONSTRAINT "WalletCheckoutHold_quote_check" CHECK (
    "cashAmountCents" > 0 AND "orderAmountCents" > 0 AND
    "cashAmountCents"::BIGINT - "amountCents"::BIGINT >= 50 AND
    "goldDiscountCents" >= 0 AND ("goldRedeemed" = 0 OR "goldRedeemed" >= 100) AND
    "goldDiscountCents"::BIGINT = "goldRedeemed"::BIGINT * 10 AND
    "orderAmountCents"::BIGINT - "goldDiscountCents"::BIGINT = "cashAmountCents"::BIGINT
  ),
  CONSTRAINT "WalletCheckoutHold_parameters_check" CHECK (jsonb_typeof("stripeParametersJson") = 'object')
);
CREATE UNIQUE INDEX "WalletCheckoutHold_orderId_key" ON "WalletCheckoutHold"("orderId");
CREATE UNIQUE INDEX "WalletCheckoutHold_stripeCheckoutSessionId_key" ON "WalletCheckoutHold"("stripeCheckoutSessionId");
CREATE INDEX "WalletCheckoutHold_userId_createdAt_idx" ON "WalletCheckoutHold"("userId", "createdAt");
