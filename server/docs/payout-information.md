# Remitly payout information

This workflow collects recipient bank details for manual review. It does not send
money, connect a Remitly account, validate bank ownership with Remitly, or approve
a transfer amount/exchange quote. Keep the final transfer and any quote acceptance
in the existing payout process.

## Setup

1. Apply `20261029020000_payout_information` with the normal release migrations.
2. Regenerate Prisma using `npx prisma generate` from `server`.
3. Existing `AWS_REGION` and `ORDER_PASSWORD_KMS_KEY_ID` settings provide the
   default KMS key. Optionally set `PAYOUT_INFORMATION_KMS_KEY_ID` to a dedicated
   payout key in the same region. The server identity needs `kms:GenerateDataKey`
   and `kms:Decrypt` permission for that key, with the encryption context below.

The configuration endpoint checks the table and key configuration, not a live
KMS operation. An unavailable KMS service or denied key permission rejects saves
and reveals with a safe 503; there is no plaintext fallback. When rotating keys,
retain decryption permission for earlier envelope keys until the records have
been deliberately re-encrypted. The encrypted KMS key blob identifies the key
used to encrypt each record; it is not a plaintext key.

## Data and access

- A separate `PayoutInformation` row is created once per booster. Admin chooses
  US or Vietnam when requesting it. Admin can correct the country only while
  the request has never had bank details submitted. Repeated requests do not
  overwrite an existing submission or verification.
- US: account holder's full name, nine-digit ABA routing number and account
  number, with currency USD. Routing-number syntax/checksum does not prove that
  the account exists or is owned by the provider.
- Vietnam: account holder's full name, bank name and account number, with the
  bank account currency explicitly selected as USD or VND. Currency selection
  is not acceptance of any future conversion quote.
- Only the booster can submit/update their details. Admins can review, request
  correction, or mark a submission verified by FastBoost. Admin boosters cannot
  verify their own details. Edits reset review and require another review.
- Authenticated owner/admin detail reads are an explicit `POST /details` reveal.
  Full details are not included in list/context responses. Responses inherit
  `Cache-Control: no-store` from operations routing.
- All sensitive values are one AES-256-GCM encrypted JSON payload. Fresh data
  keys and IVs are used for every submission. KMS encryption context and local
  GCM AAD bind `purpose=fastboost-payout-information-v1`, request ID, booster ID
  and the immutable payload revision. Metadata review revisions are separate so
  verification does not change the original encryption binding.
- Full name, account/routing numbers and bank name never enter generic account
  data, signed agreements, audit payloads, email or notification content. Lists
  include only non-secret status metadata, country/currency and last four account
  digits. Audit records are transaction-bound and contain status/revision/country
  only. Request, submit, country correction, review and reveal are journaled.

## API (under `/api/operations`)

- `GET /payout-information/configuration`: admin-only `{ok, configured}`.
- `GET /payout-information`: admin all / eligible booster own `{ok, requests}`.
  `?scope=mine` always limits the personal documents portal to the signed-in
  booster, including admins with booster access. `scope=all` is admin-only.
- `POST /boosters/:boosterId/payout-information`: admin
  `{requestId: UUID, country: 'US'|'VN'}` → `{ok, id}`.
- `GET /payout-information/:id`: `{ok, request, boosterName, own, canSubmit, canReview, canChangeCountry}`.
- `POST /payout-information/:id/details`: explicit reveal → `{ok, details, revision}`.
- `POST /payout-information/:id/country`: admin, requested-only
  `{revision, country}` → `{ok, request}`.
- `POST /payout-information/:id/submit`: owner `{revision, confirmed: true, details}`
  → `{ok, request}`. `details` contains the fields specified above plus country.
- `POST /payout-information/:id/review`: admin `{revision, decision:'verify'|'return',
  reason?:'ACCOUNT_DETAILS'|'NAME_MISMATCH'|'OTHER'}` → `{ok, request}`. Reason is
  required for a return. Free-form bank-related notes are not collected.

All changes use optimistic revision checks; an outdated form receives409 and
must refresh before attempting to save or review again. Notifications use the
strict target `/provider/payout-information/:id` and contain no banking fields.

Tests: `node --test test/payoutInformation.test.js test/payoutInformationCrypto.test.js test/payoutInformationMigration.test.js`.
