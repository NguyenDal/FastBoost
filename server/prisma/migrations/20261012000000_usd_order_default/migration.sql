-- New orders use USD. Existing records retain their original currency.
ALTER TABLE "Order" ALTER COLUMN "currency" SET DEFAULT 'usd';
