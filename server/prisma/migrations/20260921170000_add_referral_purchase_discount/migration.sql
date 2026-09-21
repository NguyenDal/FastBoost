-- AlterTable
ALTER TABLE "Order" ADD COLUMN "referralDiscount" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "Order_customerId_paymentStatus_paidAt_idx" ON "Order"("customerId", "paymentStatus", "paidAt");