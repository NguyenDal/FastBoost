const prisma = require("../prisma");
const stripe = require("../utils/stripeClient");
const { checkoutSummary } = require("../utils/checkoutSummary");
const {
    grantReferralCompletionRewards,
} = require("../utils/referralProgram");

function getUserId(req) {
    return req.user?.id || req.user?.userId;
}

function isLocalhostUrl(value) {
    if (!value) {
        return false;
    }

    try {
        const { hostname } = new URL(value);

        return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(hostname);
    } catch {
        return false;
    }
}

function isLocalCheckoutRequest(req) {
    const origin = req.get("origin");
    const host = req.hostname;

    return (
        isLocalhostUrl(origin) ||
        ["localhost", "127.0.0.1", "::1", "[::1]"].includes(host)
    );
}

function getRequestOrigin(req) {
    const origin = req.get("origin");

    if (!origin) {
        return null;
    }

    try {
        const url = new URL(origin);

        if (!["http:", "https:"].includes(url.protocol)) {
            return null;
        }

        return url.origin;
    } catch {
        return null;
    }
}

function getClientUrl(req) {
    const clientUrl = process.env.CLIENT_URL?.trim();
    const requestOrigin = getRequestOrigin(req);
    const isLocalRequest = isLocalCheckoutRequest(req);

    if (clientUrl) {
        const normalizedClientUrl = clientUrl.replace(/\/+$/, "");

        if (!isLocalhostUrl(normalizedClientUrl) || isLocalRequest) {
            return normalizedClientUrl;
        }
    }

    if (requestOrigin && !isLocalhostUrl(requestOrigin)) {
        return requestOrigin;
    }

    if (isLocalRequest) {
        return "http://localhost:5173";
    }

    throw new Error(
        "Unable to determine the public frontend URL for deployed checkout."
    );
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

async function completeCheckoutSessionPayment(order, session) {
    const paymentIntentId =
        typeof session.payment_intent === "string"
            ? session.payment_intent
            : session.payment_intent?.id || null;

    const paymentApplied = await prisma.$transaction(async (transaction) => {
        const updateResult = await transaction.order.updateMany({
            where: {
                id: order.id,
                stripeCheckoutSessionId: session.id,
                paymentStatus: { not: "PAID" },
            },
            data: {
                paymentStatus: "PAID",
                stripePaymentIntentId: paymentIntentId,
                paidAt: new Date(),
                amountCents: session.amount_subtotal
                    ? Number(session.amount_subtotal) +
                    Number(order.goldDiscountCents || 0)
                    : undefined,
                cashAmountCents: session.amount_total || 0,
                currency: session.currency || "cad",
            },
        });

        if (updateResult.count === 0) {
            return false;
        }

        if (Number(order.goldRedeemed || 0) > 0) {
            await transaction.rewardHistory.createMany({
                data: [
                    {
                        userId: order.customerId,
                        type: "ORDER_REDEMPTION",
                        goldAmount: -Number(order.goldRedeemed),
                        title: "Gold redeemed for order",
                        description: `Used ${order.goldRedeemed} gold for order #${order.id
                            .slice(0, 8)
                            .toUpperCase()}.`,
                        sourceUserId: order.id,
                    },
                ],
                skipDuplicates: true,
            });
        }

        return true;
    });

    if (paymentApplied) {
        await grantReferralCompletionRewards(order.id);
        console.log(`Stripe payment completed for order ${order.id}.`);
    }

    return paymentApplied;
}

const createCheckoutSession = async (req, res) => {
    try {
        const userId = getUserId(req);
        const { orderId, goldToUse, deferGoldOnly } = req.body || {};

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
            return res.json({ ok: true, paid: true, orderId: order.id,
                summary: checkoutSummary(order, order.goldRedeemed || 0, order.goldDiscountCents || 0, order.cashAmountCents ?? order.amountCents) });
        }

        if (order.status === "CANCELLED") {
            return res.status(400).json({ ok: false, message: "This order has been cancelled" });
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

        const clientUrl = getClientUrl(req);
        const summary = checkoutSummary(order, goldRedeemed, goldDiscountCents, cashAmountCents);
        summary.availableGold = availableGold;

        // Reuse an open session on refresh. Expire it before changing the amount.
        if (order.stripeCheckoutSessionId) {
            const existingSession = await stripe.checkout.sessions.retrieve(order.stripeCheckoutSessionId);
            if (existingSession.status === "complete") {
                return res.json({ ok: true, completed: true, sessionId: existingSession.id, summary });
            }
            if (existingSession.status === "open") {
                if (existingSession.ui_mode === "elements" && existingSession.metadata?.editableEmail === "1" && existingSession.amount_total === cashAmountCents && Number(existingSession.metadata?.goldRedeemed || 0) === goldRedeemed) {
                    return res.json({ ok: true, clientSecret: existingSession.client_secret, sessionId: existingSession.id, summary });
                }
                await stripe.checkout.sessions.expire(existingSession.id);
            }
        }

        if (cashAmountCents <= 0) {
            if (deferGoldOnly === true) {
                return res.json({ ok: true, goldOnlyReady: true, summary });
            }
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

                    await grantReferralCompletionRewards(order.id);

            return res.json({
                ok: true,
                paidWithGoldOnly: true,
                orderId: order.id,
                redirectUrl: `${clientUrl}/payment/success/${order.serviceId}?orderId=${order.id}&gold=1`,
            });
        }

        const session = await stripe.checkout.sessions.create({
            mode: "payment",
            ui_mode: "elements",
            // Collect contact email in the editable checkout form. Setting
            // customer_email here locks it and rejects confirm({ email }).
            payment_method_types: ["card", "link"],
            adaptive_pricing: { enabled: false },
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
                editableEmail: "1",
                orderId: order.id,
                customerId: order.customerId,
                goldRedeemed: String(goldRedeemed),
                goldDiscountCents: String(goldDiscountCents),
                cashAmountCents: String(cashAmountCents),
            },
            return_url: `${clientUrl}/checkout/${order.id}?session_id={CHECKOUT_SESSION_ID}`,
        }, { idempotencyKey: `checkout-email-v1-${order.id}-${goldRedeemed}-${order.stripeCheckoutSessionId || "new"}` });

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
            clientSecret: session.client_secret,
            sessionId: session.id,
            summary,
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
                goldRedeemed: true,
                goldDiscountCents: true,
            },
        });

        if (!order) {
            return res.status(404).json({
                ok: false,
                message: "Order not found",
            });
        }

        if (sessionId && order.paymentStatus !== "PAID") {
            try {
                const session = await stripe.checkout.sessions.retrieve(sessionId);
                const sessionOrderId = session.metadata?.orderId;

                if (
                    session.payment_status === "paid" &&
                    String(sessionOrderId) === String(order.id)
                ) {
                    await completeCheckoutSessionPayment(order, session);
                }
            } catch (error) {
                console.error(
                    `Stripe session reconciliation failed for order ${order.id}:`,
                    error.message
                );
            }
        }

        const verifiedOrder = await prisma.order.findUnique({
            where: { id: order.id },
            select: {
                id: true,
                paymentStatus: true,
                status: true,
                paidAt: true,
            },
        });

        return res.json({
            ok: true,
            orderId: verifiedOrder.id,
            paymentStatus: verifiedOrder.paymentStatus,
            paid: verifiedOrder.paymentStatus === "PAID",
            orderStatus: verifiedOrder.status,
            paidAt: verifiedOrder.paidAt,
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
        if (
            event.type === "checkout.session.completed" ||
            event.type === "checkout.session.async_payment_succeeded"
        ) {
            const session = event.data.object;

            const orderId = session.metadata?.orderId;

            if (!orderId) {
                console.warn(`${event.type} missing orderId metadata`);
                return res.json({ received: true });
            }

            if (session.payment_status !== "paid") {
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

            await completeCheckoutSessionPayment(order, session);
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
