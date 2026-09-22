ALTER TABLE "ServiceSale" ADD COLUMN "couponCode" TEXT,
ADD COLUMN "footerDecoration" BOOLEAN NOT NULL DEFAULT false;
CREATE UNIQUE INDEX "ServiceSale_couponCode_key" ON "ServiceSale"("couponCode");
