# Gaming Services Platform (FastBoost)

A full-stack portfolio project built with **React**, **Vite**, **Express**, **Prisma**, and **PostgreSQL**.

This project is a **game services marketplace demo** where users can register, log in securely, reset passwords by email, browse service types, configure a demo order, continue into a match/chat flow, and manage role-based order communication. It’s being developed as a **software engineering portfolio project** to demonstrate a real full-stack workflow: UI → API → database → auth → secure credential storage → real-time chat.

---

## What’s new (latest progress)

### Latest session update — Secure order credentials, chat notifications, smart chat UX, and MatchPage layout polish

#### Secure game account login info with AWS KMS
- Finished the production-grade direction for storing customer game account passwords.
- Confirmed the correct security decision:
  - **User account passwords** are hashed with bcrypt.
  - **Customer game account passwords** cannot be hashed because assigned boosters/admins need to view them.
  - Game account passwords are protected using **AWS KMS envelope encryption** with local **AES-256-GCM** encryption.
- Added/verified encrypted order password utility:
  - `server/src/utils/orderPasswordCrypto.js`
  - Uses AWS KMS `GenerateDataKeyCommand`.
  - Uses local `aes-256-gcm` encryption.
  - Stores only encrypted password fields:
    - `accountPasswordCiphertext`
    - `accountPasswordEncryptedKey`
    - `accountPasswordIv`
    - `accountPasswordAuthTag`
    - `accountPasswordUpdatedAt`
  - Decrypts through KMS only when authorized order detail access needs to reveal the password.
  - Strips encrypted password fields from normal/list responses.
- Added/verified secure environment config:
  - `server/src/config/env.js`
  - Requires:
    - `DATABASE_URL`
    - `JWT_SECRET`
    - `AWS_REGION`
    - `ORDER_PASSWORD_KMS_KEY_ID`
- Created and configured AWS resources for local development:
  - KMS customer-managed symmetric key:
    - `alias/fastboost-order-passwords`
  - Dedicated IAM user:
    - `fastboost-local-kms-user`
  - Access key/secret key for local development only.
  - KMS permissions for local testing:
    - `kms:GenerateDataKey`
    - `kms:Decrypt`
    - `kms:DescribeKey`
- Confirmed local KMS credential setup works:
  - `AWS_REGION=ca-central-1`
  - `ORDER_PASSWORD_KMS_KEY_ID=alias/fastboost-order-passwords`
  - valid `AKIA...` access key
  - valid 40-character secret key
- Clarified deployment-ready direction:
  - Local development can use IAM access keys.
  - Real production should use an IAM role attached to the deployed backend whenever possible.
  - Production KMS policy should restrict `Resource` to the exact KMS key ARN instead of `*`.
  - `.env` must never be committed.

#### Login info frontend/backend safety
- Confirmed `PATCH /api/orders/:id/login-info` is the correct route for customers to update in-game name/password from MatchPage.
- Confirmed the frontend API helper does not store game passwords in `localStorage`.
- Updated MatchPage login info behavior:
  - Password field should not be prefilled with decrypted password.
  - Blank password input keeps the current encrypted password.
  - Only sends `accountPassword` when the user types a new value.
  - Placeholder explains “Leave blank to keep current password.”
  - Backend responses avoid returning raw AWS/KMS errors to the frontend.

#### Chat notification system
- Added chat notification type direction:
  - `NotificationType.CHAT_MESSAGE`
- Added/reworked chat notification helper:
  - `server/src/utils/chatNotifications.js`
  - Creates chat notifications for conversation participants **except the sender**.
  - Notification data includes:
    - `conversationId`
    - `messageId`
    - `orderId`
    - `orderNumber`
    - `boostType`
    - `senderId`
    - `senderName`
    - `senderInitial`
    - `targetPath: /match/:orderId`
- Ensured chat notifications are generated after messages are created through:
  - REST fallback chat controller
  - Socket.IO chat message handler
- Added separation between normal notifications and chat/message notifications in the navbar:
  - Bell notification count excludes `CHAT_MESSAGE`.
  - Message icon/count tracks only `CHAT_MESSAGE`.
  - Closing the bell panel marks only normal notifications read.
  - Closing the message panel marks only chat notifications read.
- Added route/controller support:
  - `PATCH /api/notifications/messages/read-all`
- Improved notification click behavior:
  - Clicking a chat notification navigates to the related MatchPage:
    - `/match/:orderId`
  - Added fallback navigation using `orderId` if `targetPath` is missing.
- Started duplicate notification cleanup logic:
  - For the same unread conversation, only one chat notification should remain visible.
  - If many messages arrive from the same person in the same chat before the receiver opens the message panel, only the first unread notification should be created.
  - After the user opens/closes the message panel and marks it read, a later message can create a new notification.

#### Message notification card UI
- Reworked message notification card design to imitate the existing notification card shape rather than using a separate strong style.
- Kept content different from the normal notification card:
  - sender initial/avatar area
  - sender name
  - boost/order title
  - order number
  - first message preview
  - timestamp
- Changed fallback avatar styling:
  - Removed strong purple/red fallback avatar.
  - Used a softer blue MatchPage-style profile icon when the sender has no picture.
- Kept the visual theme consistent with FastBoost’s dark UI.

#### MatchPage chat access and UX fixes
- Fixed chat input over-restriction:
  - Customer/booster/admin chat should not be blocked by fragile frontend role/assignment checks.
  - Final frontend rule: if the logged-in user can load the order conversation, the chat input can be enabled.
  - Backend remains the real security layer.
- Fixed message ownership comparison:
  - Uses string-safe ID comparison so customer/booster messages display on the correct side.
- Added smart chat scrolling:
  - Sending your own message scrolls to the bottom.
  - If you are already near the bottom and someone replies, it stays near the bottom.
  - If you are reading older messages and many new messages arrive, the chat message container scrolls to the **first new message from the other person**, not all the way to the bottom.
  - The custom chat scrollbar/slider follows the chat message container position.
  - Scroll position is saved in `sessionStorage` per order and restored when returning.
- Fixed compile issues caused by:
  - referencing `updateChatScrollbar` before initialization
  - duplicate `updateChatScrollbar` declarations

#### MatchPage layout polish
- Removed the redundant **Order Summary** sidebar card.
- Moved the existing **Overview** card into the sidebar area while keeping the same Overview styling.
- Compressed the Overview card in the sidebar using the existing classes:
  - `order-overview-card`
  - `order-overview-grid`
  - `overview-pill`
  - `overview-icon`
- Final MatchPage layout direction:
  - Left/main panel:
    - Chat
    - Order Options
  - Right/sidebar:
    - Booster/Profile card
    - Login Info card
    - Overview card
- Total price/status remain available in stronger top/banner areas instead of being duplicated in a small Order Summary block.

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
- AWS S3 for public website/rank assets
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
- `GET /api/user/me` — current authenticated user
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

### In progress
- final duplicate chat notification verification after clearing old unread records
- profile image support for notification sender avatars
- final status automation cleanup across admin/provider/customer flows
- shared navbar consistency across all protected pages
- pricing logic cleanup and verification
- duo-specific addon field cleanup, including `untrackableDuo`
- patch section real endpoint
- profile/account settings
- reveal/audit logging for viewed game credentials

---

## Next steps (recommended)

1. Verify chat notification duplicate behavior with clean notification rows:
   - clear old unread duplicate `CHAT_MESSAGE` records
   - send multiple messages from booster/customer
   - confirm only one unread chat notification appears per conversation
2. Add profile image support later:
   - store profile image URL in `Profile`
   - include it safely in chat notification data
   - render image if present, fallback to blue initial avatar
3. Add credential reveal audit logging:
   - user id
   - role
   - order id
   - timestamp
   - action type
4. Restrict KMS permissions before real deployment:
   - exact KMS key ARN instead of `Resource: "*"`
   - backend IAM role instead of long-lived production keys
5. Finish pricing logic cleanup:
   - solo/duo add-on pricing
   - bonus win pricing by rank
   - `untrackableDuo`
6. Finish shared navbar/profile/account settings polish.
7. Connect the patch section to a real backend endpoint later.

---

## Resume-ready highlights

- Implemented AWS KMS envelope encryption with AES-256-GCM to protect customer order credentials, storing only ciphertext, encrypted data keys, IVs, and auth tags in PostgreSQL.
- Built role-aware real-time order chat using Socket.IO, Express, Prisma, and PostgreSQL.
- Added chat notification workflow that excludes the sender, separates message alerts from system notifications, and routes users directly to the related MatchPage conversation.
- Built admin/provider/customer order-management flows with assignment requests, accept/decline/revoke behavior, status transitions, and protected role-based access.
- Designed a polished dark gaming marketplace UI with React, Vite, reusable layout components, S3-hosted assets, and responsive MatchPage panels.

---

## Author

**An Nguyen Nguyen**

Portfolio full-stack project built for learning, practice, and professional presentation on GitHub and LinkedIn.
