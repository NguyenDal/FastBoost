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

### Demo match/chat flow
- Added a follow-up demo page after the order flow.
- Current direction includes:
  - booster matched / searching state
  - assigned booster card
  - live chat-style layout
  - grouped order summary
  - demo order status presentation

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
For the current remote database workflow used in this project:

### Generate Prisma client
```bash
npx prisma db pull
npx prisma db push
npx prisma generate
```

`prisma migrate dev` was avoided for the live remote Prisma database after drift was detected, because resetting would have deleted data.

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
- demo match/chat page flow

### In progress
- real backend-driven order persistence
- real pricing logic
- patch section real endpoint
- additional profile dropdown polish
- match/chat UI polish

---

## Next steps (recommended)

1. Design and build the real `Order` schema for service-specific requests
2. Build order APIs + persistence
3. Connect the configurator UI to real backend order creation
4. Continue polishing the match/chat page
5. Connect the patch section to a real backend endpoint
6. Later add profile/account settings

---

## Author

**An Nguyen Nguyen**

Portfolio full-stack project built for learning, practice, and professional presentation on GitHub and LinkedIn.
