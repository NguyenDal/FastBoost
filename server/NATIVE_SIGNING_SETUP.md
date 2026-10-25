# FastBoost website signing

New Booster Service Agreements are issued and signed inside FastBoost. No signing
provider subscription, API key or external signing iframe is required. Existing
DocuSign agreements keep their original signing provider and documents.

The Booster Management form and contract status card retain their existing layout.
**Send agreement** creates a private invitation. **Review & sign** opens
`/provider-agreement?contract=<id>` using the existing agreement design. The static
`/provider-agreement` page remains an unsigned preview.

## Signing flow

1. An admin issues an invitation with the booster's legal name and requested start
   date. The server captures current recipient identities, the agreement wording,
   PDF and field layout as a private snapshot, version **FB-BSA-2.2**.
2. The assigned FastBoost signer fills six commercial details and saves the
   agreement with English as the fixed seventh setting. This prepares one exact
   HTML/PDF snapshot. FastBoost may correct those details until the provider signs.
3. The assigned provider reviews the saved agreement and signs with their own
   account, legal name, Schedule A initials and explicit electronic-signing
   consent. The FastBoost signer then reviews the same agreement and provider
   signature before countersigning. Version 2.2 requires the provider signature first.
4. The server saves the completed PDF and completion record before marking the
   agreement completed or initializing provider tenure. Downloads return those
   exact saved bytes. Later edits to the agreement source do not change them.

Terms cannot be changed after the first signature. Later corrections require a
new agreement and both signatures. An unsigned, independently verified **sandbox**
DocuSign invitation can be explicitly replaced from its website signing page.
Its original record is retained and retired locally; this does not void the
external sandbox envelope. Signed, production and unverifiable DocuSign envelopes
cannot be converted by this action.

Unsigned FB-BSA-2.1 drafts display the current FB-BSA-2.2 form without changing
the database on a read. FastBoost must save the current fields, then the provider signs the
2.2 document before FastBoost can countersign. Agreements already signed by
FastBoost under 2.1 retain that exact company-first snapshot and PDF so the
provider can finish signing.

## Configuration and storage

The existing authenticated API and PostgreSQL database handle signing. Keep the
application's `JWT_SECRET` configured. Short-lived signing challenges are bound to
the account, role, exact document and current PDF. They do not sign agreements by
themselves. Each signature requires a deliberate authenticated submission.

Optional `FASTBOOST_COMPANY_SIGNER_NAME` and `FASTBOOST_COMPANY_SIGNER_EMAIL` select
the countersigner. The established `DOCUSIGN_COMPANY_SIGNER_*` settings remain a
fallback for migration. Without an email override, the server selects the single
active owner admin. The default FastBoost legal signer name is An Nguyen Nguyen,
consistent with the agreement. Ambiguous or unavailable owners fail closed.

`BoosterContract` stores the frozen snapshot, current/final private PDF and SHA-256
digests. `NativeContractSignature` stores each signer's account reference, name,
email, exact consent text, initials, signature, server timestamp, accepted document
hash, idempotency request and bounded security context. Preserve these records in
database backups and restrict access. The API never serves signing assets publicly.

## Agreement emails

`NativeContractEmail` queues one delivery per event and recipient in the same
transaction as issuance, preparation or signing. The booster receives an issuance
notice and a second notice when FastBoost saves the completed terms. FastBoost
receives a notice when the booster signs. After both signatures, both parties
receive a branded completion message with an authenticated agreement link and the
exact stored signed PDF as an attachment. Mail delivery retries independently of
the signing request, so a mail outage does not ask either party to sign again.

The worker uses `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, optional `SMTP_FROM`, and a
valid public HTTPS `CLIENT_URL` in production. Set
`NATIVE_CONTRACT_EMAILS_ENABLED=false` only to pause sending while retaining queued
events. Apply the additive `20261025010000_native_contract_emails` migration and
generate Prisma Client before starting the worker against a database. The worker
does not send mail in tests or in the inert browser preview.

The FastBoost completion record is an electronic-signing evidence record. It is
not an independent identity certificate or an Adobe-trusted certificate signature.
Contract enforceability remains subject to the agreement and applicable law.

## Assets and deployment

Historical DocuSign assets remain unchanged. The native HTML and PDFs are separate
files under `server/private/legal/`. The font is Noto Sans, distributed with its
SIL Open Font License. All runtime PDF filling uses bundled files; no external font
or signing service is called.

Rebuild the native preview and signing package from the repository root:

```powershell
python scripts/build-provider-agreement-pdf.py --native
python scripts/build-provider-agreement-pdf.py --native --signing-template
```

The additive migrations are `20261022010000_native_contract_signing`,
`20261022020000_archive_contracts`, and `20261025010000_native_contract_emails`.
Generate Prisma after schema changes. Before
deploying to a different database, inspect that
database and its migration history, then apply the committed migration through
the normal deployment process. A local database activation does not activate
production. Keep the API, frontend, private assets and generated client together.

## Previous agreements

`archivedAt` removes an agreement from the active admin and provider lists without
changing its signing status, signatures, saved PDFs or established booster tenure.
Authorized users can still read its record and available document through the
existing direct links. Archived agreements cannot be prepared, signed, retried or
replaced; delayed legacy webhooks cannot update their signing state.

The schema migration does not archive data. Any one-time cleanup must target an
explicit captured set of agreement IDs, retain a recovery manifest and preserve
the original evidence. New agreements created after that cutoff remain active.

## Verification

Protocol tests cover actor/role checks, provider-first ordering, historical company-first ordering, frozen terms,
challenge expiry and binding, consent, malformed signatures, retry/concurrency,
artifact integrity, rollback before final PDF persistence, tenure preservation and
explicit sandbox replacements. PDF tests cover completed settings, escaped HTML,
Unicode identities, typed/drawn signatures and the private completion record.
Browser signing QA must use inert fixtures, never execute a real agreement for a
user. Review the final PDF layout after changes to wording or field coordinates.
