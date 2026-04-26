# Server API Docs (Admin Order Management)

Base URL: `http://localhost:5000/api`

Auth: Send `Authorization: Bearer <JWT>` header. Admin endpoints require `role=ADMIN` in token payload.

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
