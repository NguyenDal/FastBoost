# Server API Docs (Admin Order Management)

Base URL: `http://localhost:5000/api`

Auth: Send `Authorization: Bearer <JWT>` header. Every protected request resolves the current account; administrative permissions come from its current database role.

## Security release configuration

- Apply the additive `20261017010000_match_chat_sender_rate_index` and
  `20261017020000_shared_request_rate_limits` migrations before deploying this release.
  Production auth/contact throttles use atomic PostgreSQL budgets and fail with 503
  if their storage is unavailable. Development uses bounded process-local budgets.
- Set `NODE_ENV=production` on deployed API instances. Configure `TRUSTED_PROXY_CIDRS`
  with the verified IP addresses/CIDRs of the reverse proxies that directly reach the
  API (comma-separated). The default trusts no forwarded source headers. Do not
  guess proxy ranges or use `true`, a hop count, or a global subnet. Without a correct
  proxy policy, visitors behind a shared proxy share its source budget.
- Set `CLIENT_URL` to the exact HTTPS site origin in production. Checkout and
  wallet return URLs reject missing or invalid configuration and never trust a
  request's arbitrary `Origin` header.
- Existing JWTs without a security stamp require a fresh sign-in after this release.
  Password changes/reset revoke old HTTP, renewal and socket sessions. Transient
  account-store failures return 503; they do not declare a valid session expired.
- Checkout enforces one payable first-purchase referral session under the account
  lock. Existing overlapping sessions issued before this release need a separately
  planned Stripe cleanup; restarting the API alone does not expire them.
- New chat attachments download as inert octet streams. Signed reads also override
  legacy metadata. Previously public raw S3 objects require separate bucket/metadata
  review; changing app code cannot alter those objects or their public access.
- S3 privacy rollout: deploy the updated client artwork and server avatar/chat paths
  before removing the temporary public bucket policy. Confirm LoL/TFT `CleanIcon`,
  email artwork, profile avatars, chat attachments, and order highlights work through
  the site. Then delete the anonymous bucket policy and enable all four bucket Block
  Public Access settings. Raw S3 URLs should return 403; authorized temporary URLs
  should still work. The current live policy permits anonymous reads only of
  legacy artwork under `logos/*`, `services/*`, `roles/*`, and `updates/*`;
  `profiles/*`, chat attachments, and highlights already deny raw public reads.
  Existing live avatars may be broken until the new private-link API is released.
  Full bucket privacy is not yet active.
- The local backend IAM principal has `s3:PutObject` and `s3:GetObject` for
  `profiles/*` and `chat-attachments/*`, plus `s3:PutObject`, `s3:GetObject`,
  and `s3:DeleteObject` for `order-highlights/*`. A disposable upload, signed
  read, anonymous denial, and cleanup were verified after that narrow grant.
  Confirm which IAM identity the deployed backend uses before its release.
- Run `npm ci`, then `npx prisma generate` as part of setup/build after installing
  the aligned Prisma dependencies. `npm run dev` now uses Node's built-in watch mode
  (Node 22+); the production `npm start` command is unchanged.

## Orders (Customer)
- POST `/orders` — create order (auth)
- GET `/orders/my` — list my orders (auth)
- GET `/orders/:id` — get order by id (auth; customer owner or admin)

## Orders (Admin)
- GET `/orders/admin` — list all orders
  - Query: `page`, `pageSize`, `status`, `serviceId`, `q` (search id or customer email)
- GET `/orders/admin/:id` — get detailed order
- PATCH `/orders/:id/status` — update order status

### Assignments (Admin)
- GET `/orders/:id/assignments` — list assigned boosters
- POST `/orders/:id/assign/:boosterId` — assign booster (idempotent)
- DELETE `/orders/:id/assign/:boosterId` — unassign booster

### Users (Admin)
- GET `/user/providers` — list providers for assignment (query `q` to search by email)

### Chat
- GET `/chats/order/:orderId` — get/create conversation for order (auth: customer, assigned provider, or admin)
- GET `/chats/:conversationId/messages` — list messages (auth)
- POST `/chats/:conversationId/messages` — send message (auth)

## Status values
`PENDING` | `IN_PROGRESS` | `COMPLETED` | `CANCELLED`

## Notes
- Assigning a booster auto-upserts a conversation for the order and adds the booster as a participant.
- Conversation participants are auto-upserted when they interact with the thread.
