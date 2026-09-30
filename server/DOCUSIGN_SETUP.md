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

1. In the sandbox's Templates area, upload your existing PDF and save a template.
2. Add one signer role named exactly **Booster**, leaving its name and email blank.
3. Place required signature and date-signed fields on the PDF. The admin enters
   the booster's full legal name before sending; the registered email is used.
4. Record the Template ID. This version supports one booster signer per agreement.
   Company countersignatures require an additional explicitly configured role.
5. The FastBoost start date tracks tenure. It does not edit the wording or dates
   in your PDF; ensure the document reflects the agreed terms before sending.

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
- Events: envelope completed, declined, voided, delivered, and sent.
- Enable HMAC signing and copy its secret into `DOCUSIGN_CONNECT_HMAC_KEYS`.
- Enable retries/acknowledgement. Do not include document bytes in event payloads.
- For key rotation, the server accepts a comma-separated list of HMAC secrets.

Local testing requires a HTTPS tunnel to the local API; signing returns to the
local frontend. Do not point sandbox events at production. Events are authenticated
against raw bytes, then the API independently verifies the envelope and signer.
Return URL parameters never mark an agreement signed. Refreshing FastBoost reads
the saved status; manual provider status checks are throttled to 15 minutes.

## 5. Database and verification

The new migration is `20260930000000_booster_contracts`. Apply it to the intended
development database after checking migration history; the local project has
historical migration drift, so do not reset the database or blindly apply unrelated
migrations. Regenerate Prisma after migration (`npx prisma generate`).

1. Open Management Utilities → Booster Management; configuration should show sandbox.
2. Send a **test** template to a test booster account.
3. Sign in as that booster, open Assigned Orders → My earnings, contributions & contracts.
4. Review/sign through DocuSign. Verify the signed state, PDF, and certificate.
5. Test cancellation, decline, forged return parameters, other-user access,
   duplicate send retries, and a repeated Connect event.

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
