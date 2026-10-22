# FastBoost DocuSign setup

New agreements now use [FastBoost website signing](NATIVE_SIGNING_SETUP.md).
This guide remains for historical DocuSign agreements and their original provider
configuration. The old signing assets are preserved for those records.

The integration uses the eSignature REST API, JWT grant, recipient-view signing
in a separate browser tab, and HMAC-authenticated Connect events. Start in the free developer sandbox. No actual
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

## 2. Versioned Booster Service Agreement

Admin Booster Management uses **Send a document** with a **Document type** selector.
**Booster Service Agreement** requires a Start date and the booster's full legal name.
**Payout Information (to be implemented)** displays an Effective date and cannot be
sent. The API rejects that unavailable type before creating a record or contacting
DocuSign. It does not collect payout account credentials or change tenure.

New agreements use bundled version **FB-BSA-2.0**. The server sends its PDF and
required signing fields with each envelope; it no longer depends on the old remote
sandbox template. `BoosterContract.templateId` snapshots this version marker, while
historical records retain their saved remote template IDs and recipient details.
Issued envelopes are never rewritten by later source or configuration changes.

The private HTML, preview PDF and signing package live in `server/private/legal/`,
outside frontend public assets. `/provider-agreement` requires an active admin or
booster account; both authenticated API endpoints return `Cache-Control: no-store`.
The HTML is the source for the agreement wording. Rebuild from the repository root:

```powershell
python scripts/build-provider-agreement-pdf.py
python scripts/build-provider-agreement-pdf.py --signing-template
```

ReportLab, lxml and Arial or Liberation Sans TTF fonts are required. The first command
creates the unsigned PDF served by the preview. The second creates the execution
layout, field coordinates and importable JSON under `output/pdf/`, and updates the
versioned package `server/private/legal/booster-service-agreement.template.json`.
The package contains the entire PDF and required DocuSign fields. Deploy the API
and those private assets together. Do not copy them into a public directory.

The signing document identifies An Nguyen Nguyen, trading as FastBoost, retains
Manitoba/applicable Canadian governing law subject to mandatory local protections,
and records the 70% approved-match pool and payment on the 1st. It uses USD and
requires provider identity, work location and remaining commercial settings before
signing. FastBoost completes and signs first (recipient 1); the Booster reviews the
completed terms and signs second (recipient 2). Identity, agreement reference and
start date are prefilled and locked. Both recipients have signature/date fields and
commercial-settings initials. Payment credentials and tax IDs are collected through
a separate approved secure process, not the agreement.

Review the completed terms and any required local addendum before execution. A
production-quality document does not change the configured DocuSign environment:
`demo` remains the developer sandbox. Production use requires the production API
account, integration approval/consent, credentials, return origin and Connect setup.
The source update never promotes the integration, sends an agreement or signs one.

For explicit sandbox-only layout copies, `--sandbox-template` remains available.
Those exports are visibly marked as tests and are never used by the bundled send
path. If importing a version into DocuSign Templates for inspection, use the
`FastBoost_Booster_Service_Agreement_signing.template.json` output. No remote
Template ID is needed for new bundled sends. Keep `DOCUSIGN_TEMPLATE_ID` only if
other legacy tooling still relies on it; retries use each saved record's ID.

Only the configured FastBoost signer can open its company signing session; their
FastBoost login must be an active admin. The sender's DocuSign API user can be a
different account. Both recipient identities are saved on each contract, so
changing configuration does not transfer an already-issued signing invitation.
Tenure starts on the later of the requested effective date and verified completion
of both signatures. An established provider's original tenure is preserved.
Existing legacy single-signer envelopes remain verifiable; all new sends require
two signers.

Section 01 displays the saved username, not the internal account UUID. Older
templates with the `ProviderAccountId` data label are supported by filling that
field with the username on new sends; import the regenerated template to update
its printed caption too. Issued envelopes keep the document and values captured
when sent. Internal recipient IDs and ownership checks still use the account UUID.

Review & sign opens a fresh DocuSign recipient-view URL in a new tab. No signing
iframe is loaded on the contract page. The return route
`/provider/contracts/:id/signing-return` notifies the original tab to refresh and
closes the signing tab where supported, with a return link as fallback. This route
contains no contract data and never treats return parameters as proof of signing.
The booster cannot see or download the issued agreement until FastBoost's signature
has been verified; admins retain document access while preparing and signing it.

## 3. Server settings

Use `server/.env` locally or the hosting platform's environment secrets. Never
copy these into a frontend environment file.

```dotenv
DOCUSIGN_ENVIRONMENT=demo
DOCUSIGN_INTEGRATION_KEY=<integration-key>
DOCUSIGN_USER_ID=<sender-user-id>
DOCUSIGN_ACCOUNT_ID=<api-account-id>
# Optional for legacy tooling; new agreements use the bundled version:
# DOCUSIGN_TEMPLATE_ID=<legacy-remote-template-id>
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
Return URL parameters never mark an agreement signed. FastBoost reads saved status
on return, focus, and visibility changes, and every 5 seconds while a pending
contract is visible, for up to 10 minutes. Opening a signing tab restarts that
bounded refresh period. This does not poll DocuSign; an active Connect callback is
required for automatic signature confirmation. The manual API sync endpoint
remains throttled to 15 minutes and has no button in the contract UI.

For a tunnel on the developer computer, use the restricted relay rather than
exposing the entire API. After setting the sandbox HMAC secret, start
`node scripts/docusign-local-relay.js` from `server`, then direct the HTTPS tunnel
to `http://127.0.0.1:5011`. Register its public URL plus
`/api/operations/docusign/webhook` in the sandbox Connect configuration. The relay
accepts only POST JSON on that exact path, rejects invalid signatures and bodies
over 2 MB, and forwards the unchanged signed bytes to the local API. All other
paths are blocked. It uses `PORT` for the API port (default 5000) and
`DOCUSIGN_RELAY_PORT` for its own port (default 5011). Restart the API and relay
after changing secrets. Stop the tunnel and disable its Connect configuration
when the test ends; temporary tunnel URLs change between sessions.

## 5. Database and verification

The migrations are `20260930000000_booster_contracts` and
`20260930010000_contract_countersignature`. Apply them to the intended
development database after checking migration history; the local project has
historical migration drift, so do not reset the database or blindly apply unrelated
migrations. Regenerate Prisma after migration (`npx prisma generate`).

1. Confirm the server uses the sandbox configuration, then open Management Utilities
   → Booster Management.
2. Send a **test** template to a test booster account using fictional test details.
3. Sign in as the configured FastBoost signer; open the contract notification,
   click Review & sign, and confirm DocuSign opens in a separate tab. Complete the
   required terms and personally review/sign there.
4. Confirm recipient-completed Connect delivery records the company signature
   and unlocks the booster. Before this, neither tenure nor full completion may
   be recorded. Sign in as the booster, open Assigned Orders → My earnings,
   contributions & contracts, and personally review/sign the completed agreement.
5. Verify both signature timestamps, full completion, tenure date, PDF, and
   certificate. Confirm another admin cannot open the owner's signing session.
6. Test blocked tabs/pop-ups, closing a signing tab early, cancellation, decline,
   forged return parameters, other-user access, downloads before FastBoost signs,
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
