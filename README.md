# Gaming Services Platform (FastBoost)

A full-stack portfolio project built with **React**, **Vite**, **Express**, **Prisma**, and **PostgreSQL**.

This project is a **game services marketplace demo** where users can register, log in securely, reset passwords by email, browse service types, configure a demo order, continue into a match/chat flow, and manage role-based order communication. It’s being developed as a **software engineering portfolio project** to demonstrate a real full-stack workflow: UI → API → database → auth → secure credential storage → real-time chat.

---

## What’s new (latest progress)

### Latest session update — Admin Management Utilities, Account Management, privilege changes, suspension flow, and suspended-login modal

#### Admin navbar and Management Utilities hub
- Replaced the old admin navbar entry from **Order Manager** to **Management Utilities**.
- Added a new protected admin utilities route:
  - `/admin/management`
- Added a new Management Utilities hub page with scalable admin cards:
  - Order Management
  - Account Management
  - Booster Management
  - Service Management
  - Event Management
  - Update Management
  - FAQ Management
- Connected the **Order Management** card to the existing admin order manager route:
  - `/admin/orders`
- Connected the **Account Management** card to the new account management route:
  - `/admin/accounts`
- Left the remaining management cards as display-only / future utilities so the admin hub already looks scalable without implementing everything at once.

#### Account Management page
- Added a protected admin-only **Account Management** page.
- Added user search/filter support through the new admin account API.
- Displayed account data in an admin table:
  - User/avatar
  - Email
  - Email verification status
  - Account status
  - Current role
  - Change privilege
  - Account action
  - Created date
- Removed the unnecessary order-count column because Account Management is focused on privileges and account status.
- Added role display badges for:
  - Customer
  - Booster / Provider
  - Admin
- Added account status badges:
  - Active
  - Suspended
- Prevented admins from changing or suspending their own account from this page.

#### Admin account APIs
- Added admin account-management API helpers and backend routes.
- Added admin-only user listing:
  - `GET /api/admin/users`
- Added admin-only role update:
  - `PATCH /api/admin/users/:userId/role`
- Added admin-only suspension/restore update:
  - `PATCH /api/admin/users/:userId/suspension`
- Reused existing `protect` and `adminOnly` middleware instead of creating duplicate auth middleware.
- Fixed backend module-format issues by using CommonJS style imports/exports to match the current Express backend.
- Fixed Prisma field mismatch by using `emailVerifiedAt` instead of the non-existent `emailVerified` field.
- Added `suspendedAt` and `suspendedReason` fields to the `User` model direction for soft suspension.

#### Role privilege change modal
- Replaced the browser `window.confirm()` role-change popup with a custom modern confirmation modal.
- Added a circular countdown timer for role changes.
- Added automatic cancel when the countdown reaches zero.
- Added No / Yes actions below the timer.
- Added saving state with animated spinner.
- Added success state where the timer area transitions into a green check animation.
- Changed the success message from a page-level text banner into the modal itself.
- Added auto-close after 5 seconds on successful privilege update.
- Kept role-update success state polished while still updating the table row immediately.

#### Account suspension and restore flow
- Added suspend/restore controls to Account Management.
- Replaced the browser confirmation popup for suspension/restore with a custom modal.
- Added a red **No Entry / suspension** icon direction for suspension confirmation.
- Added a red circular countdown ring for suspension confirmation:
  - countdown ring decreases visually
  - no number in the center
  - center keeps a horizontal dash
  - timer auto-cancels if no action is taken
- Added suspension success animation:
  - red circle redraws
  - horizontal bar transitions into a diagonal slash
  - success message says the user is suspended
  - modal auto-closes after 5 seconds
- Added restore confirmation animation:
  - starts from the blocked/slash visual direction
  - transitions to a green countdown ring
  - slash compresses/fades away
  - countdown number appears inside the green circle
  - timer auto-cancels if no action is taken
- Cleaned the restore countdown CSS so the green ring behaves like the red countdown ring and does not leave an extra full green border on the empty counted section.
- Kept successful restore confirmation as the existing green check animation and auto-close behavior.

#### Suspended login handling
- Updated backend login behavior so suspended users cannot log in.
- Added backend response code direction:
  - `ACCOUNT_SUSPENDED`
- Login only reveals suspended status after correct email/password validation, avoiding unnecessary account-status leakage.
- Added homepage login handling for suspended accounts.
- Replaced normal login error text for suspended accounts with a custom animated popup.
- Suspended login popup shows:
  - animated lock/access-restricted icon
  - “Account Suspended” message
  - suspension reason text
  - close/understand action
- Kept normal invalid email/password handling unchanged for non-suspended login failures.

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
- `GET /api/referrals/public/:referralCode` — public inviter preview for private invite registration

### Auth
- `POST /api/auth/register` — supports optional `referralCode` for private invite registration
- `POST /api/auth/login`
- `POST /api/auth/forgot-password`
- `POST /api/auth/reset-password`

### User / profile
- `GET /api/user/me` — current authenticated user with profile data
- `PATCH /api/user/me` — update username, email, and saved profile image URL
- `PATCH /api/user/me/password` — change authenticated user's password
- `POST /api/user/me/email-verification/send` — send a 6-digit email verification code
- `POST /api/user/me/email-verification/confirm` — confirm the email verification code and mark email verified
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

### Admin account management
- `GET /api/admin/users?page=1&pageSize=20&q=<search>&role=<role>` — admin-only user list/search for Account Management
- `PATCH /api/admin/users/:userId/role` — admin-only privilege update for Customer / Provider-Booster / Admin
- `PATCH /api/admin/users/:userId/suspension` — admin-only suspend/restore account status update

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
- final duplicate chat notification verification after clearing old unread records
- notification sender avatars using saved profile images
- final status automation cleanup across admin/provider/customer flows
- remaining shared navbar consistency polish across all protected pages
- final TFT and LoL pricing verification with real order tests
- duo-specific addon field cleanup, including `untrackableDuo`
- FastBoost Updates real endpoint/pages for Latest Event, Latest Updates, and FAQ / Help
- reveal/audit logging for viewed game credentials

---

## Next steps (recommended)

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

## Resume-ready highlights

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
