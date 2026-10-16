# Payment regression checks

Run `npm test` from `server` for the offline payment, coupon, Gold, webhook and
checkout recovery tests. Run `node --test test/*.test.js` from `client` for
payment verification polling and cancellation tests.

The payment changes prevent a customer from applying the same Gold to multiple
payable drafts: under the existing customer lock, other Gold-backed sessions
must be expired before their allocation is cleared. Completed payments and
unavailable Stripe responses block transfer. Gold-only previews do not transfer
or spend Gold. Coupons remain claimed for their original orders.

Checkout creation verifies Stripe's current session state because idempotent
create responses can refer to a session expired during database rollback.
Recovery uses deterministic keys and at most three attempts per request. If the
chain is exhausted, a separately locked, conditional update saves the last
confirmed-expired session as a checkpoint; a later request can make progress
without overwriting a newer checkout or changing its price, coupon or Gold.

Frontend verification retries the existing payment, and switching order routes
remounts the checkout state. Late responses from the previous order cannot
replace the new order's quote or verification state. Same-order price updates
preserve the card fields.

## Local Stripe test-mode verification

On 2026-10-16, the actual checkout components and payment controller were tested
with real Stripe test-mode sessions, synthetic in-memory orders and mocked
receipt/referral delivery. No application database records, real charges or
emails were created. This verifies the Stripe/frontend integration separately
from the offline database transaction and webhook regression tests.

- A declined card left the order unpaid, Gold unchanged and coupon unused.
- A successful retry paid a $20 order with a $2 coupon, 100 Gold ($10) and $8
  card payment. Refresh left one redemption and one receipt event.
- A test 3D Secure challenge completed a $20 payment.
- A 100-Gold preview left the $10 order unpaid until confirmation; confirmation
  consumed Gold once and showed a zero-cash receipt.
- Switching from a paid order to an unpaid order showed a fresh payment form.

The harness was temporary and used matching test keys with explicit checks for
`livemode === false`. Webhook signatures, duplicate deliveries, rollback/retry,
expiration and account/session isolation are covered by offline tests; an
external Stripe webhook delivery to a deployed endpoint was not tested.

## Deployment consideration

Already-issued overlapping Gold sessions from before this fix can still settle
without another checkout request. The fix prevents new overlaps and repairs
refreshed drafts; it does not revoke existing sessions automatically. Review
pending Gold sessions when deploying. No existing application sessions were
revoked by this work.
