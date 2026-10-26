CREATE TABLE "OrderHighlight" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "uploadedById" TEXT,
    "uploaderName" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "s3Key" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderHighlight_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OrderHighlight_s3Key_key" ON "OrderHighlight"("s3Key");
CREATE INDEX "OrderHighlight_orderId_createdAt_id_idx" ON "OrderHighlight"("orderId", "createdAt", "id");
CREATE INDEX "OrderHighlight_uploadedById_idx" ON "OrderHighlight"("uploadedById");
ALTER TABLE "OrderHighlight" ADD CONSTRAINT "OrderHighlight_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderHighlight" ADD CONSTRAINT "OrderHighlight_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
