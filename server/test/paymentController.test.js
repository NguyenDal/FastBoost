const test = require("node:test");
const assert = require("node:assert/strict");

test("verifyCheckoutSession reconciles a paid Stripe session", async (context) => {
    const orderId = "order-123";
    const customerId = "customer-123";
    const sessionId = "cs_test_123";
    const paidAt = new Date("2026-09-21T12:00:00.000Z");
    let paymentStatus = "PENDING";
    let referralOrderId = null;

    const prisma = {
        order: {
            findFirst: async () => ({
                id: orderId,
                customerId,
                paymentStatus,
                status: "PENDING",
                paidAt: null,
                stripeCheckoutSessionId: sessionId,
                goldRedeemed: 0,
                goldDiscountCents: 0,
            }),
            findUnique: async () => ({
                id: orderId,
                paymentStatus,
                status: "PENDING",
                paidAt: paymentStatus === "PAID" ? paidAt : null,
            }),
        },
        $transaction: async (callback) => callback({
            order: {
                updateMany: async ({ where, data }) => {
                    assert.equal(where.id, orderId);
                    assert.equal(where.stripeCheckoutSessionId, sessionId);
                    assert.equal(data.stripePaymentIntentId, "pi_test_123");
                    paymentStatus = "PAID";
                    return { count: 1 };
                },
            },
            rewardHistory: {
                createMany: async () => {
                    assert.fail("No gold redemption should be created");
                },
            },
        }),
    };

    const stripe = {
        checkout: {
            sessions: {
                retrieve: async (requestedSessionId) => {
                    assert.equal(requestedSessionId, sessionId);

                    return {
                        id: sessionId,
                        payment_status: "paid",
                        payment_intent: "pi_test_123",
                        amount_subtotal: 2500,
                        amount_total: 2500,
                        currency: "cad",
                        metadata: { orderId },
                    };
                },
            },
        },
    };

    const moduleMocks = new Map([
        [require.resolve("../src/prisma"), prisma],
        [require.resolve("../src/utils/stripeClient"), stripe],
        [
            require.resolve("../src/utils/referralProgram"),
            {
                grantReferralCompletionRewards: async (completedOrderId) => {
                    referralOrderId = completedOrderId;
                },
            },
        ],
    ]);
    const originalCacheEntries = new Map();

    for (const [modulePath, exports] of moduleMocks) {
        originalCacheEntries.set(modulePath, require.cache[modulePath]);
        require.cache[modulePath] = {
            id: modulePath,
            filename: modulePath,
            loaded: true,
            exports,
        };
    }

    const controllerPath = require.resolve("../src/controllers/paymentController");
    delete require.cache[controllerPath];

    context.after(() => {
        delete require.cache[controllerPath];

        for (const [modulePath, cacheEntry] of originalCacheEntries) {
            if (cacheEntry) {
                require.cache[modulePath] = cacheEntry;
            } else {
                delete require.cache[modulePath];
            }
        }
    });

    const { verifyCheckoutSession } = require(controllerPath);
    let responseStatus = 200;
    let responseBody = null;
    const response = {
        status(status) {
            responseStatus = status;
            return this;
        },
        json(body) {
            responseBody = body;
            return this;
        },
    };

    await verifyCheckoutSession(
        {
            user: { id: customerId },
            query: { sessionId },
        },
        response
    );

    assert.equal(responseStatus, 200);
    assert.equal(responseBody.ok, true);
    assert.equal(responseBody.orderId, orderId);
    assert.equal(responseBody.paymentStatus, "PAID");
    assert.equal(responseBody.paid, true);
    assert.equal(referralOrderId, orderId);
});