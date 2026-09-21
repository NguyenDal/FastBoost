-- CreateIndex
CREATE INDEX "Service_title_idx" ON "Service"("title");

-- CreateIndex
CREATE INDEX "ServicePriceRule_serviceId_active_updatedAt_idx" ON "ServicePriceRule"("serviceId", "active", "updatedAt");

-- CreateIndex
CREATE INDEX "ServicePriceRule_game_pricingType_active_updatedAt_idx" ON "ServicePriceRule"("game", "pricingType", "active", "updatedAt");

-- CreateIndex
CREATE INDEX "ServiceSale_scope_serviceId_active_createdAt_idx" ON "ServiceSale"("scope", "serviceId", "active", "createdAt");