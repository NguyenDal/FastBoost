BEGIN;
ALTER TABLE "ServiceSale" ADD COLUMN "recipientAccountId" TEXT,
ADD COLUMN "personalReason" TEXT;
ALTER TABLE "ServiceSale" ADD CONSTRAINT "ServiceSale_recipientAccountId_fkey"
FOREIGN KEY ("recipientAccountId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "ServiceSale_recipientAccountId_idx" ON "ServiceSale"("recipientAccountId");
ALTER TABLE "ServiceSale" ADD CONSTRAINT "ServiceSale_personal_coupon_check"
CHECK ("recipientAccountId" IS NULL OR "couponCode" IS NOT NULL);
COMMIT;
