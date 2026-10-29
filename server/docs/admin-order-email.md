# Admin order email

Every active administrator receives a separate order email when payment first
succeeds. An unpaid checkout draft does not notify administrators. The same
transaction queues messages for verified Stripe payments (including wallet/card
splits), wallet-only payments, and Gold-only payments. A wake after commit starts
delivery immediately; the server worker also checks pending messages every 30
seconds. No historical orders are backfilled.

The email uses the booster assignment email layout, with an admin heading and an
`/admin/orders/:id` action. It includes the order reference, game, service, rank or
quantity details, region, queue, paid status, total and the 70% booster pool. It
never includes game credentials, payment identifiers, customer identity or other
administrators' email addresses. Admin access and suspension are rechecked at
delivery, and the current account email address is used.

## Configuration and deployment

Apply migration `20261029030000_admin_order_email` and regenerate Prisma before
running the updated server. `ADMIN_ORDER_EMAILS_ENABLED=true` enables the channel;
`false` disables it. When unset, it follows `BOOSTER_ORDER_EMAILS_ENABLED=true`,
using the same existing SMTP configuration (`SMTP_HOST`, `SMTP_PORT`,
`SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, optional `SMTP_FROM`) and `CLIENT_URL`.
Production links require a public HTTPS origin. Missing SMTP configuration leaves
pending messages available to the retry worker and does not undo a paid order.

## Delivery guarantees

`AdminOrderEmail` has a unique `(orderId, adminId)` key. Repeated payment callbacks
cannot queue another message for the same administrator/order. The queue is saved
inside the payment transaction, so a failed transaction cannot send an email.
Workers claim each row with a five-minute lease, retry SMTP failures up to eight
times with exponential backoff, and use one stable Message-ID across attempts.
If a process dies after SMTP accepts but before the sent timestamp is saved, SMTP
does not provide an exactly-once guarantee and a retry may be delivered again.
Superseded unpaid/cancelled orders and suspended/former admins are skipped.

Failures record only safe error codes. No email payload or address is logged.
Check `sentAt`, `skippedAt`, `attempts`, `nextAttemptAt` and `lastError` in the outbox
when diagnosing delivery. Tests use synthetic snapshots, a stub transport and a
disposable PostgreSQL database; they never send email.
