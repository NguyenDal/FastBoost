ALTER TABLE "ServiceSale" ADD COLUMN "recipientAccountIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
