const test = require("node:test");
const assert = require("node:assert/strict");
const { buildConfirmation, validEmail, queueOrderConfirmation, deliverPendingConfirmations } = require("../src/utils/orderConfirmationEmail");

const order = { id: "internal-id", orderNumber: "LOL-PLC-ABCDE", paymentStatus: "PAID", boostType: "Placement Boost", peakRank: "Silver I", placementGames: 5, region: "North America", queueType: "Solo/Duo", currency: "cad", amountCents: 2700, basePrice: 30, referralDiscount: 3, cashAmountCents: 1700, goldRedeemed: 100, goldDiscountCents: 1000 };
function configure(t) {
    const previous = { ...process.env };
    process.env.CLIENT_URL = "https://fastboost.example";
    process.env.ORDER_CONFIRMATION_EMAILS_ENABLED = "true";
    t.after(() => { for (const key of ["CLIENT_URL", "ORDER_CONFIRMATION_EMAILS_ENABLED", "NODE_ENV"]) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; } });
}

test("confirmation contains actual service, cash and gold; escapes content and rejects unpaid orders", t => {
    configure(t);
    const mail = buildConfirmation({ ...order, region: "<script>bad</script>" }, " changed@example.com ");
    assert.equal(mail.to, "changed@example.com");
    assert.match(mail.text, /Placement Matches: 5/);
    assert.doesNotMatch(mail.text, /Target Rank/);
    assert.match(mail.text, /Gold used: 100/);
    assert.match(mail.text, /CAD\s*17\.00/);
    assert.match(mail.text, /https:\/\/fastboost.example\/match\/internal-id/);
    assert.doesNotMatch(mail.html, /<script>/);
    assert.match(mail.html, /&lt;script&gt;/);
    assert.match(buildConfirmation({ ...order, cashAmountCents: 0, goldRedeemed: 270, goldDiscountCents: 2700 }, "a@example.com").text, /CAD\s*0\.00/);
    assert.throws(() => buildConfirmation({ ...order, paymentStatus: "PENDING" }, "a@example.com"));
    assert.equal(validEmail("a@example.com\r\nBcc: other@example.com"), false);
    process.env.NODE_ENV = "production";
    process.env.CLIENT_URL = "http://localhost:5173";
    assert.throws(() => buildConfirmation(order, "a@example.com"));
});

test("queue stores one immutable confirmation per paid order", async t => {
    configure(t);
    const rows = new Map();
    const transaction = { order: { findUnique: async () => order }, orderConfirmationEmail: { upsert: async ({ where, create, update }) => { assert.deepEqual(update, {}); if (!rows.has(where.orderId)) rows.set(where.orderId, create); } } };
    await queueOrderConfirmation(transaction, order.id, "checkout@example.com");
    await queueOrderConfirmation(transaction, order.id, "different@example.com");
    assert.equal(rows.size, 1);
    assert.equal(rows.get(order.id).payload.to, "checkout@example.com");
});

test("email overview adapts to LoL and TFT boost services", t => {
    configure(t);
    for (const [boostType, fields, expected] of [
        ["Rank Boost", { currentRank: "Silver", currentDivision: "I", desiredRank: "Gold", desiredDivision: "IV" }, "Gold IV"],
        ["Placement Boost", { peakRank: "Silver I", placementGames: 5 }, "Placement Matches"],
        ["Win Boost", { currentRank: "Silver", desiredWins: 7 }, "Ranked Wins"],
        ["Pro Duo", { currentRank: "Silver", numberOfGames: 3 }, "Games"],
        ["TFT Rank Boost", { currentRank: "Silver", desiredRank: "Gold", desiredDivision: "IV" }, "Gold IV"],
        ["TFT Win Boost", { currentRank: "Silver", desiredWins: 4 }, "Ranked Wins"],
    ]) {
        const html = buildConfirmation({ ...order, desiredRank: "Diamond", desiredDivision: "I", boostType, ...fields }, "a@example.com").html;
        assert.ok(html.includes(expected), boostType);
        assert.ok(html.includes(boostType.startsWith("TFT") ? "Teamfight Tactics" : "League of Legends"));
        if (!boostType.endsWith("Rank Boost")) {
            assert.doesNotMatch(html, /Target rank|Diamond I/);
        }
        assert.match(html, /What happens next\?/);
    }
});

test("worker retries failed delivery and claims prevent concurrent duplicate sends", async t => {
    configure(t);
    const now = new Date();
    const row = { orderId: order.id, payload: buildConfirmation(order, "checkout@example.com"), attempts: 0, sentAt: null, nextAttemptAt: now };
    const prisma = { orderConfirmationEmail: {
        findMany: async () => row.sentAt ? [] : [{ ...row }],
        updateMany: async ({ where, data }) => {
            if (where.attempts !== undefined && (where.attempts !== row.attempts || row.nextAttemptAt > where.nextAttemptAt.lte)) return { count: 0 };
            if (where.claim && where.claim !== row.claim) return { count: 0 };
            Object.assign(row, data, data.attempts ? { attempts: row.attempts + 1 } : {});
            return { count: 1 };
        },
    } };
    const oldError = console.error;
    console.error = () => {};
    t.after(() => { console.error = oldError; });
    await deliverPendingConfirmations(prisma, { sendMail: async () => { throw Object.assign(new Error("provider contains private data"), { code: "ETIMEDOUT" }); } }, now);
    assert.equal(row.sentAt, null);
    assert.equal(row.attempts, 1);
    assert.equal(row.lastError, "ETIMEDOUT");
    assert.ok(row.nextAttemptAt > now);
    let sent = 0;
    const transport = { sendMail: async () => { sent++; return { accepted: ["checkout@example.com"] }; } };
    await Promise.all([deliverPendingConfirmations(prisma, transport, row.nextAttemptAt), deliverPendingConfirmations(prisma, transport, row.nextAttemptAt)]);
    assert.equal(sent, 1);
    assert.ok(row.sentAt);
    await deliverPendingConfirmations(prisma, transport);
    assert.equal(sent, 1);
});
