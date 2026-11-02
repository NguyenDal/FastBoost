# Google Ads purchase measurement

The integration stays disabled unless both public build variables are valid:

```dotenv
VITE_GOOGLE_ADS_ID=AW-18504395858
VITE_GOOGLE_ADS_PURCHASE_LABEL=N3xzCMW0p7AdENLYyvdE
```

These identify the manually created FastBoost purchase action verified in Google
Ads. They are public tag identifiers, not API credentials. Add them to the
frontend build environment and rebuild only after review/approval. Creating the
Google Ads action alone does not install this integration.
`google-ads.env.example` contains blank defaults and commented verified values;
it is a reference file and Vite does not load it automatically.

- There is no automatic popup or global privacy button. The Google tag loads only
  after the visitor explicitly enables the optional ad measurement checkbox in
  email/social registration, Profile Settings, or the public Privacy Policy page's
  **Ad measurement preferences** section. Terms/Privacy Policy acceptance and
  promotional email consent do not enable it. Registration and ordering remain
  available without opting in.
- Leaving the signup checkbox unchecked does not trigger reminders or later
  consent prompts. Profile Settings and the Privacy Policy keep the preference
  collapsed until the visitor deliberately opens it; there is no checkout or
  login consent prompt.
- Changing the checkbox takes effect immediately for this browser and is stored
  locally, independently of account creation or profile saving. It is not synced
  to an account or other devices. Existing users stay untracked until they opt in.
  Turning it off blocks this site's conversion dispatch and removes its
  first-party `_gcl_` cookies. The public privacy page allows withdrawal even
  while signed out.
- Enhanced conversions and ad personalization are disabled. The payload allows
  only the public conversion destination, opaque order ID, persisted settled
  service value, and currency. Page context excludes checkout/auth query strings.
- The authenticated verification endpoint must return `paid: true` and
  `purchaseConversion`. The client never derives a purchase from a page visit,
  a button click, an unverified return URL or a checkout quote.
- Purchase values include wallet plus card tender after discounts. Gold-only
  service purchases have zero monetary value. Wallet funding is not sent as a
  service purchase.
- A current local payment attempt or a recent verified Stripe return is required.
  Old receipt visits are excluded. Repeated events use the same transaction ID;
  a dispatch with a completed processing callback is remembered in the browser. The callback
  is not proof Google Ads attributed or reported the conversion.
- Events can be missed when consent is declined, the browser is blocked/offline,
  or the customer never returns. This is browser measurement, not a server-side
  conversion import. No historical orders are backfilled.
- Opting in later during signup can miss attribution if the original Google
  click identifier is no longer in the URL. This integration does not preserve
  advertising identifiers before permission to compensate for that gap.

Before release, review the conversion's primary/secondary status, currency/value
and counting settings, and existing actions to prevent duplicate purchase goals.
Validate the tag with Google Tag Assistant in a safe non-production payment flow.
Do not submit a live charge just to test measurement. A reported, attributable
conversion must be verified separately after a genuine eligible paid order.

Focused automated checks:

```sh
node --test test/googleAdsPurchase.test.js test/paymentVerification.test.js
```
