# FastBoost

A full-stack portfolio project built with **React**, **Vite**, **Express**, **Prisma**, and **PostgreSQL**.

This project is a **game services marketplace demo** where users can register, log in securely, reset passwords by email, browse service types, configure a demo order, continue into a match/chat flow, and manage role-based order communication. It’s being developed as a **software engineering portfolio project** to demonstrate a real full-stack workflow: UI → API → database → auth → secure credential storage → real-time chat.

---

## What’s new (latest progress)

### September 23, 2026 — dashboard cleanup and social sign-in

- **Google and Discord sign-in:** new users choose a username and accept terms. When an eligible verified email matches an existing account, a confirmation offers **Link & sign in** or **Not now**. Nothing links until confirmed; declining returns to login. Existing usernames, profiles, passwords and orders stay intact. Already-linked accounts sign in directly. Provider-verified email ownership can also confirm an existing account whose FastBoost email-verification timestamp is unset; Link & sign in records verification and the link together.
- **Link confirmation UI:** FastBoost/provider logos, a subtle linking animation, matching dark icon tiles, concise account information and separated buttons without a glow. Reduced-motion preferences are respected. General social sign-in errors use a yellow popup; login/register checkboxes use dark styling.
- **Lists and admin pages:** shared numbered pagination shows 10 rows per page across customer orders, provider orders, admin orders and accounts. Headers and redundant counters/copy are trimmed; Management Utilities uses the admin sidebar icons.
- **Dashboard:** My Coupons has 3 coupons per page with empty-state spacing. FAQ is a full account page with search and category filters, a smaller heading and search below the hero. Notifications and messages support individual or clear-all actions, with red delete controls and slide-out/up animations.
- **Coupon and account polish:** personal coupons support multiple recipients, dashboard coupon countdowns and loyalty/referral visuals were refined, and the shared brand wordmark was updated. Contact-email correction was deployed earlier today; receipt delivery remains a separate verification item.

**Verification:** the latest focused authentication suite passes 27 tests, including confirmation, cancellation without writes, origin/ticket validation and account preservation. The redesigned dialog was inspected locally; client build and focused component lint passed before the final copy/color-only edits. Earlier feature checks remain documented below; no fresh full-suite run is claimed.

**Deployment status:** the user configured Discord in Render and registered local and production callbacks. Public production checks confirmed both providers enabled and the correct Discord redirect for the www.fastboost.gg origin. The linking-confirmation/UI work was committed and the production confirmation endpoint is reachable. A follow-up backend correction for existing accounts without a FastBoost email-verification timestamp is local and awaits deployment; full live production sign-in remains unverified. Production migration status must be checked before deploying features that require newer coupon/footer schema.

## Earlier implementation notes

These dated notes retain implementation details and historical verification. Today's summary above supersedes conflicting older authentication, UI and deployment statements. Open issues in these notes are not marked complete merely because they are historical.

#### Dashboard layout and account details

- Wide desktop layout now places cards in three rows:
  1. New Notifications, New Messages, Wallet
  2. Loyalty Rewards Status, Refer a Friend, My Orders
  3. Account Overview, Quick Actions, Platform Status
- Existing dashboard card styling is preserved, with responsive two-column and
  single-column layouts for smaller screens.
- My Orders shows the latest three orders, keeps the **Pending** label, and uses
  the S3 assets `logos/lol-logo.jpg` and `logos/tft-logo.png`.
- Account Overview reads live profile data and shows membership age instead of
  Discord, plus country with its flag and the saved birthday.
- Profile settings now provide a country dropdown with a flag preview. Birthday
  display avoids timezone shifts; server validation rejects invalid/future dates.
- Main additions: `client/src/components/DashboardOverview.jsx` and
  `client/src/utils/countries.js`.

#### Notifications and order status

- Each dashboard activity card keeps its latest three entries, including read
  entries. Purple dots indicate unread items; reading does not remove an entry.
- Dashboard queries fetch the two categories independently through
  `GET /api/notifications?view=dashboard`, with periodic and focus refreshes.
- Message rows use the sender's current profile picture when available and fall
  back to initials when a picture is missing or fails to load.
- Unread conversation previews update to the newest message. View all opens the
  existing notification/message panel.
- Order completion and cancellation create customer notifications with checkmark
  and X icons. Retrying the operation preserves existing notification read state.
- Order detail chat displays a centered completion/cancellation notice in the
  same style as the order-placed message. This notice is derived from the order
  when loading the page, rather than stored as a separate chat message.

#### Referral benefits and loyalty

- **10% off the first purchase belongs to the referred friend.** Only that friend
  receives the first-purchase discount notification; sending an invitation alone
  does not qualify the inviter for it.
- After the friend's first qualifying order of at least **$50 before the referral
  discount** is paid and completed, **both people receive 50 gold ($5)** toward a
  future purchase and each receives a reward notification.
- Reward records and both notices are written together, with duplicate-safe IDs
  and preserved read state on retry.
- Loyalty benefits use compact gold amounts/icons and cash-back wording. Current
  tiers are:

| Tier | Completed spend | Tier gold bonus | Displayed cash back |
| --- | ---: | ---: | ---: |
| Bronze | $0 | — | — |
| Silver | $200 | +200 | 3% |
| Gold | $500 | +500 | 5% |
| Platinum | $1,000 | +1,000 | 10% |
| Diamond | $1,500 | +1,500 | 15% |

- The full tier breakdown remains on the Loyalty page. Dashboard loyalty is a
  compact rank/progress card with the spend-to-next-tier message.
- Removed View My Orders from Loyalty. Reward history shows at most five page
  buttons, merges already-sorted sources linearly, and reuses the existing order
  count. Database retrieval still grows with page depth.

#### Current implementation limits

- Wallet cash balance remains a **$0.00 placeholder** and Top Up is disabled.
  Gold balance is connected; Redeem Gold leads to service selection for checkout.
  Cash-back labels do not yet implement wallet funding or cash-back settlement.
- Platform Status explicitly marks order processing, Stripe, and chat as
  **Not monitored**; external health monitoring is not connected.
- Latest verification: client production build, targeted dashboard lint, server
  syntax check, and all six server tests passed. Browser visual and full referral
  end-to-end checks remain separate from these automated checks.

#### Database changes and local continuity

- Added forward migrations `20260922040000_dashboard_notifications` and
  `20260922050000_referral_reward_notifications`; regenerated the tracked Prisma
  client. These were applied and recorded on the configured Prisma-hosted database.
  Other environments must apply their forward migrations through the normal
  deployment process; this session did not deploy to Render or push to GitHub.
- Private session context uses one `.agent-handoff/HANDOFF_YYYY-MM-DD.md` per
  local calendar day (America/Winnipeg). Keep one **Latest update** at the top;
  move its previous entry into **Done** below (newest first) before replacing it.
  Keep current constraints and unresolved gaps up to date. Reuse the same daily
  file; do not append new updates at the bottom or create numbered/time duplicates.
  `.agent-handoff/HANDOFF.md` is only the index pointing to the latest daily file.
  A local root `AGENTS.md` records this workflow. These files are gitignored and
  are not part of a clone or production deployment. Keep credentials out of notes.

---

#### Production pricing update
- Real service price rules are maintained through:
  - `server/prisma/seedPriceRules.js`
- The pricing seed remains idempotent through `prisma.servicePriceRule.upsert(...)`.
- Current pricing direction verified in this session:
  - LoL Iron and Bronze Net Win base price: **$3 per win**
  - Placement pricing uses a **5-game full-set price** and prorates when fewer than 5 games are selected
  - Pro Duo base price remains **75% of the corresponding LoL Net Win / Win Boost price**
  - Pro Duo keeps the existing LP-gain modifiers instead of using a flat 75% without modifiers
  - Existing rank/division, placement, win-boost, TFT, LP-progress, LP-gain, and add-on structures remain in the price-rule config
- Local pricing checks were completed before pushing the pricing changes.
- Do not use `prisma migrate reset` for price changes. Pricing updates are data/config updates, not destructive schema resets.

#### Production admin account bootstrap
- The first production account was promoted from `CUSTOMER` to `ADMIN` directly in the Render production PostgreSQL database.
- Render Shell was unavailable on the free service tier, so the production database was accessed from the local FastBoost backend using Render's **External Database URL**.
- No separate `psql` installation was required; the existing Node + Prisma backend was used.
- The local Prisma client is configured through:
  - `server/src/prisma.js`
  - `@prisma/adapter-pg`
- External Render PostgreSQL access required SSL. A connection that did not include SSL produced Prisma `P1017: Server has closed the connection`.
- For temporary local access, append `sslmode=require` to the external database connection string before running Prisma reads/updates.
- Keep the production database URL temporary in the shell only. Do not paste it into source code or commit it.

#### Production admin authorization issue and resolution
- After the database role was changed to `ADMIN`, the frontend user object refreshed and showed:
  - `user.role = ADMIN`
- However, the already-issued JWT still contained:
  - `role = CUSTOMER`
- Backend admin middleware correctly rejected protected admin API calls with:
  - `Access denied, admin only`
- This was a **stale JWT**, not an AdminOrders/AdminAccounts page bug.
- Logging out and logging back in issued a fresh JWT containing `role = ADMIN`.
- Production admin pages then worked normally.
- Important future rule: after changing a user's role, that user must refresh/re-authenticate before JWT-based authorization reflects the new role.

#### Browser tab/title UX direction
- `client/index.html` still needs to use `FastBoost` as the fallback `<title>` instead of the Vite default `client` if that change has not already been committed.
- Dynamic document-title direction:
  - Home → `FastBoost`
  - Sign In → `Sign In | FastBoost`
  - Register → `Create Account | FastBoost`
  - Dashboard → `Dashboard | FastBoost`
  - Admin pages → page-specific admin titles
  - Order pages → service-specific titles such as `Rank Boost | FastBoost`
- Because FastBoost uses React Router SPA navigation, the browser's native tab loading throbber is not guaranteed to appear for client-side route/API activity.
- Do not force full page reloads just to trigger the browser-native spinner.
- A custom loading favicon can be considered later if desired, but it should only represent real pending requests.

#### Production database safety
- The Render production database is `fastboost-db`.
- The free Render PostgreSQL instance previously showed an expiration date of **August 14, 2026**.
- Upgrade/retain the production database before that deadline if the free-instance expiration warning is still active.
- Never run destructive commands such as `prisma migrate reset` against production.
- For production schema changes, prefer committed migrations and `prisma migrate deploy`.

---



#### Full `/updates` page direction
- Added/directed a public `/updates` page for FastBoost news and platform announcements.
- Added route direction in `client/src/App.jsx`:
  - `import UpdatesPage from "./pages/UpdatesPage";`
  - `<Route path="/updates" element={<UpdatesPage />} />`
- Added/directed reusable news components and data structure:
  - `client/src/pages/UpdatesPage.jsx`
  - `client/src/components/news/NewsModal.jsx`
  - `client/src/components/news/NewsModalTemplates.jsx`
  - `client/src/data/newsData.js`
  - `client/src/styles/News.css`

#### Updates page intended structure
- Target layout is based on the provided demo mockup:
  - compact hero on the upper-left with `Latest News`, `FastBoost Updates`, intro text, and a cyberpunk megaphone asset
  - category/filter row below the hero
  - left column with the paginated news list
  - right column with `News Detail Page Templates` and a 2x2 grid of larger preview cards
- Admin News Management section is intentionally postponed. Do **not** work on admin news UI/backend yet.
- Category direction was reduced to four public categories plus All News:
  - `All News`
  - `Events`
  - `Updates`
  - `Announcements`
  - `Maintenance`

#### News modal direction
- `NewsModal.jsx` was moved into `client/src/components/news/NewsModal.jsx`.
- `UpdatesPage.jsx` should import it with:
  - `import NewsModal from "../components/news/NewsModal";`
- `NewsModalTemplates.jsx` should be used only inside `NewsModal.jsx`.
- The modal supports origin-based zoom behavior:
  - open from clicked card position
  - close back toward clicked card position
- Important bug fixes already discovered:
  - Do not define a second `function NewsModal(...)` inside `UpdatesPage.jsx` if importing `NewsModal`; that causes `Identifier 'NewsModal' has already been declared`.
  - Do not import `NewsModalTemplates` from `./NewsModalTemplates` inside `UpdatesPage.jsx`; the correct path from the page is `../components/news/NewsModalTemplates`, but the better structure is to let `NewsModal.jsx` import it.
  - `NewsModalTemplates` needs a null guard: `if (!post) return null;`
  - `post.modalTemplate || "event"` should be used as a fallback.

#### Megaphone / CleanIcon direction
- The Updates hero uses a megaphone image from S3:
  - `https://fastboost-assets.s3.amazonaws.com/services/updates-megaphone.png`
- `CleanIcon` was imported into `UpdatesPage.jsx` for the hero asset:
  - `import CleanIcon from "../components/CleanIcon";`
- Current rendered usage direction:
  - `<CleanIcon src={UPDATES_HERO_IMAGE} alt="FastBoost updates" className="updates-hero-image" />`
- The transparent/particle cleanup was difficult because some white particles/glow are part of the generated image pixels, not a removable checkerboard background.
- Current visual preference from testing:
  - use a dark/black-edged transparent megaphone
  - avoid strong glow around the whole horn because it causes transparency detachment
  - allow only a very subtle shadow/glow if needed

#### Current problem / unresolved state
- The `/updates` page is not finalized.
- Main issue: `News.css` accumulated too many repeated override blocks for the same selectors, especially:
  - `.updates-page`
  - `.updates-hero`
  - `.updates-hero-art`
  - `.updates-hero-image`
  - `.updates-layout`
  - `.updates-toolbar`
  - `.updates-side-column`
  - `.updates-recent-grid`
  - `.updates-recent-card`
- Because of those repeated overrides, changes became unpredictable and the layout drifted away from the demo.
- Recommended next step is **not** more patching. The next session should clean `News.css` by removing duplicated override sections and keeping one final layout source of truth.

#### Related files changed/directed
- Frontend:
  - `client/src/App.jsx`
  - `client/src/pages/UpdatesPage.jsx`
  - `client/src/components/news/NewsModal.jsx`
  - `client/src/components/news/NewsModalTemplates.jsx`
  - `client/src/data/newsData.js`
  - `client/src/styles/News.css`
  - `client/src/components/CleanIcon.jsx`

#### Previous latest work retained
- Homepage Latest News preview and opening news modal planning remain active.
- MatchPage chat attachment upload, S3 permissions, and Messenger-style chat UI remain active.
- Global skeleton loading system remains active through:
  - `client/src/components/Skeleton.jsx`
  - `client/src/components/PageSkeletons.jsx`
  - `client/src/styles/Skeleton.css`
- Dashboard, OrderPage, and MatchPage loading states already use the shared Facebook-style global skeleton effect.
- Contact page is now webform-only and retains the animated mail/check success popup.

---
## Project concept

Planned roles:
- **Customer**
- **Provider**
- **Admin**

Core entities:
- **User**
- **Profile**
- **Service**
- **Order**
- **PasswordResetToken**
- **RewardHistory**

Chat-related entities:
- **OrderAssignment** (order ←→ provider linkage)
- **Conversation** (per-order thread)
- **ConversationParticipant** (conversation membership)
- **Message** (chat line items)
- **Notification** (system/chat notifications)

### Current service types
- Rank Boost / Division
- Placement Boost / Placements
- Win Boost / Ranked Wins
- Pro Duo
- TFT Rank Boost
- TFT Win Boost
- TFT Placement Boost / Placement Games

### Important design decisions
A **Service** is a **platform-wide service category**, not a user-owned listing.
- Service has no fixed price
- Service has no `ownerId`
- Pricing and request details live on the **Order**

Password/security decisions:
- User account passwords use bcrypt hashing.
- Reset tokens are hashed and one-time use.
- Customer game account passwords use AWS KMS envelope encryption because they must be viewable by authorized order participants.
- Game account plaintext passwords should never be stored in PostgreSQL.

---

## Tech Stack

### Frontend
- React
- Vite
- React Router
- Socket.IO client

### Backend
- Node.js
- Express
- Socket.IO

### Database / ORM
- PostgreSQL
- Prisma 7

### Auth
- bcrypt
- JWT

### Payments
- Stripe Checkout
- Stripe Webhooks
- Stripe CLI for local webhook forwarding

### Email / Reviews
- Nodemailer
- Gmail SMTP App Password
- Trustpilot Automatic Feedback Service (AFS)

### Assets and security services
- AWS S3 for public website/rank assets and uploaded profile pictures
- AWS KMS for encrypted order login credentials
- AWS IAM for local development KMS access

---

## Project Structure

```text
gaming-services-platform/
  client/
  server/
  README.md
```

## Frontend styling structure

The frontend styles are split so shared rules are separated from page-specific rules.

- [client/src/main.jsx](client/src/main.jsx) imports the shared CSS entry files.
- [client/src/styles/Global.css](client/src/styles/Global.css) contains global defaults, base element styling, and reusable keyframes.
- [client/src/styles/Shared.css](client/src/styles/Shared.css) contains shared layout utilities, section headers, buttons, tags, and common card/button helpers.
- [client/src/styles/Navbar.css](client/src/styles/Navbar.css) contains the top navigation, brand area, profile menu, quick tiles, side panels, and notification/message drawer styles.
- [client/src/styles/Auth.css](client/src/styles/Auth.css) contains auth modal layouts, form controls, success/error states, and password-reset flows.
- [client/src/styles/Layout.css](client/src/styles/Layout.css) contains shell layouts such as order page containers and the session-expired modal.
- [client/src/styles/Skeleton.css](client/src/styles/Skeleton.css) contains the shared global Facebook-style skeleton shimmer effect used by Dashboard, OrderPage, MatchPage, and future loading states.
- [client/src/components/Skeleton.jsx](client/src/components/Skeleton.jsx) contains reusable skeleton primitives such as `Skeleton`, `SkeletonCircle`, `SkeletonCard`, `SkeletonButton`, and `SkeletonField`.
- [client/src/components/PageSkeletons.jsx](client/src/components/PageSkeletons.jsx) contains shared page-level skeleton layouts such as `TwoColumnPageSkeleton`.
- Page-specific styles remain in files such as [client/src/styles/HomePage.css](client/src/styles/HomePage.css), [client/src/styles/Dashboard.css](client/src/styles/Dashboard.css), [client/src/styles/OrderPage.css](client/src/styles/OrderPage.css), [client/src/styles/MatchPage.css](client/src/styles/MatchPage.css), and [client/src/styles/ContactPage.css](client/src/styles/ContactPage.css).

---

## How to run the project (local)

### Backend
```bash
cd server
npm install
npm run dev
```

Health check:
```text
http://localhost:5000/api/health
```

### Frontend
```bash
cd client
npm install
npm run dev
```

Frontend URL:
```text
http://localhost:5173/
```

### Stripe local payment testing
Checkout now stays on FastBoost at `/checkout/:orderId`, using Stripe's
Checkout Sessions API (`ui_mode: elements`) with separate secure Stripe card
number, expiry, and CVC Elements plus Express Checkout Element. Card details
stay in Stripe's iframes; only a Stripe PaymentMethod ID is passed to session
confirmation. Cardholder name and country are sent as billing details. The pay
button displays Stripe's current total as required by its confirmation API.
The bulky inline Link signup is replaced by a compact prompt to use Link express
checkout. The responsive summary lists base price, add-ons, sale,
referral, and gold discounts before the final server-calculated total. Eligible
wallet buttons are supplied by Stripe. Bank authentication can still require a
redirect; ordinary card checkout no longer opens Stripe's hosted payment page.

Set `STRIPE_PUBLISHABLE_KEY=pk_test_...` in `client/.env` and the matching
`STRIPE_SECRET_KEY=sk_test_...` in `server/.env`, then restart both dev servers.
Only the publishable key belongs in frontend configuration. Production also
needs the matching frontend build variable, Link enabled in Stripe payment
method settings, and an HTTPS domain registered with Stripe for Apple Pay.
On Render, add `STRIPE_PUBLISHABLE_KEY` to the **frontend static site's**
Environment settings, then rebuild/redeploy that site. Adding it only to the
backend or local `.env` does not update deployed JavaScript. Vite embeds this
value at build time; builds fail if it is missing or not a publishable key.
Only the resolved publishable key is exposed; Stripe secret keys stay server-side.
The current test account reports Link inactive for live mode and the localhost
domain unregistered for Apple Pay.

Stripe consumer terms and privacy links are displayed in the security card.
FastBoost Terms and Conditions are linked below card and gold payment buttons at
`/terms-and-conditions`. `VITE_TERMS_URL` is no longer used. The imported document
still carries its supplied review-draft label and unset effective date.

Checkout session creation enforces order ownership and rejects cancelled orders.
Refreshing reuses an open session when its amount and gold redemption match;
changing those values expires the previous open session. Payment fulfillment
still requires Stripe webhook or authenticated server-to-server reconciliation.
Gold redemption is selected on the payment page with available balance, Max,
and Apply controls; the order configurator shows Subtotal and a purple Buy Boost
button. Applying gold refreshes the Stripe payment form and recalculates the
server-authoritative amount. Fully covered orders show an explicit Pay with gold
button: previewing a zero-cash checkout never spends gold. The session endpoint
accepts `deferGoldOnly: true` for this preview; final confirmation uses `false`.

References: [Stripe Elements with Checkout Sessions](https://docs.stripe.com/payments/quickstart?client=react)
and [Embedded Checkout](https://docs.stripe.com/checkout/embedded/quickstart?client=react).

Stripe webhooks require a separate local forwarding process during development.

1. Start the backend:
```bash
cd server
npm run dev
```

2. In a separate terminal, start Stripe webhook forwarding:
```bash
stripe listen --forward-to localhost:5000/api/payments/webhook
```

3. Copy the `whsec_...` webhook signing secret shown by Stripe CLI into `server/.env`:
```env
STRIPE_WEBHOOK_SECRET="whsec_your_local_webhook_secret"
```

4. Restart the backend after changing `.env`.

5. Use Stripe test card data in Checkout:
```text
Card: 4242 4242 4242 4242
Expiry: any future date, for example 12/34
CVC: any 3 digits
Postal/postal code: any valid-looking code, for example R3C 0A1
```

Expected successful webhook result in Prisma Studio:
```text
paymentStatus = PAID
paidAt = filled
stripePaymentIntentId = pi_...
stripeCheckoutSessionId = cs_test_...
```

Important:
- Keep the Stripe CLI terminal running while testing webhook fulfillment.
- Do not commit Stripe keys or webhook secrets.
- Do not trust `/payment/success` alone. The webhook is the primary fulfillment path, and the authenticated verification endpoint may reconcile a pending order only after retrieving the Checkout Session from Stripe server-to-server.


### Live chat quick test
Socket server runs on the same port (`:5000`). Connect with JWT token:
```js
import { io } from "socket.io-client";
const token = localStorage.getItem("token");
const socket = io("http://localhost:5000", { auth: { token } });
socket.emit("chat:join", { orderId: "<order-id>" }, (res) => console.log(res));
socket.on("chat:message", (m) => console.log("msg", m));
```

---

## API routes (current)

### Public
- `GET /api/health`
- `GET /api/services`
- `GET /api/services/:id`
- `POST /api/pricing/quote` — public/current server-calculated price quote using active `ServicePriceRule` data and sale precedence
- `GET /api/referrals/public/:referralCode` — public inviter preview for private invite registration

### Auth
- `POST /api/auth/register` — supports optional `referralCode` for private invite registration
- `POST /api/auth/login`
- `POST /api/auth/forgot-password`
- `POST /api/auth/reset-password`

### User / profile
- `GET /api/user/me` — current authenticated user with profile data
- `PATCH /api/user/me` — update username, email, saved profile image URL, Discord, country, and birthday
- `PATCH /api/user/me/password` — change authenticated user's password
- `POST /api/user/me/email-verification/send` — send a 6-digit email verification code
- `POST /api/user/me/email-verification/confirm` — confirm the email verification code and mark email verified
- `POST /api/user/me/profile-picture` — upload profile picture to S3 and save `Profile.profileImageUrl`
- `GET /api/user/providers` — admin-only provider list for assignment

### Orders
- `POST /api/orders` — create order
- `GET /api/orders/my` — customer order list; customer-facing list shows paid orders only
- `GET /api/orders/:id` — order detail with access control
- `DELETE /api/orders/unpaid-checkout/:id` — customer cleanup endpoint for unpaid cancelled Stripe checkout attempts
- `PATCH /api/orders/:id/login-info` — customer updates in-game name/password from MatchPage

### Payments
- `POST /api/payments/create-checkout-session` — create a Stripe Checkout Session for an authenticated customer order, with optional gold redemption
- `GET /api/payments/verify-checkout-session` — verify Stripe Checkout/order payment status after success redirect before navigating to MatchPage
- `POST /api/payments/webhook` — Stripe webhook endpoint for payment fulfillment; must use raw request body before `express.json()`

### Admin orders
- `GET /api/orders/admin` — list admin orders with filters; hides unpaid checkout attempts by default unless `includeUnpaidCheckout=true`
- `GET /api/orders/admin/:id` — admin order detail
- `PATCH /api/orders/admin/:id/status` — admin status update/override
- `GET /api/orders/:id/assignments` — list assigned boosters
- `POST /api/orders/:id/assign/:boosterId` — manual assign fallback
- `DELETE /api/orders/:id/assign/:boosterId` — admin unassign booster

### Admin account management
- `GET /api/admin/users?page=1&pageSize=20&q=<search>&role=<role>` — admin-only user list/search for Account Management
- `PATCH /api/admin/users/:userId/role` — admin-only privilege update for Customer / Provider-Booster / Admin
- `PATCH /api/admin/users/:userId/suspension` — admin-only suspend/restore account status update

### Admin price management
- `GET /api/admin/prices` — admin-only detailed `ServicePriceRule` list, sale metadata, current `globalSale`, and general/personal coupons
- `POST /api/admin/prices/sales` — create a `SERVICE` or `GLOBAL` sale/coupon; personal coupons require `personalCoupon: true`, an existing `recipientEmail`, and `personalReason` (`MANUAL` or `NEGOTIATED`)
- `PATCH /api/admin/prices/sales/:id/disable` — disable/end an existing service or global sale
- `PATCH /api/admin/prices/rules/:id` — update validated pricing config from the admin website
- `PATCH /api/admin/prices/rules/:id/availability` — set boolean `active` for every pricing rule belonging to the selected service

### Provider / booster orders
- `GET /api/orders/provider/assigned` — provider assigned order list
- `PATCH /api/orders/:id/provider-complete` — provider marks assigned order completed
- `DELETE /api/orders/:id/provider-leave` — provider leaves/unassigns self from order

### Loyalty
- `GET /api/loyalty/me?rewardPage=1&rewardLimit=5` — current user loyalty summary, referral eligibility, tier benefits, and paginated Reward History

### Assignment requests
- `POST /api/assignment-requests/orders/:orderId/boosters/:boosterId` — admin creates booster invite/request
- `GET /api/assignment-requests/orders/:orderId` — admin lists requests for an order
- `PATCH /api/assignment-requests/:requestId/cancel` — admin cancels/revokes pending invite
- `PATCH /api/assignment-requests/:requestId/accept` — booster accepts invite
- `PATCH /api/assignment-requests/:requestId/decline` — booster declines invite

### Notifications
- `GET /api/notifications` — list active notifications for current user
- `PATCH /api/notifications/:id/read` — mark a notification as read
- `PATCH /api/notifications/read-all` — mark non-chat notifications as read
- `PATCH /api/notifications/messages/read-all` — mark chat/message notifications as read

### Chat
- `GET /api/chats/orders/:orderId` — ensure/get conversation for an order; returns participants
- `GET /api/chats/conversations/:conversationId/messages?limit=20&cursor=<id>` — paginated history
- `POST /api/chats/conversations/:conversationId/messages` — post a message through REST fallback
- `POST /api/chats/conversations/:conversationId/attachments` — upload a chat attachment and create an attachment message
- `GET /api/chats/messages/:messageId/attachment` — verify access and return a temporary signed S3 URL for opening the attachment

---

## Environment variables

Create `server/.env`:

```env
DATABASE_URL="your_database_connection_string"
JWT_SECRET="your_secret_here"

APP_BASE_URL="http://localhost:5173"

STRIPE_SECRET_KEY="sk_test_or_live_key_here"
STRIPE_CURRENCY="cad"
STRIPE_WEBHOOK_SECRET="whsec_local_or_live_webhook_secret"
CLIENT_URL="http://localhost:5173"

SMTP_HOST="smtp.gmail.com"
SMTP_PORT="587"
SMTP_SECURE="false"
SMTP_USER="your_email_here"
SMTP_PASS="your_google_app_password"
SMTP_FROM="FastBoost <your_email_here>"
ORDER_CONFIRMATION_EMAILS_ENABLED="false"

TRUSTPILOT_AFS_EMAIL="fastboost.gg+your_code@invite.trustpilot.com"

AWS_REGION="ca-central-1"
ORDER_PASSWORD_KMS_KEY_ID="alias/fastboost-order-passwords"
AWS_S3_ASSETS_BUCKET="fastboost-assets"

# Local development only.
# In deployment, prefer IAM role instead of long-lived keys.
AWS_ACCESS_KEY_ID="your_local_dev_access_key"
AWS_SECRET_ACCESS_KEY="your_local_dev_secret_key"
```

For deployment, set `CLIENT_URL` to the public client origin, for example
`https://app.example.com`. A localhost value is accepted only when the checkout
request originates from localhost.

### Contact email delivery checks

- The contact endpoint waits for SMTP acceptance of `support@fastboost.gg` before
  returning `200` with `status: "sent"`. SMTP failures return `503`; the form keeps
  the entered message and provides the direct support email. This confirms server
  acceptance, not guaranteed inbox delivery. Failed contact requests are not retried automatically.
- The client rejects the older `202` response, which previously appeared successful
  even when SMTP failed. Deploy the API correction before or alongside the client.
- From the `server` directory, run `npm run email:verify` in the environment being
  diagnosed. It uses the contact transport configuration to check SMTP connection,
  TLS and authentication without sending mail, printing credentials, or changing data.
  It exits unsuccessfully on configuration/network/authentication failure or after
  30 seconds. A local pass does not establish connectivity from Render.
- A September 16 message's headers confirm a successful Render-to-Gmail SMTP send.
  September 23 Render logs instead show connection timeout/network errors before
  authentication. Historical logs expired, so the precise change is unconfirmed.
  Render currently documents blocked SMTP ports on Free instances. Correct success
  reporting cannot remove a hosting network restriction.

FastBoost order confirmation emails:
- Reuses `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, and `SMTP_FROM`.
- Production settings are separate from `server/.env`. Render Free blocks outbound
  SMTP ports 25, 465 and 587, including the Gmail configuration above. Use a paid
  instance with SMTP access or implement an HTTPS email provider before enabling
  delivery. [Render Free limitations](https://render.com/docs/free).
- Apply `server/prisma/migrations/20260922200000_order_confirmation_emails/migration.sql`
  before setting `ORDER_CONFIRMATION_EMAILS_ENABLED=true`, then restart the backend.
  Apply this migration alone if unrelated migrations are pending; do not blindly deploy all pending migrations.
- Set `CLIENT_URL` to the public HTTPS frontend origin in production. Email links use this
  trusted configuration, not request headers. Localhost is permitted only outside production.
- Paid card/wallet confirmations use Stripe's verified Checkout Session contact email;
  gold-only confirmations use the validated email entered in checkout. Account email is unchanged.
- The payment transaction queues one immutable confirmation per order. The backend worker
  checks every 30 seconds and retries delivery up to eight times. No historical orders are emailed.
  Inspect `OrderConfirmationEmail` for `sentAt`, `attempts`, `lastError`, and `nextAttemptAt`.
  `sentAt` records acceptance by the SMTP server, not delivery to the customer's inbox.
  Diagnose against the affected deployment's database; a local queue can be unrelated.
  After fixing delivery configuration, an operator can reset attempts and nextAttemptAt for
  unsent rows only. SMTP cannot guarantee exactly-once delivery after ambiguous network failure;
  the unique queue row and stable Message-ID prevent ordinary webhook/revisit duplicates.
- Keep Stripe's successful-payment receipts enabled for cash charges. FastBoost confirmations
  include both gold redeemed and cash paid; gold-only orders do not create a Stripe receipt.
- SMTP failure does not reverse payment. The database queue must be available whenever the
  feature is enabled. Turning the flag off disables both new queue entries and the worker.

Chat attachment S3 permission note:
- The backend IAM user/role needs `s3:PutObject` and `s3:GetObject` on:
  - `arn:aws:s3:::fastboost-assets/profiles/*`
  - `arn:aws:s3:::fastboost-assets/chat-attachments/*`
- Chat attachment viewing uses temporary signed S3 URLs generated by the backend.

✅ Do **not** commit `.env` to GitHub.

Stripe production note:
- Use `sk_test_...` only for sandbox/local testing.
- Use `sk_live_...` only after Stripe live account verification is complete.
- Configure a live webhook endpoint in Stripe Dashboard for production deployments.
- The local `whsec_...` from `stripe listen` is only for local testing and changes when a new listen session is created.
- Keep the webhook as the primary payment fulfillment path. Redirect-time reconciliation must verify the session with Stripe on the backend and must never trust frontend query parameters alone.

Production note:
- Keep `AWS_REGION` and `ORDER_PASSWORD_KMS_KEY_ID`.
- Prefer IAM role credentials for deployed backend.
- Restrict KMS permissions to the exact key ARN before real launch.

---

## Payment implementation notes

### Stripe files and route structure
Backend files/direction:
```text
server/src/utils/stripeClient.js
server/src/controllers/paymentController.js
server/src/routes/paymentRoutes.js
server/src/app.js
```

Important route mounting direction in `app.js`:
```js
app.use(cors());

app.post(
  "/api/payments/webhook",
  express.raw({ type: "application/json" }),
  handleStripeWebhook
);

app.use(express.json());
```

The webhook route must stay above `express.json()` or Stripe signature verification will fail.

### Local Stripe CLI workflow
```bash
stripe login
stripe listen --forward-to localhost:5000/api/payments/webhook
```

When `stripe listen` starts, copy the shown `whsec_...` value into `server/.env`, then restart the backend.

### Payment safety rules
- The frontend success URL is not proof of payment.
- The database should only mark an order as `PAID` after a signed Stripe webhook or an authenticated server-to-server Checkout Session retrieval confirms payment.
- Gold should only be permanently spent after payment succeeds.
- Backend must always validate `orderId`, customer ownership, payment status, amount, and gold use.
- Do not expose `STRIPE_SECRET_KEY` or `STRIPE_WEBHOOK_SECRET` to the frontend.
- Customer and admin order lists should hide unpaid checkout attempts by default.
- Cancelled unpaid checkout attempts are deleted through `DELETE /api/orders/unpaid-checkout/:id`.
- Abandoned unpaid checkout attempts older than 24 hours are cleaned automatically by the backend cleanup utility.

### Gold redemption rule
```text
1 gold = $0.10
```
Gold redemption should support any whole-number amount of gold.

## Database / Prisma

### Open Prisma Studio
```bash
cd server
npx prisma studio
```

### Prisma commands

Option A — Local development with migrations:
```bash
npx prisma migrate dev --name your_migration_name --schema=prisma/schema.prisma
npx prisma generate --schema=prisma/schema.prisma
```

Option B — Remote/shared database while still prototyping:
```bash
npx prisma db push --schema=prisma/schema.prisma
npx prisma generate --schema=prisma/schema.prisma
```

Note: For production/remote DBs with existing data, prefer planned migrations. Use `db push` only if you understand the implications and have backups.


### Deploy schema changes to Render production

Use this procedure whenever `server/prisma/schema.prisma` changes.

#### 1. Create the migration against the development database
From `server/`:

```bash
npx prisma migrate status
```

Confirm the datasource is the development/shared database and **not** the Render production host. If the shell was temporarily pointed at Render earlier, unset that override first.

Then create and generate:

```bash
npx prisma migrate dev --name your_migration_name
npx prisma generate
```

Verify a new folder exists:

```bash
ls -1 prisma/migrations
```

Inspect the generated SQL before deployment:

```bash
cat prisma/migrations/<new_migration>/migration.sql
```

#### 2. Commit the schema and migration together

From the repository root:

```bash
git status
git add server/prisma/schema.prisma
git add server/prisma/migrations/<new_migration>
git add <related backend/frontend files>
git commit -m "Describe the schema feature"
git push origin main
```

Do **not** push a schema change without its forward migration.

#### 3. Let Render apply the production migration

The backend Render service is configured with:

```text
Build Command: npm install && npx prisma generate
Start Command: npx prisma migrate deploy && npm start
```

After the push to `main`, Render deploys the backend and runs:

```bash
npx prisma migrate deploy
```

against the production `DATABASE_URL`.

The deployment log should show the new migration being applied, followed by the server starting normally.

For the current global-sale schema update, the expected migration is:

```text
20260822205028_add_global_sale_scope
```

and its SQL creates `SaleScope`, adds `ServiceSale.scope`, and makes `ServiceSale.serviceId` nullable.

#### 4. Verify production

After Render finishes:
- confirm the backend starts without Prisma errors
- open Price Management
- verify `GET /api/admin/prices` succeeds
- test the new schema-dependent feature
- confirm the OrderPage quote and real order creation agree on pricing

If Render reports `P3009`, `P3018`, drift, or another migration error, **do not** immediately use `migrate resolve`, recreate the baseline, or run destructive recovery commands. Inspect the production state and migration SQL first.

#### Schema migration vs data seed

A migration changes database **structure**. It does not automatically populate price-rule data.

If an empty/new Render database needs services or price rules:
- services must exist first
- `server/prisma/seedServices.sql` is the service initialization seed
- `server/prisma/seedPriceRules.js` is the idempotent price-rule seed

When manually running a seed against Render from a local terminal, use the Render **External Database URL** temporarily, include the required SSL mode, run the seed, verify the result, then unset the production `DATABASE_URL` override or close the terminal.

Never commit the Render database URL or credentials.



### Current production migration baseline
- Active migration history starts from `prisma/migrations/0_init`.
- The four previous migration folders remain under `prisma/legacy_migrations_backup` for historical reference.
- The next forward migration is:
  - `20260822205028_add_global_sale_scope`
- Normal Render startup remains:
```bash
npx prisma migrate deploy && npm start
```
- Once the new migration is committed and pushed to `main`, Render should apply it automatically during backend startup.
- Price changes inside `ServicePriceRule.config` are data updates and do not require schema migrations.
- Schema changes **do** require a committed forward migration.
- Do not run `prisma migrate reset` against production.
- Do not use `prisma db push` as the normal production deployment path.

### View database
```bash
npx prisma studio
```

---

## Current progress summary

### Done

- gold redemption requires at least 100 gold in the current balance, enforced in checkout and on the server; eligible users may redeem a smaller amount
- existing order redemption caps and Stripe minimum cash rules preserved
- personal coupons support all services, a single service, or multiple services through an overlay checkbox selector
- admin customer search matches username, display name and email, with debounced results, avatars and account-ID selection
- My Coupons dashboard displays copyable codes, service eligibility, dates and coupon status; personal codes stay private and are excluded from public footers
- multi-service coupons remain one campaign with one use per account across eligible services
- personal-coupon service migration applied locally with Prisma regenerated; production migration and matching deployment still require verification
- loyalty tier bonuses reconcile on order completion, status changes and loyalty reads, with per-user locking and unique keys preventing duplicates
- paid completed spend unlocks cumulative Silver +200, Gold +500, Platinum +1000 and Diamond +1500 rewards; unpaid orders are excluded
- gold history displays negative redemptions correctly; checkout uses a grey underlined Remove coupon action
- full-width dark sale footer with purple accents, service/global offer text, optional countdown and mobile wrapping
- independent footer visibility and countdown settings, with admin previews and confirmation summaries
- public promotion API selects eligible active campaigns, prioritizes service offers where applicable and excludes personal coupons
- public coupon banners include copyable codes with feedback; pricing remains base-price-only
- shared Sale Control campaign cards show status, countdown, scope, dates, footer settings and end/disable actions
- promotion banners refresh on focus and every 30 seconds, disappear at expiry, and hide on API failure or during/after payment
- footer timer migration applied locally with Prisma regenerated; production migration status must be verified before deploying dependent code
- sale dialogs cleaned up by removing the sidebar globe icon and redundant Sale behavior note
- focused server tests, client builds, lint checks and local loyalty/footer visual checks passed during implementation; these checks do not establish production deployment
- detailed Admin Price Management editing with per-change confirmation and Check All selection
- server-authoritative price-rule updates through `PATCH /api/admin/prices/rules/:id`
- global/service sale schema with `SaleScope` and nullable `ServiceSale.serviceId`
- forward migration created at `20260822205028_add_global_sale_scope`
- backend sale precedence standardized as service-specific sale → global sale → no sale
- Price Management sidebar split into Create Global Sale and live Sale Control cards
- production price-rule update verified locally before deployment
- LoL Iron/Bronze Net Win base pricing confirmed at $3 per win
- Placement pricing direction confirmed as 5-game full-set pricing with prorating for fewer games
- Pro Duo pricing confirmed at 75% of the corresponding Net Win / Win Boost base while preserving LP-gain modifiers
- first production admin account bootstrapped directly in Render PostgreSQL through local Node/Prisma access
- Render external PostgreSQL SSL requirement documented (`sslmode=require`) after resolving Prisma `P1017`
- stale production JWT role issue diagnosed: refreshed user object showed ADMIN while old JWT still contained CUSTOMER
- admin authorization restored by logging out/in and receiving a fresh ADMIN JWT
- `/updates` public FastBoost Updates page route and page structure added/directed
- reusable news modal component and modal template component added/directed
- shared `newsData.js` direction added for category/filter data and reusable post content
- `News.css` added/directed for Updates page, news list, 2x2 preview cards, and origin-based modal zoom animations
- `CleanIcon` reused for the Updates hero megaphone asset
- Updates page category direction reduced to All News plus Events, Updates, Announcements, and Maintenance only
- Updates page admin section postponed; focus should remain on public layout first
- current issue identified: `News.css` has duplicate/repeated override blocks that should be cleaned before further layout tuning
- homepage Latest News preview updated with a `View More →` action beside `FastBoost Updates`
- opening event modal uses the S3 opening title image from `updates/opening.png`
- opening event wording simplified and made more customer-friendly
- duplicate opening event check row removed from the modal
- opening news architecture decision finalized: homepage top 3 preview now, full `/updates` page later, admin News Management later
- MatchPage chat attachment upload implemented with S3-backed file storage and Prisma message metadata
- chat files now render as Messenger/Instagram-style attachment cards with file name, type, size, uploading state, and Open action
- sender name and timestamp moved above chat bubbles/file cards for a cleaner modern messaging layout
- file upload cards no longer sit inside an extra chat bubble, while normal text messages keep their bubble styling
- chat attachment open/view flow uses backend access checks and temporary signed S3 URLs
- IAM/S3 permission issue for `chat-attachments/*` identified and fixed/directed with `s3:PutObject` and `s3:GetObject`
- MatchPage attachment spinner centered inside the file icon square
- duplicate MatchPage attachment CSS cleanup completed/directed
- global Facebook-style skeleton loading system added with shared `Skeleton.jsx`, `PageSkeletons.jsx`, and `Skeleton.css`
- Dashboard, OrderPage, and MatchPage loading states converted to use the global skeleton effect
- all currently implemented page loading states now share the same skeleton shimmer instead of separate page-specific shimmer implementations
- `Dashboard.css`, `OrderPage.css`, and `MatchPage.css` cleaned so skeleton shimmer lives only in `Skeleton.css`
- cleaned replacement files produced/directed: `Dashboard.cleaned.css`, `OrderPage.cleaned.css`, `MatchPage.cleaned.css`, and `MatchPage.cleaned.jsx`
- Contact page direction added from navbar with Send Email and Live Chat / Coming Soon cards
- Send Email form swipe-down/swipe-up animation added/directed for contact option switching
- animated contact email success popup added/directed with mail/check visual instead of plain success text
- contact success popup glow changed to static aurora instead of spinning background
- payment result overlay added/directed so Stripe success/cancel redirects show animated popups over the OrderPage background instead of a blank page
- success popup verifies payment/session state before navigating to MatchPage
- cancelled popup keeps customers on the order page and silently cleans the unpaid checkout attempt
- `GET /api/payments/verify-checkout-session` added/directed for frontend payment verification
- unpaid checkout cleanup endpoint added/directed at `DELETE /api/orders/unpaid-checkout/:id`
- customer order history now hides unpaid checkout attempts and only shows paid orders
- admin order management now hides unpaid checkout attempts by default, with optional `includeUnpaidCheckout=true` direction for debugging/inspection
- unpaid checkout cleanup hardened with paid-order protection and idempotent `deleteMany`
- backend cleanup utility added/directed to delete abandoned unpaid pending checkout attempts older than 24 hours
- server startup cleanup direction added so unpaid checkout cleanup runs once on boot and then hourly
- Trustpilot AFS email variable added/directed with `TRUSTPILOT_AFS_EMAIL`
- Trustpilot review invite utility added/directed through Nodemailer
- `trustpilotReviewSentAt` added/directed to prevent duplicate review invitations
- Trustpilot review invite trigger added/directed for both admin-complete and provider-complete order paths
- Trustpilot navbar widget attempt replaced with a clean FastBoost-style Reviews link to the public Trustpilot profile
- online boosters navbar pill spacing adjusted to avoid crowding the dashboard/sidebar vertical line
- Stripe sandbox account setup completed for FastBoost payment testing
- Stripe SDK installed/configured in the Express backend
- payment fields added/directed for orders, including payment status, Stripe session/payment intent IDs, paid timestamp, currency, amount cents, cash amount cents, redeemed gold, and gold discount cents
- `PaymentStatus` enum added/directed for PENDING / PAID / FAILED / REFUNDED / CANCELLED
- `ORDER_REDEMPTION` reward type added/directed for gold spending records
- backend Stripe Checkout Session endpoint added at `POST /api/payments/create-checkout-session`
- backend Stripe webhook endpoint added at `POST /api/payments/webhook`
- Stripe webhook raw body setup added before `express.json()` in `app.js`
- Stripe CLI local webhook forwarding installed and verified with `stripe listen --forward-to localhost:5000/api/payments/webhook`
- successful test payment confirmed through Stripe Checkout with webhook updating Prisma order payment status to PAID
- frontend order submit flow redirected toward Stripe Checkout instead of going directly to MatchPage
- frontend `createCheckoutSession(orderId, goldToUse)` API helper added/directed
- checkout gold redemption UI added/directed with customer-entered gold amount
- gold redemption rule finalized as `1 gold = $0.10`
- gold input validation highlights invalid input red and blocks submit when over available gold, over order total, negative, or non-whole-number
- gold input spinner/native browser validation popup removed/directed by using custom input behavior and CSS cleanup
- protected dashboard page added at `/account/dashboard`
- profile dropdown account navigation reorganized while keeping notification/message quick icons
- dashboard cards updated to New Notifications and New Messages
- dashboard loyalty progress card added with clickable navigation to Loyalty page
- tier-specific hover/glow behavior added for dashboard loyalty tier cards
- private referral link card moved from Loyalty page direction to Dashboard page
- dashboard sidebar redesigned with Dashboard / My Orders / Change Password / Home
- Management Utilities removed from dashboard sidebar while staying available through admin profile dropdown
- shared dashboard layout direction added so Dashboard, My Orders, and Change Password keep the sidebar visible
- Account Settings split into profile-only page after moving password change out
- Profile Details expanded with Discord, Country, and Birthday fields
- Profile model direction expanded with `discord`, `country`, and `birthday`
- account update direction expanded to save/load Discord, country, and birthday through `/api/user/me`
- dedicated Change Password page added at `/account/change-password`
- Change Password page embedded into dashboard layout with wider two-column form/requirements layout
- Save Profile button softened to a calmer purple gradient
- homepage UI structure and FastBoost branding
- hover-based featured services
- service ordering
- S3-hosted service images and rank icons
- register/login auth
- JWT auth
- protected user route
- admin-only service creation
- login/register modal flow
- avatar/profile state after login
- forgot-password backend
- password reset token table
- password reset email sending
- reset password page and validation flow
- service details page
- real order navigation
- live order configurator UI
- S3-hosted rank image integration
- right-side checkout summary redesign
- solo/duo-specific add-on layouts
- real backend demo order creation flow
- expanded order schema direction
- first role / second role direction
- real-time chat backend with Socket.IO and REST fallback
- MatchPage connected to real chat/history
- admin order list and admin order detail pages
- provider assigned orders page
- customer orders direction/page entry
- assignment request invite flow with accept/decline/revoke behavior
- navbar notifications with unread/read behavior
- notification highlight rules for unread notifications/messages
- admin/provider/customer chat access rules
- provider complete/leave order actions
- login info card UI on MatchPage
- AWS KMS customer-managed key for order password encryption
- local IAM user setup for KMS development access
- envelope encryption utility using KMS data keys + AES-256-GCM
- encrypted order login info storage direction
- chat message notifications separated from normal notifications
- chat notification click-through to MatchPage
- duplicate unread chat notification prevention direction
- smart MatchPage chat scrolling and scroll restoration
- MatchPage overview moved into sidebar while preserving overview styling
- redundant order summary sidebar card removed
- admin navbar changed from Order Manager to Management Utilities
- protected Management Utilities hub page added at `/admin/management`
- protected Account Management page added at `/admin/accounts`
- admin user search/list API added for account management
- admin role update API added for Customer / Provider-Booster / Admin privileges
- account role-change confirmation modal with countdown, saving state, green-check success, and auto-close
- user soft-suspension fields added/directed through `suspendedAt` and `suspendedReason`
- admin suspend/restore API added for account status management
- account status column and suspend/restore actions added to Account Management
- suspension confirmation modal with red countdown ring, no-entry visual, auto-cancel, saving state, diagonal-slash success, and auto-close
- restore confirmation modal with green countdown ring, slash fade/compress transition, auto-cancel, green-check success, and auto-close
- suspended-account login blocking added with `ACCOUNT_SUSPENDED` response direction
- suspended-login popup added so suspended users see an animated Account Suspended modal instead of a plain error message


- provider order detail route/page for assigned boosters
- provider order flow now opens detail page before MatchPage conversation
- provider can complete assigned order or leave/unassign self from provider detail page
- protected loyalty page with Bronze/Silver/Gold/Platinum progress tracking
- backend loyalty endpoint `GET /api/loyalty/me` calculated from completed orders
- total gold and gold-to-dollar display where 10 gold = $1
- tier-specific loyalty glow/border themes
- loyalty navbar visibility limited to logged-in users
- default Current Orders filtering for admin/provider/customer order lists
- removed All Orders dropdown option from order list filters
- backend `CURRENT` status filtering for admin and provider order lists
- customer username display on admin/provider order list and detail views

- protected account settings page for username/email/password/profile picture management
- backend account update and password change endpoints
- real S3 profile picture upload through protected backend route
- IAM inline policy allowing backend profile uploads to `fastboost-assets/profiles/*`
- hover-to-upload avatar UX in Account Settings
- immediate Navbar avatar updates through `auth:changed` event
- avatar upload loading/shimmer/glow effect for Account Settings and Navbar
- corrected circular avatar image fit with inner clipping frame
- spend-based loyalty tier thresholds using completed spend: $0 / $200 / $500 / $1000
- Account Progress copy changed to “Spend $X more to reach Y tier”
- private referral link field added to Loyalty direction for future benefits/reward features
- email verification routes and frontend API helpers added for Account Settings
- Account Settings email verification UI uses 6 digit boxes with auto-focus, paste support, auto-submit, and resend cooldown
- email verification panel now slides down after email changes and slides up after successful verification
- wrong email verification code highlights all boxes red instead of showing a text error
- successful email verification highlights all boxes green before the panel disappears
- phone number and phone verification flow removed from frontend, backend routes/controllers, and Prisma schema direction

#### Completed functions
- Dashboard/account center redesign completed:
  - profile dropdown keeps notification/message quick icons and now includes Dashboard, Management Utilities, Orders, Profile, and Logout
  - dashboard route added at `/account/dashboard`
  - dashboard sidebar contains Dashboard, My Orders, Change Password, and Home only
  - Management Utilities removed from dashboard sidebar but still accessible to admins from profile dropdown
  - sidebar/logo visual connection polished without moving the original homepage/navbar logo
- Dashboard cards completed:
  - New Notifications shows unread non-chat notifications
  - New Messages shows unread `CHAT_MESSAGE` notifications
  - Loyalty Rewards Status card uses spend/tier/progress data and routes to Loyalty page
  - tier card hover states match Bronze/Silver/Gold/Platinum/Diamond colors
  - Share Your Referral Link card moved onto Dashboard and copied from Loyalty direction
- Account settings split completed:
  - Account Settings is now profile-only
  - Change Password moved to `/account/change-password`
  - Discord, Country, and Birthday fields added to Profile Details direction
  - profile save direction expanded to include Discord, country, and birthday
  - Save Profile button color softened
- Shared account layout completed/directed:
  - Dashboard, My Orders, and Change Password render inside a shared dashboard layout
  - Home exits the dashboard layout
  - Customer Orders page direction adjusted to avoid duplicate Navbar/page shell inside dashboard layout
  - Change Password page direction adjusted to avoid duplicate Navbar/page shell inside dashboard layout
- Admin Management Utilities completed:
  - admin navbar now opens `/admin/management`
  - Order Management card links to existing `/admin/orders`
  - Account Management card links to new `/admin/accounts`
  - Booster, Service, Event, Update, and FAQ management cards are displayed as future utilities
- Account Management completed/directed:
  - protected admin-only route added
  - searchable user table added
  - email verification and active/suspended status badges added
  - role badges and privilege dropdown added
  - order-count column removed because the page is focused on account control
- Admin account API completed/directed:
  - user list/search endpoint added
  - role update endpoint added
  - suspension/restore endpoint added
  - existing `protect` and `adminOnly` middleware reused
  - `emailVerifiedAt` used correctly for Prisma user verification state
- Privilege update modal completed:
  - browser confirm popup removed
  - countdown confirmation modal added
  - timer auto-cancel added
  - saving spinner added
  - success green-check animation added
  - modal success auto-close added
- Account suspension/restore completed:
  - suspend and restore actions added to account table
  - browser confirm popup removed
  - red countdown ring added for suspension confirmation
  - suspension countdown auto-cancel added
  - suspension success animation uses red circle redraw and diagonal slash
  - restore confirmation uses green countdown ring with slash fade/compress transition
  - restore success keeps the green check animation
- Suspended login flow completed/directed:
  - backend blocks login when `suspendedAt` is set
  - backend returns `ACCOUNT_SUSPENDED`
  - frontend homepage login shows animated Account Suspended popup
  - normal invalid-login errors remain unchanged

- Homepage game/service dropdown completed:
  - LoL and TFT game cards are selectable
  - service dropdown opens for both games
  - dropdown content uses `visibleGame` to avoid close/switch blinking
  - dropdown animation uses `selectedGame` for open/close state
- Homepage service card redesign completed:
  - old background-image service cards replaced with cleaner dark cards
  - service images moved into small top-left icon positions
  - Details button removed from homepage cards
  - homepage cards now route users directly to `/order/:serviceId`
- TFT homepage service cards completed/directed:
  - TFT Rank Boost
  - TFT Win Boost
  - TFT Placement Boost / Placement Games depending on exact database title
  - service filtering and priority ordering added for TFT services
- FastBoost Updates section completed/directed:
  - old League Patch Center copy replaced
  - Latest Event, Latest Updates, and FAQ / Help items are clickable
  - right-side detail card changes based on selected update item
- Service icon cleanup completed/directed:
  - original service icons generated/directed for Rank, Win, Placement, and Duo
  - `CleanIcon` component added for client-side background cleanup
  - icon cache and ready-state fade-in added to avoid half-second dirty-image flashing
- TFT order pricing completed/directed:
  - TFT Rank Boost pricing added with division-step pricing and Master `$1.30/LP` direction
  - TFT Win Boost pricing added from provided price screenshot
  - TFT Placement pricing added from provided price screenshot
  - pricing branches split by `isTftService`
  - TFT service labels normalized through `normalizedServiceType`
- Checkout summary tag/strip polish completed:
  - LoL-style rank strip/tag reused for TFT modes
  - summary checks updated from exact `serviceType` to `normalizedServiceType`
  - duplicate Rank Boost strip direction removed

- Referral eligibility completed on Loyalty page:
  - verified email required
  - at least 3 completed orders required
  - requirement cards show green tick / red X
  - duplicate “Referral link ready” card removed
  - completed-order requirement display capped at `3/3`
- Private referral invite flow completed/directed:
  - `/r/:referralCode` route opens the homepage register modal with invite context
  - register request sends optional `referralCode`
  - backend saves `referredById` on invited users
  - referral reward is granted when invited user verifies email and inviter meets requirements
  - inviter and invited user each receive `+50 gold` (`$5` discount credit)
- Public referral preview completed:
  - `GET /api/referrals/public/:referralCode`
  - returns inviter username/display name fallback
  - returns inviter profile image URL
  - returns inviter eligibility and reward explanation
- Private invite register modal completed:
  - wider modal state for private invite registration
  - circular inviter profile image/avatar fallback
  - reward explanation and conditions shown before registration
  - unnecessary “Private invite detected” wording removed
  - invite card spacing fixed so it does not collide with username input
- Reward History model/direction completed:
  - `RewardHistory` model direction added for referral rewards and future bonuses
  - referral rewards protected from duplicate grants with unique inviter/invited reward records
  - Loyalty response combines completed-order rewards and stored reward-history records
  - Total Gold includes completed-order gold plus reward-history gold
- Reward History frontend completed:
  - section renamed from Completed Match Rewards to Reward History
  - max 5 history items per page
  - pagination controls added below history
  - pagination loading no longer collapses the whole page to the top
  - reward-section scroll preservation added after page changes
- Loyalty tier update completed:
  - Diamond tier added after Platinum
  - Diamond is now the highest/max tier in progress logic
  - Diamond styling follows the order page diamond-blue color direction
  - tier benefit cards display Bronze/Silver/Gold/Platinum/Diamond bonuses
  - finalized display benefits: Bronze no bonus, Silver 200 coins + 3%, Gold 500 coins + 5%, Platinum 800 coins + 8%, Diamond 1500 coins + 10%

### In progress

Historical backlog: verify each item against current implementation before starting. The current immediate focus below takes precedence.
- production deployment/verification of `20260822205028_add_global_sale_scope` on Render after pushing the migration with the feature
- cleanup/refactor `client/src/styles/News.css` so the Updates page has one final layout source of truth instead of repeated overrides
- final `/updates` page structure polish to match the provided demo mockup: compact left hero/list and right 2x2 detail template preview
- final megaphone asset positioning and transparency polish after CSS cleanup
- final browser verification for the global skeleton migration after replacing cleaned CSS/JSX files
- final check that no old page-specific skeleton shimmer classes remain referenced in active JSX
- final end-to-end testing for unpaid checkout cleanup across cancel, back-button, closed-tab, and Stripe webhook timing cases
- final Trustpilot AFS invite testing after real/completed paid orders
- final testing for gold redemption edge cases, including partial-gold, full-gold, invalid gold, and webhook retry/idempotency behavior
- final refund/cancellation handling direction for Stripe and gold redemption reversal
- final shared dashboard layout testing across Dashboard, My Orders, and Change Password
- final Account Settings profile-field save/load verification for Discord, country, and birthday
- final Loyalty page cleanup after moving referral card to Dashboard
- final duplicate chat notification verification after clearing old unread records
- notification sender avatars using saved profile images
- final status automation cleanup across admin/provider/customer flows
- remaining shared navbar consistency polish across all protected pages
- final TFT and LoL pricing verification with real order tests
- duo-specific addon field cleanup, including `untrackableDuo`
- FastBoost Updates real endpoint/pages for Latest Event, Latest Updates, and FAQ / Help
- reveal/audit logging for viewed game credentials

---

## Current immediate focus

1. Review and, when authorized, deploy the current social-link confirmation and UI changes together.
2. Complete real Google/Discord sign-in checks in production, including Link & sign in, Not now, returning login and new-user signup. Automated coverage does not establish live provider completion.
3. Verify production migration status for newer footer/personal-coupon changes before deploying dependent features.
4. Verify production order-receipt delivery separately from contact email. Do not replay payments to resend receipts.

The older backlog below is retained for planning, not authorization to implement or deploy it. Recheck its items against current code before starting work.

---

## Next steps (recommended)

1. Clean the Updates page CSS before doing more visual tuning:
   - open `client/src/styles/News.css`
   - remove duplicate bottom override blocks for `.updates-page`, `.updates-hero`, `.updates-layout`, `.updates-side-column`, `.updates-recent-grid`, and `.updates-recent-card`
   - keep only one final Updates layout block
2. Rebuild the `/updates` page visual structure against the demo:
   - top-left compact hero with megaphone
   - filter row with only All News, Events, Updates, Announcements, and Maintenance
   - left list smaller/compact
   - right `News Detail Page Templates` section moved upward
   - right preview cards as a larger 2x2 grid
3. Confirm `UpdatesPage.jsx` imports are clean:
   - `NewsModal` imported from `../components/news/NewsModal`
   - no duplicate local `NewsModal` function inside `UpdatesPage.jsx`
   - `CleanIcon` imported only if still needed for the megaphone

1. Test MatchPage chat attachment upload end-to-end:
   - login as a customer on an order MatchPage
   - upload an image, PDF, and another document type through the attach button
   - confirm the file card appears immediately with an uploading state
   - confirm the saved message shows file name, type, size, and Open action
   - click Open and confirm the backend returns a signed URL and the file opens in a new tab
   - login as assigned provider/admin and confirm authorized participants can also open the file
   - confirm unrelated users cannot access the attachment endpoint
2. Test MatchPage chat UI polish:
   - confirm sender name and timestamp align on one straight baseline
   - confirm normal text messages still use bubbles
   - confirm file cards do not have an extra outer bubble
   - confirm system messages remain centered
   - confirm upload spinner is centered inside the file icon square
3. Test S3/IAM permissions:
   - confirm uploads work for `chat-attachments/*`
   - confirm profile image uploads still work for `profiles/*`
   - confirm production IAM policy is least privilege and scoped to only the required S3 paths

1. Test cancelled Stripe checkout cleanup:
   - create an order from the frontend
   - click Continue to Secure Payment
   - cancel/back out from Stripe Checkout
   - confirm `/payment/cancelled/:serviceId?orderId=...` shows the animated cancelled popup over the OrderPage
   - confirm browser Network shows `DELETE /api/orders/unpaid-checkout/:id`
   - confirm Prisma no longer has that unpaid order
   - confirm Customer My Orders does not show unpaid checkout attempts
   - confirm Admin Orders does not show unpaid checkout attempts by default
2. Test duplicate cleanup safety:
   - cancel Stripe checkout in local React dev mode
   - confirm duplicate cleanup calls do not crash
   - expected behavior is one deletion and any later duplicate request returning safely
3. Test abandoned checkout cleanup:
   - create an unpaid pending order by starting checkout and closing the tab
   - temporarily lower the cleanup cutoff during local testing if needed
   - confirm `cleanupOldUnpaidOrders()` removes only unpaid pending orders and never removes paid orders
4. Test Trustpilot review invite flow:
   - complete a paid order as admin
   - complete a paid assigned order as provider
   - confirm `trustpilotReviewSentAt` is filled after one successful send
   - confirm repeated completion/status updates do not send duplicate invites
   - confirm unpaid completed test orders do not send Trustpilot invites
1. Test Stripe payment flow end-to-end:
   - start backend with `npm run dev`
   - start Stripe CLI with `stripe listen --forward-to localhost:5000/api/payments/webhook`
   - create an order from the frontend
   - confirm the frontend calls `POST /api/payments/create-checkout-session`
   - confirm customer is redirected to Stripe Checkout
   - pay with Stripe test card `4242 4242 4242 4242`
   - confirm webhook returns `200` in Stripe CLI
   - confirm Prisma order fields show `paymentStatus = PAID`, `paidAt`, `stripeCheckoutSessionId`, and `stripePaymentIntentId`
2. Test gold redemption payment cases:
   - `0` gold should charge the full Stripe amount
   - partial gold should reduce the Stripe cash amount
   - gold equal to full order value should complete without Stripe redirect if backend gold-only path is enabled
   - invalid decimal input like `1.1` should show the custom red error, not browser native validation
   - entering more gold than available should highlight red and disable submit
   - entering more gold than the order total can cover should highlight red and disable submit
3. Build/polish payment redirect pages:
   - `/payment/success`
   - `/payment/cancelled`
   - success page should verify order/session state through backend, not trust URL alone
4. Test shared dashboard layout navigation:
   - open `/account/dashboard`
   - click Dashboard, My Orders, and Change Password from the sidebar
   - confirm the sidebar stays visible on those pages
   - click Home and confirm it exits to `/`
   - confirm Management Utilities is not in the dashboard sidebar
   - confirm admin Management Utilities still appears in the profile dropdown
2. Test dashboard cards:
   - create unread normal notifications and confirm they appear under New Notifications
   - create unread chat notifications and confirm they appear under New Messages
   - click the loyalty progress card and confirm it routes to `/account/loyalty`
   - confirm tier hover color matches each tier
   - copy the referral link from the dashboard card
3. Test Account Settings profile fields:
   - save Discord
   - save Country
   - save Birthday
   - refresh and confirm all values persist
   - confirm profile picture upload, username, email, and email verification still work
4. Test Change Password inside dashboard layout:
   - confirm no duplicate Navbar appears
   - confirm the password form and requirements box are visible
   - test weak password, wrong current password, mismatched confirmation, and successful update
   - logout and login using the new password
1. Test admin management flow end-to-end:
   - login as an admin
   - open Management Utilities
   - confirm Order Management opens `/admin/orders`
   - confirm Account Management opens `/admin/accounts`
   - confirm future utility cards are visible but not accidentally routed
2. Test Account Management role changes:
   - search by username/email/display name
   - change Customer to Provider/Booster
   - confirm countdown modal auto-cancels if left alone
   - confirm Yes shows saving then green-check success
   - logout/login as that account and verify provider navbar access
   - confirm admins cannot change their own role
3. Test suspension/restore:
   - suspend a non-admin test account
   - confirm red countdown ring auto-cancels if left alone
   - confirm suspension success shows diagonal slash and auto-closes
   - confirm suspended badge appears in the account table
   - restore the account and confirm green countdown/green-check success flow
   - confirm admins cannot suspend their own account
4. Test suspended-login behavior:
   - suspend a test user
   - try logging in with wrong password and confirm normal invalid-login behavior
   - try logging in with correct password and confirm animated Account Suspended popup
   - restore the user and confirm login works again
5. Clean up final Account Management polish:
   - remove unused `success` state if no page-level success banner is needed
   - consider adding a status filter: Active / Suspended
   - consider adding suspend reason input later if needed
   - consider adding audit logs for role changes and suspension events

1. Test homepage game dropdown end-to-end:
   - click LoL and confirm four LoL service cards appear
   - click TFT and confirm three TFT service cards appear
   - close dropdown and confirm it swipes up without blinking LoL content
   - quickly switch between LoL and TFT and confirm icons do not flash dirty backgrounds
2. Test S3 icon behavior:
   - confirm `CleanIcon` does not show checkerboard/solid backgrounds before processing
   - confirm S3 CORS allows canvas cleanup if using remote S3 images
   - confirm cleaned icons stay cached after switching games
3. Test TFT order page pricing:
   - TFT Rank Boost: test normal division climb and Master LP pricing
   - TFT Win Boost: test every tier price per win
   - TFT Placement Boost: test peak-rank pricing and placement game count behavior
   - confirm LoL prices still behave the same after TFT branching
4. Test checkout summary display:
   - confirm LoL Rank/Placement/Win/Pro Duo still show the correct checkout strip/tag
   - confirm TFT Rank/Placement/Win show the same LoL-style checkout strip/tag
   - confirm no duplicate Rank Boost strip appears
5. Add or verify database Service rows:
   - `TFT Rank Boost`
   - `TFT Win Boost`
   - `TFT Placement Boost` or `TFT Placement Games`, matching the frontend title exactly

1. Test referral invite flow end-to-end:
   - login as inviter with verified email and at least 3 completed orders
   - copy private referral link from Loyalty page
   - open `/r/:referralCode` in another browser/session
   - confirm wider invite register modal shows inviter username/avatar and reward conditions
   - register invited user through the private link
   - verify invited user's email
   - confirm both users receive `+50 gold` in Reward History
2. Test Reward History pagination:
   - create more than 5 reward/history records
   - confirm only 5 show per page
   - click Next/Previous/page number
   - confirm the page stays near Reward History and does not jump to the top
3. Test Diamond tier display:
   - create completed spend above $1500
   - confirm Diamond is the max tier and uses the diamond-blue theme
   - confirm tier benefit cards show coin/top-up bonus display direction
1. Test email verification end-to-end:
   - login as an existing verified user
   - change email in Account Settings
   - click Save Profile
   - confirm the verification panel slides downward
   - click Send Email Code
   - confirm the resend timer appears
   - enter a wrong code and confirm red box highlight/shake without text error
   - enter the correct code and confirm green highlight, slide-up animation, and Verified badge
2. Test account settings end-to-end:
   - update username
   - update email
   - upload profile picture
   - confirm S3 object appears under `fastboost-assets/profiles/<userId>/`
   - confirm Account Settings preview updates
   - confirm Navbar avatar updates immediately
   - confirm refresh still shows the uploaded image
3. Test password change:
   - weak password should fail checklist
   - wrong current password should show an error
   - valid new password should save
   - logout and login with the new password
4. Test spend-based loyalty:
   - mark completed orders with different total prices
   - confirm completed spend controls Bronze/Silver/Gold/Platinum tier
   - confirm progress says “Spend $X more to reach Y tier”
   - confirm duplicate completed-spend text is removed from the Account Progress header
5. Add notification/chat sender avatars using saved `profile.profileImageUrl`.
6. Add credential reveal audit logging:
   - user id
   - role
   - order id
   - timestamp
   - action type
7. Restrict AWS permissions before real deployment:
   - exact KMS key ARN instead of `Resource: "*"`
   - backend IAM role instead of long-lived production keys
   - least-privilege S3 upload path permissions
8. Finish pricing logic cleanup:
   - solo/duo add-on pricing
   - bonus win pricing by rank
   - `untrackableDuo`
9. Connect the patch section to a real backend endpoint later.

## Website highlights

- Added S3-backed MatchPage chat attachments with secure backend upload, Prisma message metadata, signed file-view URLs, and role-based conversation access checks.
- Upgraded chat UI to modern Messenger/Instagram-style layout where sender/time sits above each message, normal text keeps bubbles, and uploaded files render as clean standalone file cards.
- Fixed chat attachment uploading UX with temporary uploading messages, centered spinner animation, file type badges, file size labels, and Open actions for authorized participants.
- Added a shared global Facebook-style skeleton loading system with reusable React skeleton primitives and page-level loading layouts, keeping the same visual shimmer previously used on OrderPage and MatchPage.
- Migrated Dashboard, OrderPage, and MatchPage loading states to the global skeleton system and cleaned page CSS so the shimmer effect is centralized in `Skeleton.css`.
- Added a polished Contact support flow with Send Email / Live Chat cards, swipe-down email form animation, and an animated mail/check success confirmation popup.
- Added a payment result overlay flow that keeps the customer on the order page during Stripe success/cancel redirects, verifies payment before MatchPage navigation, and shows polished animated feedback.
- Implemented unpaid checkout cleanup so cancelled Stripe attempts are hidden from customer/admin order lists and deleted safely without risking paid orders.
- Added scheduled backend cleanup for abandoned unpaid checkout attempts while keeping paid orders protected.
- Integrated Trustpilot AFS review-invite direction for paid completed orders and added a clean navbar Reviews link to the public Trustpilot profile.
- Integrated Stripe Checkout into a React/Express marketplace flow with authenticated Checkout Session creation, dynamic order pricing, and Stripe-hosted payment redirects.
- Implemented secure Stripe webhook fulfillment using raw Express request bodies, Stripe CLI local forwarding, signature verification, and Prisma order payment updates.
- Added customer gold redemption at checkout with frontend validation, backend normalization, payment amount reduction, and reward-history redemption direction.
- Built payment-state separation between order workflow status and payment fulfillment status so paid, pending, completed, cancelled, and loyalty logic can be managed safely.
- Built a protected admin Management Utilities hub with scalable utility cards and role-gated navigation for admin workflows.
- Implemented an admin Account Management page with user search, verification/status badges, privilege changes, and suspend/restore account controls.
- Added admin-only account APIs for user listing, role updates, and soft suspension using Express middleware, Prisma, and PostgreSQL.
- Replaced browser confirmation dialogs with polished React confirmation modals including countdown auto-cancel, saving states, success animations, and timed auto-close behavior.
- Implemented suspended-account login protection with backend enforcement and an animated frontend Account Suspended popup instead of plain login error text.

- Expanded the marketplace homepage from LoL-only services into a two-game LoL/TFT service hub with animated dropdown cards, dynamic filtering, and direct order routing.
- Added TFT pricing support into the existing order configurator by branching pricing logic through normalized service types while preserving the existing LoL order format.
- Built a client-side icon cleanup component using canvas processing, caching, and ready-state rendering to prevent non-transparent icon backgrounds from flashing during UI transitions.
- Replaced a demo patch-news section with a FastBoost-specific updates/help hub that supports Latest Event, Latest Updates, and FAQ / Help content previews.
- Implemented a private referral invite workflow with eligibility requirements, public invite previews, invite-aware registration UI, and reward-history based gold rewards for both inviter and invited users.
- Added paginated Reward History combining completed-order gold, referral rewards, and future bonus records, including smooth page-change behavior that preserves scroll position.
- Expanded loyalty tiers with Diamond as the new highest tier and added tier benefit displays for coin/top-up bonus direction.
- Implemented email verification in Account Settings with 6-digit SMTP codes, animated verification UI, auto-submit digit boxes, and unverified-state handling when users change email.
- Removed demo-only phone verification after evaluating SMS delivery requirements, cleaning the frontend, backend routes/controllers, and Prisma schema to avoid shipping fake phone verification.
- Added referral-link direction in the Loyalty page to support future invite/reward benefits.
- Built a protected account settings workflow with secure password changes, profile updates, and real AWS S3 profile image uploads through an Express backend.
- Implemented immediate cross-component avatar synchronization and loading/shimmer UI states in React using localStorage updates and custom browser events.
- Refactored loyalty rewards from match-count thresholds to spend-based tier progression using completed-order spend calculations from Prisma/PostgreSQL.
- Implemented AWS KMS envelope encryption with AES-256-GCM to protect customer order credentials, storing only ciphertext, encrypted data keys, IVs, and auth tags in PostgreSQL.
- Built role-aware real-time order chat using Socket.IO, Express, Prisma, and PostgreSQL.
- Added chat notification workflow that excludes the sender, separates message alerts from system notifications, and routes users directly to the related MatchPage conversation.
- Built admin/provider/customer order-management flows with assignment requests, accept/decline/revoke behavior, status transitions, and protected role-based access.
- Designed a polished dark gaming marketplace UI with React, Vite, reusable layout components, S3-hosted assets, and responsive MatchPage panels.

---

## Author

**An Nguyen Nguyen**

Portfolio full-stack project built for learning, practice, and professional presentation on GitHub and LinkedIn.

Checkout follow-up: confirmed payments stay on checkout. The order summary expands into a paid order card with the order number, game/service, a borderless service-specific tracker, and an explicit Go to Order button. Placement summaries show peak rank and placement matches; Win Boost and Pro Duo show their requested quantities instead of a target rank.

### Public order numbers
Orders use a permanent public number such as `LOL-RNK-CXBE6`. Prefixes are LOL/TFT plus RNK (rank), PLC (placements), WIN (wins), or DUO (pro duo). Internal IDs and route authorization remain unchanged. Customer/admin/provider screens, chat references, new notifications, review emails, Stripe Session/PaymentIntent metadata and admin search use `orderNumber`.

Migration `20260922180000_public_order_numbers` backfills existing orders and installs a PostgreSQL trigger. Five characters are randomly selected from an unambiguous 32-symbol alphabet using cryptographically random UUID bytes. A permanent suffix reservation table enforces global uniqueness across games/services and prevents reuse after deletion. Conflicts retry atomically; exhaustion fails without issuing a duplicate. Capacity is 33,554,432 lifetime suffixes. Order numbers are immutable.

Apply this migration before running the updated generated Prisma client. The configured database also has an unrelated pending `20260921200000_optimize_loyalty_history` migration; do not deploy all pending migrations accidentally. The public-order-number migration was explicitly approved and applied to the configured database on September 22, 2026; all 40 existing orders were backfilled and uniqueness verified. Already-sent emails and completed Stripe transactions are not rewritten. No standalone support-ticket subsystem currently exists; order-linked support chat uses the same number.

Database allocator test: `RUN_ORDER_NUMBER_DB_TEST=1 node --test test/orderNumber.test.js`. It creates a separate schema inside a transaction and rolls everything back, covering backfill, prefixes, 2,000 allocations, forced collision retry, immutability and retained reservations.

Referral links displayed and copied in the dashboard use the browser's current origin, so deployed links use the public website domain and localhost links appear only during local browsing.


### Checkout coupon redemption

Coupon codes may be reused after the old campaign expires or is disabled (the admin removal action). Active and scheduled campaigns reserve their codes. Reuse creates a new campaign ID and usage allowance; historical orders keep their original coupon and price snapshots. An old unpaid checkout never silently adopts a reused code.

Migration `20260923030000_reusable_coupon_codes` was applied to the configured development database, with Prisma regenerated. Production requires this migration alongside the backend update. It replaces permanent code uniqueness with the manually maintained partial unique index `ServiceSale_active_couponCode_key` (`active = true`); preserve this index in future migrations. Expired reservations are released atomically when creating a replacement.

Active admin coupons are entered in checkout's Coupon code field. They discount the base price only. The larger of the order's existing automatic sale and the coupon wins; they never stack. An explanatory popup tells customers which discount was retained. The existing referral percentage, when present, is calculated after the winning discount. Gold is applied after these discounts. Applied coupon titles appear in checkout and confirmation emails. Checkout shows the coupon once in the price breakdown, with an accessible grey, underlined, normal-weight Remove button beside its name (disabled while payment is busy).

`CouponUse.usedAt` is set atomically with verified payment, including gold-only payment. Applying a coupon or loading an unpaid draft does not consume it. An unpaid checkout claim can move to another draft after its old Stripe session is expired. A unique account/coupon constraint plus serialized checkout mutations prevent two payable sessions from redeeming the same coupon for one account. Cancellation releases the use; completed orders retain it. Coupon price snapshots remain on the order for history.

Schema: `20260922210000_sale_coupons` and `20260922220000_checkout_coupon_redemption`, both applied and recorded on the configured database September 22, 2026. Deploy the matching backend and frontend together. Do not automatically apply the unrelated pending loyalty-history migration. Scheduled cleanup preserves coupon drafts; session expiry releases unpaid claims, and customers can remove or move an unpaid coupon. Disabled/expired coupons are removed with an explanation on checkout refresh. Already issued payment sessions honor their quoted price until expired/replaced.

Verification: `npm test` in `server`; `RUN_COUPON_DB_TEST=1 node --test test/couponDatabase.test.js` runs the database trigger/uniqueness lifecycle checks inside a completely rolled-back isolated schema. No Stripe charge or email send is needed for these tests.

Personal coupons support multiple selected accounts under one code. Each selected account can redeem once; other accounts cannot view or redeem the private offer. Apply `20260923050000_multiple_coupon_recipients` before deploying this change, then regenerate Prisma Client. The migration is applied in the configured development database only.
