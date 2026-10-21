-- Keep legacy $5 +10% intents valid; new purchases use versioned $5 +8%.
ALTER TABLE "WalletTopUp"
DROP CONSTRAINT "WalletTopUp_package_check",
ADD CONSTRAINT "WalletTopUp_package_check" CHECK (
  ("packageId" = 'usd-5' AND "amountCents" = 500 AND "bonusPercent" = 10 AND "bonusCents" = 50) OR
  ("packageId" = 'usd-5-v2' AND "amountCents" = 500 AND "bonusPercent" = 8 AND "bonusCents" = 40) OR
  ("packageId" = 'usd-10' AND "amountCents" = 1000 AND "bonusPercent" = 10 AND "bonusCents" = 100) OR
  ("packageId" = 'usd-25' AND "amountCents" = 2500 AND "bonusPercent" = 12 AND "bonusCents" = 300) OR
  ("packageId" = 'usd-50' AND "amountCents" = 5000 AND "bonusPercent" = 13 AND "bonusCents" = 650) OR
  ("packageId" = 'usd-100' AND "amountCents" = 10000 AND "bonusPercent" = 15 AND "bonusCents" = 1500)
);
