ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'BOOSTER_PAYOUT_INFORMATION';

CREATE TABLE "PayoutInformation" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "boosterId" TEXT NOT NULL,
  "issuedById" TEXT NOT NULL,
  "reviewedById" TEXT,
  "status" TEXT NOT NULL DEFAULT 'REQUESTED',
  "revision" INTEGER NOT NULL DEFAULT 0,
  "country" TEXT NOT NULL,
  "currency" TEXT,
  "accountLast4" TEXT,
  "encryptedDetails" JSONB,
  "detailsRevision" INTEGER,
  "correctionReason" TEXT,
  "submittedAt" TIMESTAMP(3),
  "confirmedAt" TIMESTAMP(3),
  "reviewedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PayoutInformation_boosterId_fkey" FOREIGN KEY ("boosterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PayoutInformation_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PayoutInformation_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "PayoutInformation_status_check" CHECK ("status" IN ('REQUESTED', 'SUBMITTED', 'VERIFIED', 'CHANGES_REQUESTED')),
  CONSTRAINT "PayoutInformation_revision_check" CHECK ("revision" >= 0),
  CONSTRAINT "PayoutInformation_country_currency_check" CHECK (
    ("country" IN ('US', 'VN') AND "currency" IS NULL) OR
    ("country" = 'US' AND "currency" = 'USD') OR
    ("country" = 'VN' AND "currency" IN ('USD', 'VND'))
  ),
  CONSTRAINT "PayoutInformation_last4_check" CHECK ("accountLast4" IS NULL OR "accountLast4" ~ '^[0-9]{4}$'),
  CONSTRAINT "PayoutInformation_reason_check" CHECK ("correctionReason" IS NULL OR "correctionReason" IN ('ACCOUNT_DETAILS', 'NAME_MISMATCH', 'OTHER')),
  CONSTRAINT "PayoutInformation_details_check" CHECK (
    ("status" = 'REQUESTED' AND "encryptedDetails" IS NULL AND "detailsRevision" IS NULL AND "submittedAt" IS NULL AND "confirmedAt" IS NULL AND "currency" IS NULL AND "accountLast4" IS NULL)
    OR ("status" <> 'REQUESTED' AND "revision" > 0 AND "encryptedDetails" IS NOT NULL AND jsonb_typeof("encryptedDetails") = 'object'
      AND "detailsRevision" IS NOT NULL AND "detailsRevision" > 0 AND "detailsRevision" <= "revision" AND "currency" IS NOT NULL
      AND "submittedAt" IS NOT NULL AND "confirmedAt" IS NOT NULL AND "accountLast4" IS NOT NULL)
  ),
  CONSTRAINT "PayoutInformation_review_check" CHECK (
    ("status" IN ('REQUESTED', 'SUBMITTED') AND "reviewedAt" IS NULL AND "reviewedById" IS NULL AND "correctionReason" IS NULL)
    OR ("status" = 'VERIFIED' AND "reviewedAt" IS NOT NULL AND "reviewedById" IS NOT NULL AND "reviewedById" <> "boosterId" AND "correctionReason" IS NULL)
    OR ("status" = 'CHANGES_REQUESTED' AND "reviewedAt" IS NOT NULL AND "reviewedById" IS NOT NULL AND "reviewedById" <> "boosterId" AND "correctionReason" IS NOT NULL)
  )
);
CREATE UNIQUE INDEX "PayoutInformation_boosterId_key" ON "PayoutInformation"("boosterId");
CREATE INDEX "PayoutInformation_status_updatedAt_idx" ON "PayoutInformation"("status", "updatedAt");
