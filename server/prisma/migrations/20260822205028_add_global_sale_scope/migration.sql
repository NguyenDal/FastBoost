-- CreateEnum
CREATE TYPE "SaleScope" AS ENUM ('SERVICE', 'GLOBAL');

-- AlterTable
ALTER TABLE "ServiceSale" ADD COLUMN     "scope" "SaleScope" NOT NULL DEFAULT 'SERVICE',
ALTER COLUMN "serviceId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "ServiceSale_scope_idx" ON "ServiceSale"("scope");
