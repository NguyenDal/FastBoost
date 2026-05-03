# Gaming Services Platform (FastBoost)

A full-stack portfolio project built with **React**, **Vite**, **Express**, **Prisma**, and **PostgreSQL**.

This project is a **game services marketplace demo** where users can register, log in securely, reset passwords by email, browse service types, configure a demo order, and continue into a demo match/chat flow. It’s being developed as a **software engineering portfolio project** to demonstrate a real full-stack workflow: UI → API → database → auth.

---

## What’s new (latest progress)

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

### Protected
- `GET /api/user/me` (Bearer token)
- `POST /api/services` (Bearer token + ADMIN role)
- `POST /api/orders` (Bearer token)
- `GET /api/orders` (Bearer token)
- `GET /api/orders/:id` (Bearer token)

### Admin (booster assignment)
- `GET /api/orders/:id/assignments` (ADMIN) — list assigned boosters
- `POST /api/orders/:id/assign/:boosterId` (ADMIN) — assign a booster
- `DELETE /api/orders/:id/assign/:boosterId` (ADMIN) — unassign a booster

### Chat
- `GET /api/chats/orders/:orderId` — ensure/get conversation for an order; returns participants
- `GET /api/chats/conversations/:conversationId/messages?limit=20&cursor=<id>` — paginated history (newest→older)
- `POST /api/chats/conversations/:conversationId/messages` — post a message (REST fallback)

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
- homepage UI structure
- hover-based featured services
- service ordering
- S3-hosted service images
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
- shared navbar/auth direction started across pages
- demo match/chat page flow

### In progress
- shared auth modal consistency across all pages
- real pricing logic cleanup and verification
- duo-specific addon field cleanup (including `untrackableDuo`)
- patch section real endpoint
- additional profile dropdown/navbar polish on later pages
- match/chat UI polish

---

## Next steps (recommended)

1. Build Admin Management UI to assign/unassign boosters to orders (uses the new admin endpoints)
2. Wire frontend chat to the backend: join by `orderId`, render history (cursor), send messages, typing state
3. Finish shared navbar/auth modal consistency on all key pages
4. Continue cleaning pricing logic and verify all duo/solo addon rules
5. Finalize the real `Order` schema + payload parity across frontend/backend
6. Connect the patch section to a real backend endpoint
7. Later add profile/account settings

---

## Author

**An Nguyen Nguyen**

Portfolio full-stack project built for learning, practice, and professional presentation on GitHub and LinkedIn.
