const prisma = require("../prisma");
const stripe = require("../utils/stripeClient");

function getUserId(req) {
  return req.user?.id || req.user?.userId;
}

function getClientUrl() {
  return process.env.CLIENT_URL || "http://localhost:5173";
}

const createCheckoutSession = async (req, res) => {
  try {
    const userId = getUserId(req);
    const { orderId } = req.body || {};

    if (!userId) {
      return res.status(401).json({
        ok: false,
        message: "Invalid user token",
      });
    }

    if (!orderId) {
      return res.status(400).json({
        ok: false,
        message: "orderId is required",
      });
    }

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        service: true,
        customer: {
          select: {
            id: true,
            email: true,
          },
        },
      },
    });

    if (!order) {
      return res.status(404).json({
        ok: false,
        message: "Order not found",
      });
    }

    if (String(order.customerId) !== String(userId)) {
      return res.status(403).json({
        ok: false,
        message: "You can only pay for your own order",
      });
    }

    if (order.paymentStatus === "PAID") {
      return res.status(400).json({
        ok: false,
        message: "This order has already been paid",
      });
    }

    const amountCents =
      order.amountCents || Math.round(Number(order.totalPrice || 0) * 100);

    if (!amountCents || amountCents < 50) {
      return res.status(400).json({
        ok: false,
        message: "Invalid order amount",
      });
    }

    const clientUrl = getClientUrl();

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_email: order.customer?.email || undefined,
      payment_method_types: ["card"],
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: order.currency || process.env.STRIPE_CURRENCY || "cad",
            unit_amount: amountCents,
            product_data: {
              name: order.service?.title || order.boostType || "FastBoost Order",
              description: `Order #${order.id.slice(0, 8).toUpperCase()}`,
            },
          },
        },
      ],
      metadata: {
        orderId: order.id,
        customerId: order.customerId,
      },
      success_url: `${clientUrl}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${clientUrl}/payment/cancelled?orderId=${order.id}`,
    });

    await prisma.order.update({
      where: { id: order.id },
      data: {
        stripeCheckoutSessionId: session.id,
        amountCents,
        currency: order.currency || process.env.STRIPE_CURRENCY || "cad",
      },
    });

    return res.json({
      ok: true,
      checkoutUrl: session.url,
      sessionId: session.id,
    });
  } catch (error) {
    console.error("createCheckoutSession error:", error);

    return res.status(500).json({
      ok: false,
      message: "Failed to create checkout session",
      error: error.message,
    });
  }
};

const handleStripeWebhook = async (req, res) => {
  const signature = req.headers["stripe-signature"];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.error("Missing STRIPE_WEBHOOK_SECRET in environment variables");
    return res.status(500).send("Webhook secret not configured");
  }

  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, signature, webhookSecret);
  } catch (error) {
    console.error("Stripe webhook signature verification failed:", error.message);
    return res.status(400).send(`Webhook Error: ${error.message}`);
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;

      const orderId = session.metadata?.orderId;
      const paymentIntentId =
        typeof session.payment_intent === "string"
          ? session.payment_intent
          : session.payment_intent?.id || null;

      if (!orderId) {
        console.warn("Stripe checkout.session.completed missing orderId metadata");
        return res.json({ received: true });
      }

      const updated = await prisma.order.updateMany({
        where: {
          id: orderId,
          stripeCheckoutSessionId: session.id,
          paymentStatus: {
            not: "PAID",
          },
        },
        data: {
          paymentStatus: "PAID",
          stripePaymentIntentId: paymentIntentId,
          paidAt: new Date(),
          amountCents: session.amount_total || undefined,
          currency: session.currency || "cad",
        },
      });

      console.log(
        `Stripe payment completed for order ${orderId}. Updated rows: ${updated.count}`
      );
    }

    if (event.type === "checkout.session.expired") {
      const session = event.data.object;
      const orderId = session.metadata?.orderId;

      if (orderId) {
        await prisma.order.updateMany({
          where: {
            id: orderId,
            stripeCheckoutSessionId: session.id,
            paymentStatus: "PENDING",
          },
          data: {
            paymentStatus: "CANCELLED",
          },
        });

        console.log(`Stripe checkout expired for order ${orderId}`);
      }
    }

    return res.json({ received: true });
  } catch (error) {
    console.error("Stripe webhook handling error:", error);
    return res.status(500).send("Webhook handler failed");
  }
};

module.exports = {
  createCheckoutSession,
  handleStripeWebhook,
};