ALTER TABLE "Order"
ADD COLUMN "couponSaleId" TEXT REFERENCES "ServiceSale"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
ADD COLUMN "couponCode" TEXT,
ADD COLUMN "couponTitle" TEXT,
ADD COLUMN "couponDiscountCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "couponOriginalAmountCents" INTEGER,
ADD COLUMN "couponOriginalReferralDiscount" DOUBLE PRECISION;

CREATE TABLE "CouponUse" (
  "id" TEXT PRIMARY KEY,
  "accountId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "saleId" TEXT NOT NULL REFERENCES "ServiceSale"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "orderId" TEXT NOT NULL REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "CouponUse_orderId_key" ON "CouponUse"("orderId");
CREATE UNIQUE INDEX "CouponUse_accountId_saleId_key" ON "CouponUse"("accountId", "saleId");

-- A checkout claim is not a use. Only verified PAID transitions consume it.
-- Centralizing release covers admin cancellation, session expiry and deletion.
CREATE FUNCTION fastboost_coupon_payment_state() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'CANCELLED' OR NEW."paymentStatus" = 'CANCELLED' THEN
    DELETE FROM "CouponUse" WHERE "orderId" = NEW.id;
  ELSIF NEW."paymentStatus" = 'PAID' AND NEW."couponSaleId" IS NOT NULL THEN
    UPDATE "CouponUse" SET "usedAt" = COALESCE("usedAt", CURRENT_TIMESTAMP)
      WHERE "orderId" = NEW.id AND "accountId" = NEW."customerId" AND "saleId" = NEW."couponSaleId";
    IF NOT FOUND THEN RAISE EXCEPTION 'Coupon checkout claim is missing'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER fastboost_coupon_payment_state
BEFORE UPDATE OF "paymentStatus", status ON "Order"
FOR EACH ROW EXECUTE FUNCTION fastboost_coupon_payment_state();
