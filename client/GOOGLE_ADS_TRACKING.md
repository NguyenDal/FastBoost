# Google Ads service pricing page measurement

The integration stays disabled unless both public build variables are valid:

```dotenv
VITE_GOOGLE_ADS_ID=AW-18504395858
VITE_GOOGLE_ADS_SERVICE_PRICE_VIEW_LABEL=<label from Service Price View action>
```

Use a manual Website conversion named **Service Price View**, category **Page
view**, with a fixed value of **0** and Count **One**. The current wizard requires
a value setting; zero records no revenue for a price-page visit. The event itself
omits value and currency. Make it Primary and select its
goal for this campaign. Count One means one attributed conversion per ad click,
not one per visitor or a total site traffic counter. Remove the retired Purchase
action from the campaign. The old purchase label is no longer read by the app.
These are public identifiers, not credentials; creating an action does not
install the integration. Set the frontend build environment and rebuild.
`google-ads.env.example` is a reference file, not an automatically loaded env file.

- The event fires when a valid, available LoL or TFT order configuration page
  renders: Rank Boost, Placement Boost, Win Boost, or LoL Pro Duo. An invalid,
  unavailable or failed service page does not count. Legacy service links resolve
  first; measurement sends the canonical public service path, never a service ID.
- There is one dispatch per continuous visit to a service page. Rerenders,
  StrictMode effects, rank/price edits and query/hash changes do not count again.
  Leaving and returning can dispatch a new view; Google applies Count One to
  reporting. No visit history is persisted or backfilled. Checkout, payment
  returns, receipts, accounts, auth pages and wallet funding do not fire this event.
- There is no popup or global privacy button. The tag loads only after the
  visitor explicitly enables the separate unchecked measurement checkbox during
  email/social registration or in the collapsed Account Settings/Privacy Policy
  preferences. Terms acceptance and promotional email consent do not enable it.
  Registration and ordering remain available without opting in. Leaving it
  unchecked causes no reminders or later prompts.
- Permission is browser-local and takes effect immediately. First opt-in can
  measure the current service page; denied or departed visits are never replayed.
  Withdrawal blocks future events and removes first-party `_gcl_` cookies.
- The event contains the public conversion destination, canonical service URL
  and fixed page title. It contains no purchase value, currency, order ID, customer
  details, game credentials, query string or fragment. Enhanced conversions and
  ad personalization are disabled. Global page context is reduced to the origin,
  with only validated Google click IDs retained for attribution after consent.
- The payment verification API remains independent and sends no Ads conversion
  payload. Stripe and wallet payment/receipt behavior is unchanged. Browser keys
  holding old purchase deduplication and checkout attempts are removed on startup.
- Missing consent, blockers or offline browsers can prevent measurement. Late
  opt-in may lose original click attribution: we do not retain advertising IDs
  before consent. A local dispatch does not prove Google received, attributed or
  reported a conversion. Validate receipt separately using Tag Assistant and a
  genuine permitted service page visit; no payment or fake purchase is needed.

Focused automated checks (from `client`):

```sh
node --test test/googleAdsMeasurement.test.js test/paymentVerification.test.js
```
