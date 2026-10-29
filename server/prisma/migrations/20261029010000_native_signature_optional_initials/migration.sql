-- Inline signing accepts the full legal name without separate initials.
-- Preserve historical initials and every other evidence constraint.
ALTER TABLE "NativeContractSignature"
  DROP CONSTRAINT "NativeContractSignature_name_check",
  ADD CONSTRAINT "NativeContractSignature_name_check" CHECK (
    char_length(btrim("legalName")) BETWEEN 2 AND 100
    AND char_length(btrim("initials")) BETWEEN 0 AND 16
  );
