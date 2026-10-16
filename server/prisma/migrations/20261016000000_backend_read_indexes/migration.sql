-- Ordered reward feeds and bounded completed-order earnings scans.
-- These are additive indexes; existing keys and stored data are unchanged.
CREATE INDEX "Order_customer_reward_page_idx"
ON "Order" ("customerId", "status", "paymentStatus", "updatedAt", "id");

CREATE INDEX "Order_completed_earnings_page_idx"
ON "Order" ("paymentStatus", "status", "id");

CREATE INDEX "RewardHistory_user_page_idx"
ON "RewardHistory" ("userId", "createdAt", "id");
