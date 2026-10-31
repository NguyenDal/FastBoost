# FastBoost deployment security review — 2026-10-31 (America/Winnipeg)

## Scope

Read-only checks against `https://www.fastboost.gg` and `https://fastboost-api.onrender.com`, review of the current repository, npm advisory checks, and local regression tests. No production account, order, payment, message, document, or signature was created or changed. The live API was deployed from `37dcbf4`; the live web build was deployed from `3323bbc` when checked.

## Findings

1. **High priority — affected API packages remain in the deployed lockfile.** The deployed API commit resolves `body-parser` 2.3.0 and `multer` 2.4.0, both covered by current high severity denial-of-service advisories. It also resolves `fast-uri` 3.1.8 and `nodemailer` 10.1.2, covered by moderate advisories. `npm audit --omit=dev` initially reported two high and two moderate vulnerable packages. The local lockfile now resolves 2.4.0, 2.5.0, 3.1.9, and 10.3.1 respectively; an online audit after the update reports zero API vulnerabilities. The live deployment remains on the old lockfile until a release.
2. **Medium — web pages can be framed.** The production HTML response has neither `X-Frame-Options` nor a `Content-Security-Policy` `frame-ancestors` directive. This permits another site to embed sensitive FastBoost pages and attempt clickjacking. Add `X-Frame-Options: DENY` and `Content-Security-Policy: frame-ancestors 'none'` for `/*` in the Render static site's HTTP Headers settings, then verify both on the public response. [Render supports static-site response header rules](https://render.com/docs/static-site-headers). This setting is not stored in the repository, so no live header change was made here.
3. **Low — API CORS accepts every browser origin.** A preflight from `https://security-check.invalid` received `Access-Control-Allow-Origin: *`. This does not bypass bearer-token authentication, but unnecessarily makes API responses readable to scripts on arbitrary sites. The local API now permits only the configured `CLIENT_URL` origin and leaves direct requests without an Origin unaffected. Production still has wildcard CORS until the API change is released.
4. **Toolchain — six moderate frontend npm alerts remain.** The frontend production dependency audit is clean after lockfile updates. The remaining alerts stem from `minimatch` in the local ESLint dependency graph; npm currently reports no fix. These packages are build and lint tools, not browser code.

## Checks that passed

- Twelve representative private GET routes across account, orders, support, operations, wallet, activity logs, and payments returned `401` without a token. A malformed bearer token and an unsigned `alg: none` JWT also returned `401`.
- The public `.env` request returned only the frontend fallback HTML; the API `.env` request returned `404`. A request for the current frontend bundle's source map returned fallback HTML, not a source map.
- Repository review found that registration fixes the role to `CUSTOMER`, session verification checks the current database account and password-derived stamp, private chat checks current access, and sensitive order credential reads have role and assignment tests. No direct privilege bypass was demonstrated.
- The API lockfile now audits with zero vulnerabilities, the frontend production dependency set audits with zero vulnerabilities, the frontend builds, and the focused security, CORS, upload, and email regression tests pass. Sandbox-only localhost test failures were rerun with loopback permission and passed.

## Limits and next verification

This is a non-destructive assessment, not an exhaustive penetration test. Cross-account IDOR, role escalation with real sessions, payment abuse, and clickjacking interaction need dedicated production-safe test accounts or staging data. After release, rerun `verification/security-readonly-probe.mjs` and confirm the foreign-origin preflight lacks `Access-Control-Allow-Origin`, the web response includes frame protection, and the deployed API uses the patched packages. Keep authenticated testing isolated from real customer orders and signatures.
