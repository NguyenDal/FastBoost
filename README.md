# Gaming Services Platform (FastBoost)

A full-stack portfolio project built with **React**, **Vite**, **Express**, **Prisma**, and **PostgreSQL**.

This project is a **game services marketplace demo** where users can register, log in securely, reset passwords by email, browse service types, configure a demo order, continue into a match/chat flow, and manage role-based order communication. It’s being developed as a **software engineering portfolio project** to demonstrate a real full-stack workflow: UI → API → database → auth → secure credential storage → real-time chat.

---

## What’s new (latest progress)

### Latest session update — Account settings, real S3 profile uploads, avatar loading polish, and spend-based loyalty

#### Account Settings page
- Added a protected account settings page:
  - `client/src/pages/AccountSettingsPage.jsx`
  - `client/src/styles/AccountSettings.css`
  - `client/src/api/accountSettings.js`
  - route: `/account/settings`
- Navbar profile dropdown now routes **Account Settings** to `/account/settings`.
- Account Settings allows authenticated users to update:
  - username
  - email
  - profile picture
  - password
- Account Settings preview card displays:
  - circular profile image
  - username
  - email
- The profile form now focuses only on username/email because image upload is handled directly from the avatar preview.

#### Backend account/profile endpoints
- Extended existing user controller/routes with profile/account update actions:
  - `PATCH /api/user/me` — update username, email, and saved profile image URL
  - `PATCH /api/user/me/password` — change current password after validating old password
  - `POST /api/user/me/profile-picture` — upload profile image to S3 and save URL on profile
- `GET /api/user/me` now returns profile data needed by the frontend, including `profile.profileImageUrl`.
- Account update validates:
  - username required
  - username minimum length
  - case-insensitive username uniqueness
  - valid email format
  - case-insensitive email uniqueness
- Password update validates:
  - current password required
  - current password must match bcrypt hash
  - new password and confirm password must match
  - new password must be different from current password
  - new password must pass the same strength rules used by reset password

#### Real S3 profile picture uploads
- Added true profile picture upload flow instead of manually pasting image URLs.
- Correct upload flow:
  ```text
  React file picker -> protected backend route -> backend uploads to S3 -> backend saves S3 URL -> frontend updates localStorage/navbar
  ```
- Added backend S3 upload utility:
  - `server/src/utils/s3Upload.js`
- Added backend dependencies:
  - `multer`
  - `@aws-sdk/client-s3`
- Profile pictures upload to the public FastBoost asset bucket:
  - bucket: `fastboost-assets`
  - prefix: `profiles/<userId>/...`
  - public base URL: `https://fastboost-assets.s3.amazonaws.com/`
- Added local/backend environment variable:
  - `AWS_S3_ASSETS_BUCKET="fastboost-assets"`
- AWS permissions updated:
  - existing S3 bucket policy keeps public `s3:GetObject` for viewing images
  - IAM user `fastboost-local-kms-user` now has inline policy `FastBoostUploadProfileImages`
  - upload permission is restricted to `arn:aws:s3:::fastboost-assets/profiles/*`

#### Avatar upload UX polish
- Removed the visible file upload field from the Profile Details form.
- Users now change profile picture by hovering/clicking the avatar inside the Account Settings preview card.
- Hovering the account preview avatar shows:
  - dark transparent full-circle overlay
  - large centered upload icon
  - current profile image still barely visible underneath
- The upload trigger uses a hidden file input with `useRef`, so the UI stays clean.
- Profile picture is now clipped correctly inside a circular image frame while still allowing the outside glow ring to show.
- Fixed circular fit issues by separating:
  - outer avatar button/glow layer
  - inner circular image clipping frame
  - upload overlay layer
- Images use `object-fit: cover` and `object-position: center` so uploaded photos fit the circle cleanly.

#### Immediate navbar avatar updates
- Navbar now updates immediately after profile image upload instead of waiting for refresh/focus.
- Added/used custom browser events:
  - `auth:changed` — sends updated user data to Navbar
  - `profile-image:uploading` — tells Navbar when avatar upload starts/ends
- Navbar avatar now reads the latest image from:
  - `effectiveCurrentUser.profile.profileImageUrl`
  - `effectiveCurrentUser.profileImage`
  - cached local user fallback
- After S3 upload finishes, the frontend updates localStorage, dispatches `auth:changed`, and the navbar avatar changes immediately.

#### Facebook-style avatar loading effect
- Added loading/shimmer/glow effect for profile images while a new image is uploading.
- Loading applies to:
  - Account Settings profile preview avatar
  - Navbar avatar
- Loading effect includes:
  - rotating conic glow ring
  - shimmer/fading overlay
  - dimmed current avatar while waiting
- Shared animation keyframes added:
  - `avatarSpinGlow`
  - `avatarShimmer`
- Account Settings and Navbar both show the loading state during S3 upload and remove it once upload completes.

#### Spend-based loyalty upgrade
- Loyalty tier logic was changed from completed-match count to completed-spend thresholds.
- Account progress line now says:
  ```text
  Spend $X more to reach Silver/Gold/Platinum tier.
  ```
- Removed the duplicate completed-spend number from the right side of the Account Progress header because the page already has a Total Completed Spend stat card below.
- New loyalty tier checkpoints:
  - Bronze: `$0+` completed spend
  - Silver: `$200+` completed spend
  - Gold: `$500+` completed spend
  - Platinum: `$1000+` completed spend
- These thresholds feel reasonable for a demo/portfolio marketplace because they are aspirational but not impossible. They also make loyalty feel more business-like than using number of completed matches only.
- Loyalty still tracks completed order count and gold, but tier/progress is now based on total completed spend.

### Previous session update — Provider order details, loyalty rewards, current-order filters, and username display

#### Provider/booster order detail flow
- Added a dedicated provider order detail route:
  - `client/src/pages/ProviderOrderDetailsPage.jsx`
  - `/provider/orders/:id`
- Changed provider assigned order flow:
  - `ProviderOrdersPage` no longer sends boosters directly to `/match/:orderId`.
  - Clicking **Open** now routes to `/provider/orders/:id` first.
  - From the provider detail page, boosters can open the conversation through **Go to Conversation**.
- Provider detail page reuses the premium admin order detail styling from `Admin.css` while keeping provider-only permissions.
- Provider detail page allows boosters to view assigned order details, customer username/email, order configuration, add-ons, price summary, open the conversation, mark orders completed, and leave/unassign themselves from an order.
- Provider detail page intentionally does **not** allow boosters to cancel orders, assign other boosters, or unassign other boosters.

#### Loyalty rewards page
- Added a protected customer/admin loyalty page:
  - `client/src/pages/LoyaltyPage.jsx`
  - `client/src/styles/Loyalty.css`
  - `client/src/api/loyalty.js`
  - route: `/account/loyalty`
- Navbar now routes **Loyalty** to `/account/loyalty` and only shows it when a user is logged in.
- Loyalty page displays current loyalty tier/account type, progress tracking, Bronze/Silver/Gold/Platinum milestones, completed matches count, total gold earned, completed spend, and completed match reward history.
- Gold conversion display added:
  - `10 gold = $1`
  - Total Gold card can show values like `18 = $1.80`.
- Loyalty hero/card glow now follows the actual account tier color instead of always using a gold theme.

#### Loyalty backend endpoint
- Added backend loyalty route/controller:
  - `server/src/controllers/loyaltyController.js`
  - `server/src/routes/loyaltyRoutes.js`
  - mounted in `server/src/app.js` at `/api/loyalty`
- Added endpoint:
  - `GET /api/loyalty/me`
- Backend calculates loyalty from completed customer orders where:
  - `customerId` is the logged-in user
  - `status` is `COMPLETED`
- Gold earned per completed order is calculated as:
  - `Math.floor(order.totalPrice)`
- Frontend Loyalty page consumes the backend loyalty object instead of guessing from raw order data.

#### Current-order filtering cleanup
- Improved order list filters so active orders are shown by default instead of all orders.
- Default dropdown value is now `Current Orders`, meaning `PENDING` and `IN_PROGRESS`.
- Removed the **All Orders** option from the dropdown.
- Updated frontend pages:
  - `AdminOrdersPage.jsx`
  - `ProviderOrdersPage.jsx`
  - `CustomerOrdersPage.jsx`
- Updated backend order list logic so Prisma understands `status=CURRENT` in `listAllOrders` and `listAssignedOrdersForProvider`.

#### Customer username display
- Confirmed backend order responses include `customer.username` in relevant order queries.
- Confirmed frontend order list pages display customer username first, then fall back to profile display name/email when needed.

### Previous session update — Admin/Provider/Customer order management + real MatchPage chat
- Built and polished the **Admin Order Management** flow:
  - `AdminOrdersPage` for listing and filtering all orders.
  - `AdminOrderDetailsPage` for viewing order details, status, price summary, assignments, add-ons, champion selections, and conversation access.
  - Admin can invite boosters, assign/unassign boosters, cancel orders, and mark orders completed.
  - Admin status field was refined so status is mostly automatic instead of manually changing everything.
- Built the **assignment request / invite flow**:
  - Admin clicking Assign creates a pending assignment request instead of instantly assigning.
  - Button changes to a waiting state, with a short revoke/cancel interaction.
  - Booster receives an assignment notification with Accept / Decline actions.
  - Accepting the request assigns the booster, moves the order to `IN_PROGRESS`, and enables chat access.
  - Declining/revoking/cancelling updates or clears the request flow and sends notifications where needed.
- Improved the **notification drawer** in the shared navbar:
  - unread notifications light the bell with a soft red highlight/dot.
  - read notifications no longer keep the glowing unread border.
  - notification count reflects unread items only.
  - notifications are marked read after the user closes the notification panel, not immediately when opened.
  - assignment removal notifications include the order number.
- Built the **Provider/Booster Order Management** flow:
  - `ProviderOrdersPage` shows assigned orders for the logged-in booster.
  - Provider can open assigned orders, chat, mark completed, and leave/unassign themselves from an order.
  - If a booster leaves an order, the order can return to a pending/searching state and admin receives a notification.
- Added the **Customer Orders** direction:
  - Customers can view their own orders from the navbar (`My Orders`).
  - Customer can open an order and continue into the match/chat page.
  - Customer must always be able to chat on their own order.
- Wired the **MatchPage chat** into the real backend:
  - Replaced fake/local chat behavior with backend conversation/messages.
  - Messages display with correct sender ownership even after leaving/rejoining the page.
  - Admin messages show admin identity instead of `System`.
  - Chat supports customer, admin, and assigned booster access.
  - Added date separators when messages cross calendar days.
  - Improved chat message styling, scroll behavior, input bar, and sender/receiver colors.

### Frontend (Homepage/Auth UI)
- Built a premium, dark gaming-style homepage (“FastBoost”) with sections:
  - Navbar (anchors: Home / Services / Latest Patch / Status)
  - Hero banner + side feature card
  - Services section with hover-based service cards
  - Patch/news placeholder section
  - Backend status section
- Added **service ordering** on the homepage:
  1. Rank Boost
  2. Placement Boost
  3. Win Boost
  4. Pro Duo
- Improved the services fetch to handle either an array response or `{ services: [...] }`.
- Reworked auth into a modal flow:
  - Login modal
  - Register modal
  - Forgot password modal entry
  - Animated success state with green check
  - Auto-close after success
- Added auth UX improvements:
  - red field highlight for invalid login/register
  - auto-login after account creation
  - top-right profile avatar circle replaces Login button after login
  - default gray avatar icon when no profile image exists
  - logout dropdown menu

### Password reset flow
- Added backend forgot-password and reset-password routes:
  - `POST /api/auth/forgot-password`
  - `POST /api/auth/reset-password`
- Added `PasswordResetToken` database table using Prisma
- Implemented:
  - hashed reset tokens
  - expiry time
  - one-time-use reset links
  - Gmail SMTP / Nodemailer email sending
- Added frontend forgot-password entry from the auth modal
- Added dedicated `/reset-password` frontend route/page for:
  - strong password validation
  - red → green strength bar
  - rule checklist
  - confirm password validation
  - auto-login after reset

### Image hosting (Deploy-friendly)
- Created an AWS S3 bucket for **public website assets**:
  - Bucket: `fastboost-assets`
  - Folder: `services/`
  - Uploaded 4 service images:
    - `rank-boost.webp`
    - `placement-boost.webp`
    - `win-boost.png`
    - `hire-a-teammate.png`
- Added a second S3 asset folder for order configurator rank images:
  - Folder: `services/ranks/`
  - Uploaded rank images:
    - `iron.png`
    - `bronze.png`
    - `silver.png`
    - `gold.png`
    - `platinum.png`
    - `emerald.png`
    - `diamond.png`
    - `master.png`
- Verified S3 image URLs load in a browser.
- Updated frontend to use S3 image URLs per service title and rank selection.

### Order / configurator UI
- Replaced placeholder order flow with a real frontend demo flow:
  - service details page
  - service order page
  - demo match/chat page
- Built a live order configurator direction inspired by real gaming service checkouts.
- Added top service tabs on the order page:
  - Division
  - Placements
  - Ranked Wins
  - Pro Duo
- Removed unnecessary Platform field because this demo is LoL-focused.
- Added visual current rank / desired rank cards using S3-hosted rank images.
- Improved layout and alignment for:
  - Current LP
  - Queue Type
  - desired rank queue type
- Reworked the right checkout summary:
  - current → target strip
  - thinner Solo / Duo toggle
  - thinner Standard / Express toggle
  - add-ons grouped in the right summary column
  - different add-on layouts for Solo vs Duo
  - cleaner inline total price layout
  - CTA spacing cleanup
- Removed extra notes/comments box from the summary because the demo chat flow covers follow-up communication.

### Order creation / schema expansion
- Connected the configurator to a real backend demo order creation flow.
- Confirmed protected order submission works with authenticated user context.
- Expanded the `Order` direction beyond a minimal placeholder to include service-specific configuration fields such as:
  - boost type / play mode / region / queue type
  - current rank / target rank / LP-related fields
  - Master LP-related fields
  - placements / wins / number of games
  - first role / second role
  - selected champions
  - addon booleans
  - base price / addon price / total price
- Removed the older `preferredRole` direction in favor of separate `firstRole` and `secondRole` fields.

### Pricing logic progress
- Added pricing structure for division, placements, wins, and Pro Duo flows.
- Added LP-related helper logic and Master-specific pricing direction.
- Split Duo mode and Premium Coaching into separate concepts.
- Continued refining add-on pricing so duo-related add-ons can use duo-adjusted pricing instead of solo-only base pricing.
- Clarified that `appearOffline` is for Solo privacy, while Duo privacy should stay separate as `untrackableDuo`.
- Bonus win pricing is rank-based and still requires clean solo/duo handling in the latest pricing pass.

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

### Email
- Nodemailer
- Gmail SMTP App Password

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

### Auth
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/forgot-password`
- `POST /api/auth/reset-password`

### User / profile
- `GET /api/user/me` — current authenticated user with profile data
- `PATCH /api/user/me` — update username, email, and saved profile image URL
- `PATCH /api/user/me/password` — change authenticated user's password
- `POST /api/user/me/profile-picture` — upload profile picture to S3 and save `Profile.profileImageUrl`
- `GET /api/user/providers` — admin-only provider list for assignment

### Orders
- `POST /api/orders` — create order
- `GET /api/orders/my` — customer order list
- `GET /api/orders/:id` — order detail with access control
- `PATCH /api/orders/:id/login-info` — customer updates in-game name/password from MatchPage

### Admin orders
- `GET /api/orders/admin` — list all orders with filters
- `GET /api/orders/admin/:id` — admin order detail
- `PATCH /api/orders/admin/:id/status` — admin status update/override
- `GET /api/orders/:id/assignments` — list assigned boosters
- `POST /api/orders/:id/assign/:boosterId` — manual assign fallback
- `DELETE /api/orders/:id/assign/:boosterId` — admin unassign booster

### Provider / booster orders
- `GET /api/orders/provider/assigned` — provider assigned order list
- `PATCH /api/orders/:id/provider-complete` — provider marks assigned order completed
- `DELETE /api/orders/:id/provider-leave` — provider leaves/unassigns self from order

### Loyalty
- `GET /api/loyalty/me` — current user loyalty summary calculated from completed orders

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

---

## Environment variables

Create `server/.env`:

```env
DATABASE_URL="your_database_connection_string"
JWT_SECRET="your_secret_here"

APP_BASE_URL="http://localhost:5173"

SMTP_HOST="smtp.gmail.com"
SMTP_PORT="587"
SMTP_SECURE="false"
SMTP_USER="your_email_here"
SMTP_PASS="your_google_app_password"
SMTP_FROM="FastBoost <your_email_here>"

AWS_REGION="ca-central-1"
ORDER_PASSWORD_KMS_KEY_ID="alias/fastboost-order-passwords"
AWS_S3_ASSETS_BUCKET="fastboost-assets"

# Local development only.
# In deployment, prefer IAM role instead of long-lived keys.
AWS_ACCESS_KEY_ID="your_local_dev_access_key"
AWS_SECRET_ACCESS_KEY="your_local_dev_secret_key"
```

✅ Do **not** commit `.env` to GitHub.

Production note:
- Keep `AWS_REGION` and `ORDER_PASSWORD_KMS_KEY_ID`.
- Prefer IAM role credentials for deployed backend.
- Restrict KMS permissions to the exact key ARN before real launch.

---

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

### View database
```bash
npx prisma studio
```

---

## Current progress summary

### Done
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

### In progress
- final duplicate chat notification verification after clearing old unread records
- notification sender avatars using saved profile images
- final status automation cleanup across admin/provider/customer flows
- remaining shared navbar consistency polish across all protected pages
- pricing logic cleanup and verification
- duo-specific addon field cleanup, including `untrackableDuo`
- patch section real endpoint
- reveal/audit logging for viewed game credentials

---

## Next steps (recommended)

1. Test account settings end-to-end:
   - update username
   - update email
   - upload profile picture
   - confirm S3 object appears under `fastboost-assets/profiles/<userId>/`
   - confirm Account Settings preview updates
   - confirm Navbar avatar updates immediately
   - confirm refresh still shows the uploaded image
2. Test password change:
   - weak password should fail checklist
   - wrong current password should show an error
   - valid new password should save
   - logout and login with the new password
3. Test spend-based loyalty:
   - mark completed orders with different total prices
   - confirm completed spend controls Bronze/Silver/Gold/Platinum tier
   - confirm progress says “Spend $X more to reach Y tier”
   - confirm duplicate completed-spend text is removed from the Account Progress header
4. Add notification/chat sender avatars using saved `profile.profileImageUrl`.
5. Add credential reveal audit logging:
   - user id
   - role
   - order id
   - timestamp
   - action type
6. Restrict AWS permissions before real deployment:
   - exact KMS key ARN instead of `Resource: "*"`
   - backend IAM role instead of long-lived production keys
   - least-privilege S3 upload path permissions
7. Finish pricing logic cleanup:
   - solo/duo add-on pricing
   - bonus win pricing by rank
   - `untrackableDuo`
8. Connect the patch section to a real backend endpoint later.

## Resume-ready highlights

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
