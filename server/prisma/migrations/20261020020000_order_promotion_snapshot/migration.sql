ALTER TABLE "Order" ADD COLUMN "promotionTitle" TEXT,
  ADD COLUMN "promotionPercent" DECIMAL(5, 2),
  ADD COLUMN "promotionAppliesTo" TEXT;
ALTER TABLE "Order" ADD CONSTRAINT "Order_promotion_percent_check"
  CHECK ("promotionPercent" IS NULL OR ("promotionPercent" >= 0 AND "promotionPercent" <= 100));
