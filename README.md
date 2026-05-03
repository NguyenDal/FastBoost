# Gaming Services Platform (FastBoost)

A full-stack portfolio project built with **React**, **Vite**, **Express**, **Prisma**, and **PostgreSQL**.

This project is a **game services marketplace demo** where users can register, log in securely, reset passwords by email, browse service types, configure a demo order, and continue into a demo match/chat flow. It’s being developed as a **software engineering portfolio project** to demonstrate a real full-stack workflow: UI → API → database → auth.

---

## What’s new (latest progress)

### Latest session update — Admin/Provider/Customer order management + real MatchPage chat
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
- Improved **MatchPage UI polish**:
  - Assigned booster card simplified by removing unnecessary role labels.
  - Chat card, order options card, overview card, login info card, and order summary card were restyled for a consistent dark/purple FastBoost theme.
  - Order options now show only enabled add-ons, displayed as compact cards in a two-column layout.
  - Overview card now shows quick order metadata like queue and region instead of duplicating service/total.
  - Login info card now uses a compact layout inspired by the reference card, while keeping the FastBoost theme.
- Added **order login info editing direction** on MatchPage:
  - MatchPage is the place where the customer enters/updates in-game name and game account password.
  - Backend route direction: `PATCH /api/orders/:id/login-info`.
  - Current security decision: do not hash game account passwords because boosters need to view them; for real business, implement AWS KMS envelope encryption before storing any customer game password.
- Added auth/session cleanup direction:
  - If token is expired or invalid, protected pages should clear local logged-in state and redirect to home instead of showing a broken logged-in page.
- Fixed several backend/frontend integration issues:
  - Route ordering for `/api/orders/provider/assigned` before `/:id`.
  - Prisma select issue caused by selecting non-existing `profileImage` directly on `User`.
  - `updateOrderLoginInfo` export issue caused by `module.exports` overwriting earlier exports.
  - Assignment accept 403 debugging caused by token user id / request booster id checks.
  - Notification type enum mismatch for assignment removal.


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
- Continued refining order payload structure so configurator selections can be stored more cleanly.

### Shared navbar / auth modal direction
- Continued moving away from page-specific fake top bars toward a shared navbar direction.
- Homepage remains the reference for the correct auth popup experience.
- Order page and match page work started toward using the same shared navbar/auth behavior.
- Current architectural direction is to keep a shared auth modal experience across pages instead of rebuilding separate auth UIs.

### Pricing logic progress
- Added pricing structure for division, placements, wins, and Pro Duo flows.
- Added LP-related helper logic and Master-specific pricing direction.
- Split Duo mode and Premium Coaching into separate concepts.
- Continued refining add-on pricing so duo-related add-ons can use duo-adjusted pricing instead of solo-only base pricing.
- Clarified that `appearOffline` is for Solo privacy, while Duo privacy should stay separate as `untrackableDuo`.
- Bonus win pricing is rank-based and still requires clean solo/duo handling in the latest pricing pass.

### Demo match/chat flow
- Added a follow-up demo page after the order flow.
- Current direction includes:
  - booster matched / searching state
  - assigned booster card
  - live chat-style layout
  - grouped order summary
  - demo order status presentation

### Chat backend (real-time + history)
- Added Socket.IO server with JWT-based auth (handshake `auth.token`).
- Introduced per-order Conversation with participants and message history.
- Access control: admin, order customer, and assigned boosters share the same chat.
- REST endpoints for history (cursor pagination) and fallback message posting.
- Admin endpoints to assign/unassign boosters to an order (controls booster chat access).

Data models (Prisma):
- `OrderAssignment` — links providers (boosters) to an order.
- `Conversation` — one conversation per order (`orderId` unique), `lastMessageAt` for sorting.
- `ConversationParticipant` — member list per conversation with `lastReadAt`.
- `Message` — chat messages indexed by `(conversationId, createdAt)`.

Socket events:
- `chat:join { orderId }` → validates access, ensures conversation + participant, joins room, returns last 20 messages.
- `chat:message { conversationId, content }` → validates membership, saves + broadcasts message.
- `chat:typing { conversationId, isTyping }` → ephemeral typing indicator to room participants.

### Notifications system
- Added backend notification routes:
  - `GET /api/notifications` — list user's active notifications
  - `PUT /api/notifications/:id/read` — mark notification as read
- Added `Notification` database table using Prisma with fields for userId, title, message, type, active status, and timestamps.
- Implemented notification creation for key events like order status changes and assignment requests.
- Added frontend notification display in the navbar with unread count indicator.

### Assignment requests system
- Added backend assignment request routes:
  - `POST /api/assignment-requests` — create a request to be assigned to an order
  - `GET /api/assignment-requests` — list assignment requests (admin view)
  - `PUT /api/assignment-requests/:id/approve` — approve assignment request (admin)
  - `PUT /api/assignment-requests/:id/reject` — reject assignment request (admin)
- Added `AssignmentRequest` database table linking boosters to orders with status (pending/approved/rejected).
- Implemented logic for providers to request assignments to available orders.
- Added admin endpoints to manage assignment requests and assign boosters to orders.

### Admin dashboard
- Added admin-specific pages:
  - AdminOrdersPage — view and manage all orders
  - AdminOrderDetailsPage — detailed view of individual orders with assignment management
- Implemented role-based access control with ADMIN role.
- Added admin routes for order management and assignment handling.
- Enhanced order status tracking and management capabilities.

### User profiles
- Added `Profile` database table for user profiles with displayName, bio, and timestamps.
- Implemented profile creation and management.
- Added profile-related routes and controllers.

### Provider and customer order management
- Added separate order pages:
  - CustomerOrdersPage — customers can view their orders
  - ProviderOrdersPage — providers can view assigned orders
- Implemented role-based order filtering and access control.
- Added order status updates and management for providers.

### Socket.IO integration
- Integrated Socket.IO for real-time features across the application.
- Added real-time updates for chat, notifications, and order status changes.
- Implemented JWT authentication for socket connections.

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

### Current service types
- Rank Boost
- Placement Boost
- Win Boost
- Pro Duo

### Important design decision
A **Service** is a **platform-wide service category**, not a user-owned listing.
- Service has no fixed price
- Service has no `ownerId`
- Pricing and request details will live on the **Order** later

---

## Tech Stack

### Frontend
- React
- Vite
- React Router

### Backend
- Node.js
- Express

### Database / ORM
- PostgreSQL
- Prisma 7

### Auth
- bcrypt
- JWT

### Email
- Nodemailer
- Gmail SMTP App Password

### Assets
- AWS S3

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

### Live chat (server) quick test
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
- `PUT /api/notifications/:id/read` — mark a notification as read
- Current frontend behavior: unread notifications glow; notifications are marked read after closing the drawer.

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
```

✅ Do **not** commit `.env` to GitHub.

---

## Database / Prisma

### Open Prisma Studio
```bash
cd server
npx prisma studio
```

### Prisma commands

Option A — Local development (recommended):
```bash
npx prisma migrate dev --name add-chat --schema=prisma/schema.prisma
npx prisma generate --schema=prisma/schema.prisma
```

Option B — Remote/shared database (cautious):
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
- login info card UI direction on MatchPage

### In progress
- secure storage for customer game login password
- AWS KMS envelope encryption design for production-grade credential storage
- login info edit/save flow final backend encryption pass
- final status automation cleanup across admin/provider/customer flows
- unread message count/blue indicator polishing
- shared navbar consistency across all protected pages
- pricing logic cleanup and verification
- duo-specific addon field cleanup, including `untrackableDuo`
- patch section real endpoint
- profile/account settings

---

## Next steps (recommended)

1. Implement production-grade game password protection before treating login info as real business data:
   - use AWS KMS customer-managed key
   - use envelope encryption
   - store encrypted password fields only
   - never store plaintext game passwords in PostgreSQL
2. Update Prisma order fields for encrypted login info:
   - `inGameName`
   - `accountPasswordCiphertext`
   - `accountPasswordEncryptedKey`
   - `accountPasswordIv`
   - `accountPasswordAuthTag`
   - `accountPasswordUpdatedAt`
3. Update `orderController.js` so `PATCH /api/orders/:id/login-info` encrypts before saving and only authorized users can decrypt/view.
4. Add reveal logging later:
   - who revealed credentials
   - when
   - order id
   - user role
5. Finish unread message tracking and blue message indicator in the navbar.
6. Continue pricing logic cleanup and verify all solo/duo/add-on rules.
7. Finish shared navbar/profile/account settings polish.
8. Connect the patch section to a real backend endpoint later.

---

## Author

**An Nguyen Nguyen**

Portfolio full-stack project built for learning, practice, and professional presentation on GitHub and LinkedIn.
