ALTER TABLE "OrderHighlight" ADD COLUMN "thumbnailKey" TEXT;
CREATE UNIQUE INDEX "OrderHighlight_thumbnailKey_key" ON "OrderHighlight"("thumbnailKey");
