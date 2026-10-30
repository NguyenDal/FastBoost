-- One-time cleanup requested by the owner for the five production test
-- agreements listed under the FastBoost booster account on 30 October 2026.
-- Archive only these captured IDs; future documents and other boosters remain
-- active. Keep original PDFs, snapshots, signatures and account history intact.
BEGIN;

DO $$
DECLARE
  test_ids CONSTANT TEXT[] := ARRAY[
    '55d7c09e-de14-45de-96e3-b207eff86510',
    'b02a2e30-d47d-40ed-8c35-026e1e578640',
    '8114cb5e-9188-48d3-868d-e765c911880f',
    'f96573c9-c41b-4cac-9be0-d97607436f1a',
    '2012c599-0810-4d28-b11f-88a3e25e9b93'
  ];
  matched_ids TEXT[];
  cleanup_at TIMESTAMP(3) := CURRENT_TIMESTAMP AT TIME ZONE 'UTC';
BEGIN
  -- Serialize with preparation/signing. An environment without this exact
  -- account and these exact documents intentionally does nothing.
  PERFORM c.id FROM "BoosterContract" c
  JOIN "User" u ON u.id = c."boosterId"
  WHERE c.id = ANY(test_ids)
    AND u.id = 'cmuf2qbv300043qm5zepdvyxb'
    AND lower(u.email) = 'support@fastboost.gg'
    AND c."signingProvider" = 'FASTBOOST' AND c."envelopeId" IS NULL
  ORDER BY c.id FOR UPDATE OF c;

  SELECT array_agg(c.id ORDER BY c.id) INTO matched_ids
  FROM "BoosterContract" c JOIN "User" u ON u.id = c."boosterId"
  WHERE c.id = ANY(test_ids)
    AND u.id = 'cmuf2qbv300043qm5zepdvyxb'
    AND lower(u.email) = 'support@fastboost.gg'
    AND c."signingProvider" = 'FASTBOOST' AND c."envelopeId" IS NULL;

  IF matched_ids IS NULL THEN RETURN; END IF;

  -- Hold pending outbox rows so a worker cannot claim them during cleanup.
  -- A claimed send may already be in flight; fail atomically in that case.
  PERFORM id FROM "NativeContractEmail"
  WHERE "contractId" = ANY(matched_ids) AND "sentAt" IS NULL AND "skippedAt" IS NULL
  ORDER BY id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM "NativeContractEmail"
    WHERE "contractId" = ANY(matched_ids) AND "sentAt" IS NULL AND "skippedAt" IS NULL
      AND claim IS NOT NULL) THEN
    RAISE EXCEPTION 'FastBoost test-document cleanup found an email send in progress; retry after delivery settles.';
  END IF;

  UPDATE "NativeContractEmail"
  SET "skippedAt" = cleanup_at, claim = NULL, "lastError" = 'TEST_DOCUMENT_ARCHIVED'
  WHERE "contractId" = ANY(matched_ids) AND "sentAt" IS NULL AND "skippedAt" IS NULL;

  UPDATE "BoosterContract" SET "archivedAt" = cleanup_at
  WHERE id = ANY(matched_ids) AND "archivedAt" IS NULL;

  UPDATE "Notification" n SET active = false
  FROM "BoosterContract" c
  WHERE c.id = ANY(matched_ids) AND n.type = 'BOOSTER_CONTRACT'
    AND n.id IN ('contract-' || c.id, 'contract-company-' || c.id)
    AND n.active = true;
END $$;

COMMIT;
