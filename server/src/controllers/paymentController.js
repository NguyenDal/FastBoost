const prisma = require("../prisma");
const stripe = require("../utils/stripeClient");

function getUserId(req) {
    return req.user?.id || req.user?.userId;
}

function getClientUrl() {
    return process.env.CLIENT_URL || "http://localhost:5173";
}

async function getAvailableGold(userId) {
    const completedOrders = await prisma.order.findMany({
        where: {
            customerId: userId,
            status: "COMPLETED",
            paymentStatus: "PAID",
        },
        select: {
            totalPrice: true,
        },
    });

    const completedOrderGold = completedOrders.reduce((sum, order) => {
        return sum + Math.floor(Number(order.totalPrice || 0));
    }, 0);

    const rewardStats = await prisma.rewardHistory.aggregate({
        where: {
            userId,
        },
        _sum: {
            goldAmount: true,
        },
    });

    const rewardGold = Number(rewardStats._sum.goldAmount || 0);

    return Math.max(0, completedOrderGold + rewardGold);
}

function normalizeGoldToUse(rawGoldToUse, availableGold, totalAmountCents) {
    let requestedGold = Math.floor(Number(rawGoldToUse || 0));

    if (!Number.isFinite(requestedGold) || requestedGold < 0) {
        requestedGold = 0;
    }

    requestedGold = Math.min(requestedGold, availableGold);

    // 1 gold = $0.10 = 10 cents
    const maxRedeemableGoldByOrder = Math.floor(totalAmountCents / 10);
    requestedGold = Math.min(requestedGold, maxRedeemableGoldByOrder);

    let discountCents = requestedGold * 10;
    let cashAmountCents = Math.max(0, totalAmountCents - discountCents);

    // Stripe card payments cannot be too tiny.
    // If remaining cash is below $0.50, reduce redemption enough to make cash valid,
    // unless gold fully covers the order.
    if (cashAmountCents > 0 && cashAmountCents < 50 && requestedGold > 0) {
        const neededCentsBack = 50 - cashAmountCents;
        const goldToRemove = Math.ceil(neededCentsBack / 10);

        requestedGold = Math.max(0, requestedGold - goldToRemove);
        discountCents = requestedGold * 10;
        cashAmountCents = Math.max(0, totalAmountCents - discountCents);
    }

    return {
        goldRedeemed: requestedGold,
        goldDiscountCents: discountCents,
        cashAmountCents,
    };
}

const createCheckoutSession = async (req, res) => {
    try {
        const userId = getUserId(req);
        const { orderId, goldToUse } = req.body || {};

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

        const availableGold = await getAvailableGold(userId);

        const {
            goldRedeemed,
            goldDiscountCents,
            cashAmountCents,
        } = normalizeGoldToUse(goldToUse, availableGold, amountCents);

        if (!amountCents || amountCents < 50) {
            return res.status(400).json({
                ok: false,
                message: "Invalid order amount",
            });
        }

        const clientUrl = getClientUrl();

        if (cashAmountCents <= 0) {
            await prisma.$transaction([
                prisma.order.update({
                    where: { id: order.id },
                    data: {
                        paymentStatus: "PAID",
                        paidAt: new Date(),
                        amountCents,
                        cashAmountCents: 0,
                        goldRedeemed,
                        goldDiscountCents,
                        currency: order.currency || process.env.STRIPE_CURRENCY || "cad",
                    },
                }),
                ...(goldRedeemed > 0
                    ? [
                        prisma.rewardHistory.create({
                            data: {
                                userId,
                                type: "ORDER_REDEMPTION",
                                goldAmount: -goldRedeemed,
                                title: "Gold redeemed for order",
                                description: `Used ${goldRedeemed} gold for order #${order.id
                                    .slice(0, 8)
                                    .toUpperCase()}.`,
                                sourceUserId: order.id,
                            },
                        }),
                    ]
                    : []),
            ]);

            return res.json({
                ok: true,
                paidWithGoldOnly: true,
                orderId: order.id,
                redirectUrl: `${clientUrl}/payment/success/${order.serviceId}?orderId=${order.id}&gold=1`,
            });
        }

        const session = await stripe.checkout.sessions.create({
            mode: "payment",
            customer_email: order.customer?.email || undefined,
            payment_method_types: ["card"],
            line_items: [
                {
                    quantity: 1,
                    price_data: {
                        currency: order.currency || process.env.STRIPE_CURRENCY || "cad",
                        unit_amount: cashAmountCents,
                        product_data: {
                            name: order.service?.title || order.boostType || "FastBoost Order",
                            description:
                                goldRedeemed > 0
                                    ? `Order #${order.id.slice(0, 8).toUpperCase()} • ${goldRedeemed} gold applied`
                                    : `Order #${order.id.slice(0, 8).toUpperCase()}`,
                        },
                    },
                },
            ],
            metadata: {
                orderId: order.id,
                customerId: order.customerId,
                goldRedeemed: String(goldRedeemed),
                goldDiscountCents: String(goldDiscountCents),
                cashAmountCents: String(cashAmountCents),
            },
            success_url: `${clientUrl}/payment/success/${order.serviceId}?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${clientUrl}/payment/cancelled/${order.serviceId}?orderId=${order.id}`,
        });

        await prisma.order.update({
            where: { id: order.id },
            data: {
                stripeCheckoutSessionId: session.id,
                amountCents,
                cashAmountCents,
                goldRedeemed,
                goldDiscountCents,
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

const verifyCheckoutSession = async (req, res) => {
    try {
        const userId = getUserId(req);
        const { sessionId, orderId } = req.query || {};

        if (!userId) {
            return res.status(401).json({
                ok: false,
                message: "Invalid user token",
            });
        }

        if (!sessionId && !orderId) {
            return res.status(400).json({
                ok: false,
                message: "sessionId or orderId is required",
            });
        }

        const order = await prisma.order.findFirst({
            where: {
                customerId: userId,
                ...(sessionId
                    ? { stripeCheckoutSessionId: sessionId }
                    : { id: orderId }),
            },
            select: {
                id: true,
                customerId: true,
                paymentStatus: true,
                status: true,
                paidAt: true,
                stripeCheckoutSessionId: true,
            },
        });

        if (!order) {
            return res.status(404).json({
                ok: false,
                message: "Order not found",
            });
        }

        return res.json({
            ok: true,
            orderId: order.id,
            paymentStatus: order.paymentStatus,
            paid: order.paymentStatus === "PAID",
            orderStatus: order.status,
            paidAt: order.paidAt,
        });
    } catch (error) {
        console.error("verifyCheckoutSession error:", error);

        return res.status(500).json({
            ok: false,
            message: "Failed to verify checkout session",
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

            const order = await prisma.order.findFirst({
                where: {
                    id: orderId,
                    stripeCheckoutSessionId: session.id,
                },
                select: {
                    id: true,
                    customerId: true,
                    paymentStatus: true,
                    goldRedeemed: true,
                    goldDiscountCents: true,
                },
            });

            if (!order || order.paymentStatus === "PAID") {
                return res.json({ received: true });
            }

            await prisma.$transaction([
                prisma.order.update({
                    where: {
                        id: order.id,
                    },
                    data: {
                        paymentStatus: "PAID",
                        stripePaymentIntentId: paymentIntentId,
                        paidAt: new Date(),
                        amountCents: session.amount_subtotal
                            ? Number(session.amount_subtotal) + Number(order.goldDiscountCents || 0)
                            : undefined,
                        cashAmountCents: session.amount_total || 0,
                        currency: session.currency || "cad",
                    },
                }),
                ...(Number(order.goldRedeemed || 0) > 0
                    ? [
                        prisma.rewardHistory.create({
                            data: {
                                userId: order.customerId,
                                type: "ORDER_REDEMPTION",
                                goldAmount: -Number(order.goldRedeemed || 0),
                                title: "Gold redeemed for order",
                                description: `Used ${order.goldRedeemed} gold for order #${order.id
                                    .slice(0, 8)
                                    .toUpperCase()}.`,
                                sourceUserId: order.id,
                            },
                        }),
                    ]
                    : []),
            ]);

            console.log(`Stripe payment completed for order ${orderId}.`);
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
    verifyCheckoutSession,
    handleStripeWebhook,
};