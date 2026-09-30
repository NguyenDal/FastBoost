# FastBoost DocuSign setup

The integration uses the eSignature REST API, JWT grant, embedded signing, and
HMAC-authenticated Connect events. Start in the free developer sandbox. No actual
contract has been sent by the coding agent.

## 1. Developer account and integration

1. Create a developer account at https://developers.docusign.com/ . Choose **API Integration**.
2. Open **Settings → Apps and Keys → Add App and Integration Key**.
3. Name it **FastBoost**. Record the integration key, User ID, and API Account ID.
4. Add an RSA key pair. Store its private key only in server secrets or a private
   file outside the repository. Do not put it in Vite variables or commit it.
5. Register both redirect URIs for sender consent as separate entries:
   `http://localhost:5173/` and `https://www.fastboost.gg/`.
   These are separate from the signing return origin below. Repeat/check them
   when activating the integration in production.
6. After publishing the legal pages, set **Link to Privacy Policy** to
   `https://www.fastboost.gg/privacy-policy` and **Link to Terms of Use** to
   `https://www.fastboost.gg/terms-and-conditions`. These are public document links,
   separate from the redirect URIs. Both documents currently carry a review-draft
   label; review their wording and publication dates before making them final.

## 2. Contract template

The review page `/provider-agreement` requires an active admin or booster account.
The HTML and PDF live in `server/private/legal/`, outside the frontend's public
assets and bundles. Both `/api/operations/provider-agreement` and its `/document`
download check the current account's permissions and return `Cache-Control: no-store`.
The frontend fetches them with an Authorization header; no token is put in a URL.
Deploy both API and frontend changes together; do not copy these files into a
public folder. Terms and Privacy Policy remain public. Rebuild the PDF from the
wording with `python scripts/build-provider-agreement-pdf.py` at the repository
root (ReportLab, lxml, and Arial or Liberation Sans TTF fonts are required).
The current FB-PA-1.1 PDF is an unsigned **review draft**, not a final signing
template. Approve the remaining commercial settings and finalize the wording
before removing its review labels and uploading a signing version.

1. In the sandbox's Templates area, upload the finalized PDF and save a template.
2. Enable signing order. Add exactly two signer roles, with name/email blank:
   **FastBoost** at order **1**, and **Booster** at order **2**. Do not add other
   recipients. The server validates both roles and inherits template routing.
3. Give each role a required Signature and Date Signed field in its own signature
   block. Add required initials for Schedule A approval. Add the appropriate Full
   Name field for the provider signature block; do not leave placeholder text there.
4. Add Booster-owned text fields with these exact **Data Labels**. The server fills
   and locks them before either signer opens the envelope:

   | Data Label | Source |
   | --- | --- |
   | `ProviderLegalName` | Legal name entered by the admin |
   | `ProviderEmail` | Booster's registered email |
   | `ProviderAccountId` | FastBoost booster account ID |
   | `AgreementId` | FastBoost contract reference |
   | `EffectiveDate` | Admin's requested start date (`YYYY-MM-DD`) |

5. Replace the remaining bracketed placeholders with required FastBoost-owned
   fields (or finalized fixed wording): authorized signatory if applicable, work
   location, optional end date, payment method/payee/currency, conversion rule,
   transfer fees, permitted scope, time zone/data-access countries, language, and
   any jurisdiction addendum. Make enough room for realistic values; replace the
   placeholder text rather than overlapping it. FastBoost completes these and
   signs first, so the booster reviews the completed terms before signing.
6. Record the Template ID in the backend. New sends reject missing identity
   fields or a single-signer template. Published webpage edits never amend an
   issued envelope. Keep a separate template/version for revised terms.

Only the configured FastBoost signer can open its company signing session; their
FastBoost login must be an active admin. The sender's DocuSign API user can be a
different account. Both recipient identities are saved on each contract, so
changing configuration does not transfer an already-issued signing invitation.
Tenure starts on the later of the requested effective date and verified completion
of both signatures. An established provider's original tenure is preserved.
Existing legacy single-signer envelopes remain verifiable; all new sends require
two signers.

## 3. Server settings

Use `server/.env` locally or the hosting platform's environment secrets. Never
copy these into a frontend environment file.

```dotenv
DOCUSIGN_ENVIRONMENT=demo
DOCUSIGN_INTEGRATION_KEY=<integration-key>
DOCUSIGN_USER_ID=<sender-user-id>
DOCUSIGN_ACCOUNT_ID=<api-account-id>
DOCUSIGN_TEMPLATE_ID=<template-id>
DOCUSIGN_PRIVATE_KEY_PATH=<absolute-path-to-private-PEM-file>
DOCUSIGN_RETURN_ORIGIN=http://localhost:5173
DOCUSIGN_CONSENT_REDIRECT_URI=http://localhost:5173/
DOCUSIGN_CONNECT_HMAC_KEYS=<connect-hmac-secret>
DOCUSIGN_COMPANY_SIGNER_NAME=<FastBoost-signers-full-legal-name>
DOCUSIGN_COMPANY_SIGNER_EMAIL=<FastBoost-signers-admin-login-email>
```

For hosts without private files, use `DOCUSIGN_PRIVATE_KEY` with the PEM content
(actual newlines or escaped `\n`), instead of `DOCUSIGN_PRIVATE_KEY_PATH`.
The API base URI is discovered from DocuSign userinfo for the configured account.

Example local private-key location outside the repository:
`C:/Users/An Nguyen Nguyen/.fastboost-secrets/docusign-demo.pem`.
For production set `DOCUSIGN_RETURN_ORIGIN=https://www.fastboost.gg` and
`DOCUSIGN_CONSENT_REDIRECT_URI=https://www.fastboost.gg/`, with production credentials.

Run `node scripts/docusign-consent-url.js` from `server` and open the generated
URL while signed in as the sender user. Grant `signature impersonation` consent.
The redirect's authorization code is not used: the server authenticates with JWT.
See https://www.docusign.com/blog/developers/oauth-jwt-granting-consent .

## 4. Connect status notifications

In DocuSign Settings → Connect, create a JSON SIM webhook configuration:

- URL: `https://<your-api-host>/api/operations/docusign/webhook`
- Events: envelope completed, declined, voided, delivered, and sent; also
  **recipient completed** so the first signature promptly unlocks booster signing.
- Enable HMAC signing and copy its secret into `DOCUSIGN_CONNECT_HMAC_KEYS`.
- Enable retries/acknowledgement. Do not include document bytes in event payloads.
- For key rotation, the server accepts a comma-separated list of HMAC secrets.

Local testing requires a HTTPS tunnel to the local API; signing returns to the
local frontend. Do not point sandbox events at production. Events are authenticated
against raw bytes, then the API independently verifies the envelope and signer.
Return URL parameters never mark an agreement signed. Refreshing FastBoost reads
the saved status; manual provider status checks are throttled to 15 minutes.

## 5. Database and verification

The migrations are `20260930000000_booster_contracts` and
`20260930010000_contract_countersignature`. Apply them to the intended
development database after checking migration history; the local project has
historical migration drift, so do not reset the database or blindly apply unrelated
migrations. Regenerate Prisma after migration (`npx prisma generate`).

1. Open Management Utilities → Booster Management; configuration should show sandbox.
2. Send a **test** template to a test booster account using fictional test details.
3. Sign in as the configured FastBoost signer; open the contract notification,
   complete the required terms, and personally review/sign through DocuSign.
4. Confirm recipient-completed Connect delivery records the company signature
   and unlocks the booster. Before this, neither tenure nor full completion may
   be recorded. Sign in as the booster, open Assigned Orders → My earnings,
   contributions & contracts, and personally review/sign the completed agreement.
5. Verify both signature timestamps, full completion, tenure date, PDF, and
   certificate. Confirm another admin cannot open the owner's signing session.
6. Test cancellation, decline, forged return parameters, other-user access,
   duplicate send retries, and repeated/out-of-order Connect events.

The test suite uses mocked DocuSign responses; a real sandbox round trip is still
required after credentials and the template are supplied. A successful send is a
DocuSign envelope, not merely a local typed-name acceptance.

## Production

The deployed FastBoost API is hosted on Render. In the Render dashboard, open the
backend web service (**fastboost-api**) and its **Environment** settings. Add a
Secret File named `docusign-production.pem` containing the complete production
private PEM, then use `DOCUSIGN_PRIVATE_KEY_PATH=/etc/secrets/docusign-production.pem`.
Render mounts secret files at `/etc/secrets/<filename>`; it cannot access a Windows
path on the developer computer. Alternatively set DOCUSIGN_PRIVATE_KEY directly
as a secret environment value, but do not set both key sources.

Set these backend variables with values from the production DocuSign account:

```dotenv
DOCUSIGN_ENVIRONMENT=production
DOCUSIGN_INTEGRATION_KEY=<promoted-integration-key>
DOCUSIGN_USER_ID=<production-sender-user-id>
DOCUSIGN_ACCOUNT_ID=<production-api-account-id>
DOCUSIGN_TEMPLATE_ID=<production-template-id>
DOCUSIGN_PRIVATE_KEY_PATH=/etc/secrets/docusign-production.pem
DOCUSIGN_RETURN_ORIGIN=https://www.fastboost.gg
DOCUSIGN_CONSENT_REDIRECT_URI=https://www.fastboost.gg/
DOCUSIGN_CONNECT_HMAC_KEYS=<production-connect-secret>
DOCUSIGN_COMPANY_SIGNER_NAME=<FastBoost-signers-full-legal-name>
DOCUSIGN_COMPANY_SIGNER_EMAIL=<FastBoost-signers-admin-login-email>
```

For a hosted sandbox test use a separate test/staging service, demo credentials,
DOCUSIGN_ENVIRONMENT=demo, and that test site's return origin. Deployment hosting
and DocuSign's demo/production environment are separate choices. Adding a demo key
to Render does not promote it to production. The current feature code and migration
must also be deployed before these settings can enable the new endpoints.

Follow DocuSign's integration go-live process and confirm the production API plan
supports the intended usage before purchasing. Use production account/template IDs,
production sender consent, `DOCUSIGN_ENVIRONMENT=production`, a HTTPS FastBoost
return origin, and a separate Connect secret. Existing sandbox contracts stay
bound to their sandbox account and cannot be queried with production credentials.

Failed sends retain a request ID and are retried from the same contract. After the
six-day recovery window, reconcile the envelope in DocuSign manually before
creating another contract; provider transaction IDs expire after seven days.

References:
- https://developers.docusign.com/docs/esign-rest-api/esign101/concepts/embedding/
- https://developers.docusign.com/platform/webhooks/connect/implement/
- https://www.docusign.com/blog/developers/common-api-tasks-use-transactionid-to-find-the-envelope-you-created
- https://render.com/docs/configure-environment-variables
- https://www.docusign.com/blog/developers/dsdev-from-the-trenches-your-apps-approved-for-go-live-now-configure-your-production-account
