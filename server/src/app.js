const express = require("express");
const cors = require("cors");

const authRoutes = require("./routes/authRoutes");
const serviceRoutes = require("./routes/serviceRoutes");
const userRoutes = require("./routes/userRoutes");
const orderRoutes = require("./routes/orderRoutes");
const chatRoutes = require("./routes/chatRoutes");
const assignmentRequestRoutes = require("./routes/assignmentRequestRoutes");
const notificationRoutes = require("./routes/notificationRoutes");
const loyaltyRoutes = require("./routes/loyaltyRoutes");
const referralRoutes = require("./routes/referralRoutes");
const adminUserRoutes = require("./routes/adminUserRoutes");
const paymentRoutes = require("./routes/paymentRoutes");
const contactRoutes = require("./routes/contactRoutes");
const priceRoutes = require("./routes/priceRoutes");
const pricingRoutes = require("./routes/pricingRoutes");
const { handleStripeWebhook } = require("./controllers/paymentController");

const app = express();

app.use(cors());

// Stripe webhook must use raw body and must be mounted before express.json()
app.post(
  "/api/payments/webhook",
  express.raw({ type: "application/json" }),
  handleStripeWebhook
);

app.use(express.json());

app.get("/", (req, res) => {
  res.json({ message: "API is running" });
});

app.get("/api/health", (req, res) => {
  res.json({ ok: true, message: "Server is healthy" });
});

app.use("/api/auth", authRoutes);
app.use("/api/services", serviceRoutes);
app.use("/api/user", userRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/chats", chatRoutes);
app.use("/api/assignment-requests", assignmentRequestRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/loyalty", loyaltyRoutes);
app.use("/api/referrals", referralRoutes);
app.use("/api/admin", adminUserRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/contact", contactRoutes);
app.use("/api/admin/prices", priceRoutes);
app.use("/api/pricing", pricingRoutes);

module.exports = app;
