-- Existing envelopes keep their original signing provider and recipient snapshots.
ALTER TABLE "BoosterContract"
  ADD COLUMN "signingProvider" TEXT NOT NULL DEFAULT 'DOCUSIGN',
  ADD COLUMN "nativeCompanySignerId" TEXT,
  ADD COLUMN "nativeSnapshot" JSONB,
  ADD COLUMN "nativeDocumentHash" TEXT,
  ADD COLUMN "nativePreparedAt" TIMESTAMP(3),
  ADD COLUMN "nativePdf" BYTEA,
  ADD COLUMN "nativePdfHash" TEXT,
  ADD COLUMN "nativeCompletedAt" TIMESTAMP(3),
  ADD COLUMN "replacesContractId" TEXT,
  ADD CONSTRAINT "BoosterContract_signingProvider_check" CHECK ("signingProvider" IN ('DOCUSIGN', 'FASTBOOST')),
  ADD CONSTRAINT "BoosterContract_native_identity_check" CHECK (
    "signingProvider" <> 'FASTBOOST' OR ("nativeCompanySignerId" IS NOT NULL AND "nativeSnapshot" IS NOT NULL AND jsonb_typeof("nativeSnapshot") = 'object')
  ),
  ADD CONSTRAINT "BoosterContract_native_hash_check" CHECK (
    ("nativeDocumentHash" IS NULL OR "nativeDocumentHash" ~ '^[a-f0-9]{64}$') AND
    ("nativePdfHash" IS NULL OR "nativePdfHash" ~ '^[a-f0-9]{64}$')
  ),
  ADD CONSTRAINT "BoosterContract_native_prepared_check" CHECK (
    "nativePreparedAt" IS NULL OR ("nativeSnapshot" IS NOT NULL AND "nativeDocumentHash" IS NOT NULL AND "nativePdf" IS NOT NULL AND octet_length("nativePdf") > 5 AND "nativePdfHash" IS NOT NULL)
  ),
  ADD CONSTRAINT "BoosterContract_native_completion_check" CHECK (
    ("signingProvider" <> 'FASTBOOST' AND "nativeCompletedAt" IS NULL) OR
    ("signingProvider" = 'FASTBOOST' AND ("companySignedAt" IS NULL OR "nativePreparedAt" IS NOT NULL) AND (
      ("signedAt" IS NULL AND "nativeCompletedAt" IS NULL AND "boosterSignedAt" IS NULL) OR
      ("signedAt" IS NOT NULL AND "nativeCompletedAt" IS NOT NULL AND "nativeCompletedAt" = "signedAt" AND
        "companySignedAt" IS NOT NULL AND "boosterSignedAt" IS NOT NULL AND
        "nativePreparedAt" IS NOT NULL AND "nativePdf" IS NOT NULL AND "nativePdfHash" IS NOT NULL)
    ))
  );

CREATE UNIQUE INDEX "BoosterContract_replacesContractId_key" ON "BoosterContract"("replacesContractId");

CREATE TABLE "NativeContractSignature" (
  "id" TEXT NOT NULL,
  "contractId" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "actorEmail" TEXT NOT NULL,
  "legalName" TEXT NOT NULL,
  "initials" TEXT NOT NULL,
  "consentText" TEXT NOT NULL,
  "signature" JSONB NOT NULL,
  "documentHash" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "signedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "clientIp" TEXT,
  "userAgent" TEXT,
  CONSTRAINT "NativeContractSignature_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "NativeContractSignature_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "BoosterContract"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "NativeContractSignature_role_check" CHECK ("role" IN ('COMPANY', 'BOOSTER')),
  CONSTRAINT "NativeContractSignature_hash_check" CHECK ("documentHash" ~ '^[a-f0-9]{64}$' AND "requestHash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "NativeContractSignature_name_check" CHECK (char_length(btrim("legalName")) BETWEEN 2 AND 100 AND char_length(btrim("initials")) BETWEEN 1 AND 16),
  CONSTRAINT "NativeContractSignature_consent_check" CHECK (char_length("actorId") > 0 AND char_length("actorEmail") > 0 AND char_length("consentText") > 0),
  CONSTRAINT "NativeContractSignature_payload_check" CHECK (jsonb_typeof("signature") = 'object'),
  CONSTRAINT "NativeContractSignature_audit_length_check" CHECK (("clientIp" IS NULL OR char_length("clientIp") <= 128) AND ("userAgent" IS NULL OR char_length("userAgent") <= 500))
);
CREATE UNIQUE INDEX "NativeContractSignature_contractId_role_key" ON "NativeContractSignature"("contractId", "role");
CREATE UNIQUE INDEX "NativeContractSignature_contractId_requestId_key" ON "NativeContractSignature"("contractId", "requestId");
