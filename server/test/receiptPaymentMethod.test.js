const test = require("node:test");
const assert = require("node:assert/strict");
const { paymentMethodSnapshot, paymentMethodLabel, retrieveReceiptPaymentMethod } = require("../src/utils/receiptPaymentMethod");
const { buildConfirmation, queueOrderConfirmation } = require("../src/utils/orderConfirmationEmail");
const { paymentFixture } = require("../test-helpers/paymentFixture");

const order = { id: "receipt-order", orderNumber: "LOL-RNK-TEST", paymentStatus: "PAID", boostType: "Rank Boost", currency: "usd", amountCents: 2000, basePrice: 20, cashAmountCents: 1000, goldRedeemed: 100, goldDiscountCents: 1000 };
const card = { type: "card", card: { brand: "visa", last4: "4242", number: "never-persist", fingerprint: "never-persist", exp_year: 2030, wallet: null } };
function configure(t) {
    const keys = ["CLIENT_URL", "ORDER_CONFIRMATION_EMAILS_ENABLED"];
    const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
    process.env.CLIENT_URL = "https://fastboost.example";
    process.env.ORDER_CONFIRMATION_EMAILS_ENABLED = "true";
    t.after(() => { for (const key of keys) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; } });
}

test("receipt snapshots retain only safe card identity, with wallet and Link labels", () => {
    assert.deepEqual(paymentMethodSnapshot(card), { type: "card", brand: "visa", last4: "4242", wallet: null });
    assert.equal(paymentMethodLabel(paymentMethodSnapshot(card)), "VISA (•••• 4242)");
    assert.equal(paymentMethodLabel(paymentMethodSnapshot({ type: "card", card: { ...card.card, wallet: { type: "apple_pay", dynamic_last4: "1234" } } })), "Apple Pay · VISA (•••• 1234)");
    assert.equal(paymentMethodLabel(paymentMethodSnapshot({ type: "card", card: { ...card.card, wallet: { type: "google_pay", dynamic_last4: null } } })), "Google Pay · VISA (•••• 4242)");
    assert.equal(paymentMethodLabel(paymentMethodSnapshot({ type: "link", link: { email: "never-persist@example.test" } })), "Link");
    assert.equal(paymentMethodLabel(paymentMethodSnapshot({ type: "card", card: { brand: "link", last4: null } })), "Link");
});

test("unknown or malformed payment details never invent card digits or expose raw values", () => {
    for (const input of [null, {}, { type: "future_method" }, { type: "__proto__" }]) {
        assert.equal(paymentMethodSnapshot(input), null);
        assert.equal(paymentMethodLabel(paymentMethodSnapshot(input)), "Online payment");
    }
    for (const last4 of ["4242424242424242", "<script>", 4242, "123", "12345", null]) {
        const snapshot = paymentMethodSnapshot({ type: "card", card: { brand: "<script>", last4, wallet: { type: "<script>" } } });
        assert.deepEqual(snapshot, { type: "card", brand: null, last4: null, wallet: null });
        assert.equal(paymentMethodLabel(snapshot), "Card");
    }
});

test("receipt lookup expands the successful charge once with a short timeout and reuses expanded data", async () => {
    const calls = [];
    const stripe = { paymentIntents: { retrieve: async (...args) => { calls.push(args); return { latest_charge: { payment_method_details: card } }; } } };
    const session = { amount_total: 1000, payment_intent: "pi_paid" };
    assert.deepEqual(await retrieveReceiptPaymentMethod(stripe, session), paymentMethodSnapshot(card));
    assert.deepEqual(calls, [["pi_paid", { expand: ["latest_charge"] }, { timeout: 3000, maxNetworkRetries: 0 }]]);
    assert.deepEqual(await retrieveReceiptPaymentMethod(stripe, { ...session, payment_intent: { id: "pi_paid", latest_charge: { payment_method_details: card } } }), paymentMethodSnapshot(card));
    assert.equal(calls.length, 1);
    assert.equal(await retrieveReceiptPaymentMethod(stripe, { ...session, amount_total: 0 }), null);
    assert.equal(calls.length, 1);
    assert.equal(await retrieveReceiptPaymentMethod({ paymentIntents: { retrieve: async () => { throw new Error("private provider failure"); } } }, session), null);
    assert.equal(await retrieveReceiptPaymentMethod({}, session), null);
});

test("receipt shows Gold and the actual cash method below Total for split, card-only and Gold-only payments", t => {
    configure(t);
    const split = buildConfirmation(order, "customer@example.test", paymentMethodSnapshot(card));
    assert.match(split.text, /Total: \$10\.00\n\nPayment methods\nGold \(100\): −\$10\.00\nVISA \(•••• 4242\): \$10\.00/);
    assert.ok(split.html.indexOf("Payment methods") > split.html.indexOf(">Total<"));
    assert.match(split.html, /Gold \(100\)/);
    assert.match(split.html, /VISA \(•••• 4242\)/);
    const cardOnly = buildConfirmation({ ...order, goldRedeemed: 0, goldDiscountCents: 0, cashAmountCents: 2000 }, "customer@example.test", paymentMethodSnapshot(card));
    assert.match(cardOnly.text, /Payment methods\nVISA \(•••• 4242\): \$20\.00/);
    assert.doesNotMatch(cardOnly.text, /Gold/);
    const goldOnly = buildConfirmation({ ...order, cashAmountCents: 0, goldRedeemed: 200, goldDiscountCents: 2000 }, "customer@example.test");
    assert.match(goldOnly.text, /Total: \$0\.00\n\nPayment methods\nGold \(200\): −\$20\.00/);
    assert.doesNotMatch(goldOnly.text, /Online payment|VISA/);
    const unknown = buildConfirmation(order, "customer@example.test");
    assert.match(unknown.text, /Online payment: \$10\.00/);
    const free = buildConfirmation({ ...order, cashAmountCents: 0, goldRedeemed: 0, goldDiscountCents: 0 }, "customer@example.test");
    assert.match(free.text, /Payment methods\nPayment: No charge/);
});

test("receipt method snapshot is immutable on duplicate queuing and contains no raw payment object", async t => {
    configure(t);
    const rows = new Map();
    const transaction = { order: { findUnique: async () => order }, orderConfirmationEmail: { upsert: async ({ where, create, update }) => {
        assert.deepEqual(update, {});
        if (!rows.has(where.orderId)) rows.set(where.orderId, create);
    } } };
    await queueOrderConfirmation(transaction, order.id, "customer@example.test", paymentMethodSnapshot(card));
    await queueOrderConfirmation(transaction, order.id, "other@example.test", { type: "link" });
    assert.equal(rows.size, 1);
    const saved = rows.get(order.id).payload;
    assert.equal(saved.to, "customer@example.test");
    assert.match(saved.text, /VISA \(•••• 4242\)/);
    assert.doesNotMatch(JSON.stringify(saved), /never-persist|fingerprint|exp_year/);
});

test("payment settlement survives failed metadata lookup outside transaction, with one redemption and receipt", async t => {
    configure(t);
    const f = paymentFixture(t, { orders: [{ id: "order", stripeCheckoutSessionId: "cs_paid", goldRedeemed: 100, goldDiscountCents: 1000 }] });
    let inTransaction = false;
    let lookups = 0;
    const transact = f.db.$transaction;
    f.db.$transaction = callback => transact(async db => { inTransaction = true; try { return await callback(db); } finally { inTransaction = false; } });
    f.stripe.paymentIntents = { retrieve: async () => {
        lookups++;
        assert.equal(inTransaction, false, "optional Stripe metadata does not hold the checkout lock");
        throw new Error("Optional receipt lookup unavailable");
    } };
    const session = { id: "cs_paid", object: "checkout.session", status: "complete", payment_status: "paid", payment_intent: "pi_paid", amount_subtotal: 1000, amount_total: 1000, currency: "usd", metadata: { orderId: "order" }, customer_details: { email: "customer@example.test" }, livemode: false };
    assert.equal((await f.webhook("checkout.session.completed", session)).code, 200);
    assert.equal((await f.webhook("checkout.session.completed", session)).code, 200);
    assert.equal(lookups, 1);
    assert.equal(f.state.orders[0].paymentStatus, "PAID");
    assert.equal(f.state.queued.length, 1);
    assert.equal(f.state.redemptions.length, 1);
    assert.equal(f.balance(), 0);
});

test("successful reconciliation queues the Stripe card snapshot with the confirmed receipt exactly once", async t => {
    configure(t);
    const f = paymentFixture(t, { orders: [{ id: "order", stripeCheckoutSessionId: "cs_paid", goldRedeemed: 100, goldDiscountCents: 1000 }] });
    const queuedMethods = [];
    const emailMock = require.cache[require.resolve("../src/utils/orderConfirmationEmail")].exports;
    const originalQueue = emailMock.queueOrderConfirmation;
    emailMock.queueOrderConfirmation = async (db, id, email, method) => {
        queuedMethods.push(method);
        return originalQueue(db, id, email);
    };
    const controllerPath = require.resolve("../src/controllers/paymentController");
    delete require.cache[controllerPath];
    const controller = require(controllerPath);
    f.stripe.paymentIntents = { retrieve: async () => ({ latest_charge: { payment_method_details: card } }) };
    f.sessions.set("cs_paid", { id: "cs_paid", status: "complete", payment_status: "paid", payment_intent: "pi_paid", amount_total: 1000, amount_subtotal: 1000, currency: "usd", metadata: { orderId: "order" }, customer_details: { email: "customer@example.test" } });
    for (let attempt = 0; attempt < 2; attempt++) {
        const res = f.response();
        await controller.verifyCheckoutSession({ user: { id: "customer" }, query: { sessionId: "cs_paid" } }, res);
        assert.equal(res.code, 200);
        assert.equal(res.body.paid, true);
    }
    assert.deepEqual(queuedMethods, [{ type: "card", brand: "visa", last4: "4242", wallet: null }]);
    assert.equal(f.state.queued.length, 1);
});
