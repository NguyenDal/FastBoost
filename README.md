# Gaming Services Platform (SquadBoost)

A full-stack portfolio project built with **React**, **Vite**, **Express**, **Prisma**, and **PostgreSQL**.

This project is a **game services marketplace demo** where users can register, log in securely, browse service types, and (next) place customized service orders. It’s being developed as a **software engineering portfolio project** to demonstrate a real full‑stack workflow: UI → API → database → auth.

---

## What’s new (today)

### Frontend (Homepage/UI)
- Built a premium, dark gaming-style homepage (“SquadBoost”) with sections:
  - Navbar (anchors: Home / Services / Latest Patch / Status)
  - Hero banner + side feature card
  - Services section with hover-based service cards (title + description + actions on hover)
  - Patch/news placeholder section
  - Backend status section
- Added **service ordering** on the homepage:
  1. Rank Boost
  2. Placement Boost
  3. Win Boost
  4. Hire a Teammate
- Improved the services fetch to handle either an array response or `{ services: [...] }`.

### Image hosting (Deploy-friendly)
- Created an AWS S3 bucket for **public website assets**:
  - Bucket: `squadboost-assets`
  - Folder: `services/`
  - Uploaded 4 service images:
    - `rank-boost.png`
    - `placement-boost.webp`
    - `win-boost.png`
    - `hire-a-teammate.png`
- Verified S3 image URLs load in a browser (public access configured).
- Updated frontend to use S3 image URLs per service title (fallback still supported).

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

### Current service types
- Rank Boost
- Placement Boost
- Win Boost
- Hire a Teammate

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

### Backend
- Node.js
- Express

### Database / ORM
- PostgreSQL
- Prisma 7

### Auth
- bcrypt
- JWT

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

### Protected
- `GET /api/user/me` (Bearer token)
- `POST /api/services` (Bearer token + ADMIN role)

---

## Environment variables

Create `server/.env`:
```env
DATABASE_URL="your_database_connection_string"
JWT_SECRET="your_secret_here"
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
```bash
npx prisma validate
npx prisma migrate dev --name your_migration_name
```

### Generate Prisma client
```bash
npx prisma generate
```

### View database
```bash
npx prisma studio
```

---

## Next steps (recommended)

1. Replace alert() buttons:
   - “Order Now” should navigate to a service order page/flow
   - “Details” should open a service details page/modal
2. Build Login/Register UI pages and connect to existing auth APIs
3. Redesign `Order` schema (service-specific fields, quoting, etc.)
4. Build order APIs + order UI flow
5. (Later) Patch section: connect to a real backend endpoint

---

## Author

**An Nguyen Nguyen**

Portfolio full-stack project built for learning, practice, and professional presentation on GitHub and LinkedIn.
