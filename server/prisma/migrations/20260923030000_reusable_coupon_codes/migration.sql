-- Keep historical codes intact; only enabled campaigns reserve their code.
BEGIN;
DROP INDEX "ServiceSale_couponCode_key";
CREATE INDEX "ServiceSale_couponCode_idx" ON "ServiceSale"("couponCode");
CREATE UNIQUE INDEX "ServiceSale_active_couponCode_key"
ON "ServiceSale"("couponCode") WHERE "active" = true AND "couponCode" IS NOT NULL;
COMMIT;
