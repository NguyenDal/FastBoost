CREATE TABLE "OrderRating" (
    "orderId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "stars" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OrderRating_pkey" PRIMARY KEY ("orderId"),
    CONSTRAINT "OrderRating_stars_check" CHECK ("stars" BETWEEN 1 AND 5)
);

CREATE TABLE "OrderRatingRecipient" (
    "orderId" TEXT NOT NULL,
    "boosterId" TEXT NOT NULL,
    CONSTRAINT "OrderRatingRecipient_pkey" PRIMARY KEY ("orderId", "boosterId")
);

CREATE INDEX "OrderRating_customerId_idx" ON "OrderRating"("customerId");
CREATE INDEX "OrderRatingRecipient_boosterId_orderId_idx" ON "OrderRatingRecipient"("boosterId", "orderId");

ALTER TABLE "OrderRating" ADD CONSTRAINT "OrderRating_orderId_fkey"
    FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrderRating" ADD CONSTRAINT "OrderRating_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrderRatingRecipient" ADD CONSTRAINT "OrderRatingRecipient_orderId_fkey"
    FOREIGN KEY ("orderId") REFERENCES "OrderRating"("orderId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrderRatingRecipient" ADD CONSTRAINT "OrderRatingRecipient_boosterId_fkey"
    FOREIGN KEY ("boosterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
