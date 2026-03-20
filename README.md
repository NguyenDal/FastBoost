# Gaming Services Platform

A full-stack portfolio project built with **React**, **Vite**, **Express**, **Prisma**, and **PostgreSQL**.

This project is designed as a **game services marketplace demo platform** where users can browse services, place orders, and interact with different roles in the system. It is being developed as a **software engineering portfolio project** to demonstrate frontend development, backend API development, relational database design, Prisma ORM usage, and full-stack project setup.

---

## Project Purpose

This project was created as a **portfolio/demo application** to showcase practical software engineering skills.

The goal is to demonstrate experience in:

- building a modern frontend with React
- setting up a backend server with Express
- designing a relational database
- connecting to a remote PostgreSQL database
- using Prisma for schema management and migrations
- structuring a full-stack app with separate client and server folders
- preparing a project that can later be deployed online

This project is intended to be shown on **GitHub** and potentially referenced on **LinkedIn**.

---

## Project Concept

The project is framed as a:

- **Gaming Services Platform**
- **Game Coaching Marketplace Demo**
- **Gaming Services Marketplace**

The system is designed to support a marketplace-style structure where users can register, offer services, and place orders.

Planned roles include:

- **Customer**
- **Provider**
- **Admin**

Initial entities include:

- **User**
- **Profile**
- **Service**
- **Order**

---

## Tech Stack

### Frontend
- React
- Vite

### Backend
- Node.js
- Express

### Database
- PostgreSQL

### ORM
- Prisma

### Additional packages
- cors
- dotenv
- bcrypt
- jsonwebtoken
- nodemon

---

## Project Structure

```text
gaming-services-platform/
  client/                 # React frontend
  server/                 # Express backend + Prisma
  README.md
```

Inside `server/`:

```text
server/
  prisma/
    migrations/
    schema.prisma
  src/
    generated/
      prisma/
    app.js
    index.js
    prisma.js
  .env
  prisma.config.ts
  package.json
```

---

## What We Completed

### 1. Created the root project folder
We created the main project folder and initialized Git:

```bash
mkdir gaming-services-platform
cd gaming-services-platform
git init
```

---

### 2. Set up the React frontend
We created the frontend inside a `client` folder using Vite.

```bash
npm create vite@latest client -- --template react
```

At first, the setup failed because the machine had an older Node.js version that did not meet Vite’s requirement.

After upgrading Node.js, the React frontend was able to run successfully.

---

### 3. Created the backend
We created a separate `server` folder for the backend and initialized it with npm:

```bash
mkdir server
cd server
npm init -y
```

---

### 4. Installed backend dependencies
We installed the main backend packages:

```bash
npm install express cors dotenv prisma @prisma/client bcrypt jsonwebtoken
npm install -D nodemon @types/node
```

These packages are used for:

- **express**: backend API server
- **cors**: communication between frontend and backend on different local ports
- **dotenv**: environment variable loading
- **prisma**: Prisma CLI and schema/migration tool
- **@prisma/client**: generated Prisma client used in code
- **bcrypt**: future password hashing
- **jsonwebtoken**: future auth support
- **nodemon**: restart backend automatically during development
- **@types/node**: Node typings required by Prisma config tooling

---

### 5. Initialized Prisma
We ran:

```bash
npx prisma init
```

This created:

- `prisma/schema.prisma`
- `prisma.config.ts`
- `.env`

This project uses the newer Prisma setup where the database connection is configured in `prisma.config.ts`.

---

### 6. Set up a remote database
Initially, the environment file used a local Prisma dev-style URL, which caused migration errors.

To fix this, we created a hosted remote database using:

```bash
npx create-db
```

This gave us a real remote PostgreSQL connection string, which we placed in:

`server/.env`

---

### 7. Configured Prisma for Prisma 7
Prisma 7 no longer supports putting the datasource URL directly inside `schema.prisma`.

So instead of this older style:

```prisma
url = env("DATABASE_URL")
```

we moved the connection URL to:

`prisma.config.ts`

and kept `schema.prisma` focused on:

- datasource provider
- models
- enums

---

### 8. Designed the first database schema
We created the first relational schema using the following models:

- `User`
- `Profile`
- `Service`
- `Order`

And enums:

- `UserRole`
- `OrderStatus`

These provide the initial structure for a marketplace-style platform.

---

### 9. Ran the first migration
We successfully validated the schema, migrated the database, and generated the Prisma client:

```bash
npx prisma validate
npx prisma migrate dev --name init
npx prisma generate
```

This confirmed that:

- the schema is valid
- the remote database is connected
- the migration was applied
- the Prisma client was generated successfully

---

### 10. Created the Express backend files
We created the following backend files:

- `src/app.js`
- `src/index.js`
- `src/prisma.js`

These files handle:

- Express server setup
- route handling
- server startup
- Prisma client export

---

### 11. Updated backend scripts
We changed the backend `package.json` scripts to:

```json
"scripts": {
  "dev": "nodemon src/index.js",
  "start": "node src/index.js"
}
```

This allows the backend to run in development mode.

---

### 12. Started and tested the backend
We ran:

```bash
npm run dev
```

The backend started successfully on port `5000`.

We tested the health route:

```text
http://localhost:5000/api/health
```

and received:

```json
{"ok":true,"message":"Server is healthy"}
```

This confirmed that the backend is working correctly.

---

### 13. Ran the frontend and confirmed the local page
We ran the frontend with:

```bash
npm run dev
```

At one point, port `5173` was already in use, so Vite automatically switched to:

```text
http://localhost:5174/
```

This is normal behavior.

---

### 14. Prepared frontend-backend communication
We installed frontend packages for API calls and routing:

```bash
npm install axios react-router-dom
```

This prepares the frontend to call backend endpoints and support page routing in later steps.

---

## Current Status

### Working
- React frontend bootstrapped with Vite
- Express backend running
- Prisma configured successfully
- Remote PostgreSQL database connected
- First migration applied
- Prisma client generated
- Backend health endpoint working

### Next logical development steps
- connect the frontend visibly to the backend health route
- build user registration API
- hash passwords with bcrypt
- build login API
- add auth middleware
- create service routes
- create order routes
- build dashboards for customer, provider, and admin roles

---

## How to Run the Project

## 1. Open the frontend (client)
Open a terminal and run:

```bash
cd .../gaming-services-platform/client
npm install
npm run dev
```

The frontend usually runs at:

```text
http://localhost:5173/
```

If that port is already in use, Vite will automatically switch to another port, for example:

```text
http://localhost:5174/
```

Use the **Local** URL shown in the terminal.

---

## 2. Open the backend (server)
Open a second terminal and run:

```bash
cd .../gaming-services-platform/server
npm install
npm run dev
```

The backend runs at:

```text
http://localhost:5000/
```

The health check route is:

```text
http://localhost:5000/api/health
```

If the backend is running correctly, this route should return:

```json
{"ok":true,"message":"Server is healthy"}
```

---

## 3. Open the webpage
To view the actual frontend webpage, open the Vite frontend URL in the browser.

Examples:
- `http://localhost:5173/`
- `http://localhost:5174/`

Use whichever **Local** URL appears in the frontend terminal.

Important:
- `localhost:5000` = backend API
- `localhost:5173` or `localhost:5174` = frontend webpage

---

## 4. Keep both terminals open
During development, you should usually keep **two terminals** running:

### Terminal 1
Backend:
```bash
cd .../gaming-services-platform/server
npm run dev
```

### Terminal 2
Frontend:
```bash
cd .../gaming-services-platform/client
npm run dev
```

---

## How to View the Database

The easiest way to see the database is with **Prisma Studio**.

Open a terminal in the `server` folder and run:

```bash
cd .../gaming-services-platform/server
npx prisma studio
```

This will open Prisma Studio in your browser.

In Prisma Studio, you can:
- view tables
- view rows
- add records manually
- edit records
- delete records

Right now, you should at least see these tables:

- `User`
- `Profile`
- `Service`
- `Order`

If there is no data yet, the tables may appear empty, but they should still be visible.

---

## Environment Variables

Create a file:

`server/.env`

and add:

```env
DATABASE_URL="your_database_connection_string"
```

Important:
- do not commit real credentials to GitHub
- if a DB credential gets exposed, rotate or replace it

---

## Prisma Commands

### Validate the schema
```bash
npx prisma validate
```

### Run database migration
```bash
npx prisma migrate dev --name init
```

### Generate Prisma client
```bash
npx prisma generate
```

### View database in browser
```bash
npx prisma studio
```

---

## API Routes Available Right Now

### Root route
```http
GET /
```

Response:
```json
{ "message": "API is running" }
```

### Health route
```http
GET /api/health
```

Response:
```json
{ "ok": true, "message": "Server is healthy" }
```

---

## Database Schema Summary

### User
Represents an account in the platform.

Fields include:
- id
- email
- passwordHash
- role
- createdAt
- updatedAt

### Profile
Stores optional profile information for a user.

Fields include:
- id
- userId
- displayName
- bio
- createdAt
- updatedAt

### Service
Represents a service offered by a provider.

Fields include:
- id
- title
- description
- price
- ownerId
- createdAt
- updatedAt

### Order
Represents a customer order for a service.

Fields include:
- id
- customerId
- serviceId
- notes
- status
- createdAt
- updatedAt

---

## Development Notes

### Frontend and backend run on different ports
This project currently uses a split full-stack development setup:

- frontend on a Vite port
- backend on port `5000`

This is normal in development.

### Why Vite?
Vite is a faster and more modern option for new React projects. It offers:
- fast startup
- quick rebuilds
- clean development experience

### Why PostgreSQL?
This project uses relational data with connected entities such as:
- users
- profiles
- services
- orders

PostgreSQL is a strong choice for structured relational applications.

### Why Prisma?
Prisma helps with:
- schema design
- migrations
- typed database access
- database inspection
- keeping app structure and DB structure aligned

---

## Security Notes

### Passwords
Passwords should never be stored in plain text.

This project already includes `bcrypt` for hashing passwords in future auth features.

### Secrets
Database credentials should remain in `.env` and should not be pushed to GitHub.

### Exposed credentials
If a connection string is ever exposed during development, it should be considered compromised and rotated.

---

## Future Improvements

Planned next features include:

- user registration
- login
- password hashing
- JWT authentication
- protected routes
- service creation
- service listing
- order creation
- role-based dashboards
- reviews
- admin management
- deployment

---

## Learning Outcomes From This Setup

This setup provided practical experience with:

- Git project initialization
- creating a React app with Vite
- troubleshooting Node/Vite version issues
- setting up an Express backend
- installing and organizing backend dependencies
- initializing Prisma
- dealing with Prisma 7 configuration changes
- creating a hosted remote database
- designing a relational schema
- running migrations
- generating Prisma Client
- testing backend routes
- running frontend and backend together locally
- viewing the database using Prisma Studio

This gives the project a strong full-stack starting point and a solid foundation for future development.

---

## Author

**An Nguyen Nguyen**

Portfolio full-stack project built for learning, practice, and professional presentation on GitHub and LinkedIn.
