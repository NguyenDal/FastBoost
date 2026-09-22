const test = require("node:test");
const assert = require("node:assert/strict");

test("only the referred friend gets 10%; both receive one $5 reward notice after qualification", async () => {
    const prismaPath = require.resolve("../src/prisma");
    const programPath = require.resolve("../src/utils/referralProgram");
    const controllerPath = require.resolve("../src/controllers/notificationController");
    const saved = [prismaPath, programPath, controllerPath].map(path => [path, require.cache[path]]);
    const notices = new Map();
    let paid = false;
    let completed = false;
    const prisma = {
        user: { findUnique: async ({ where }) => ({ referredById: where.id === "friend" ? "inviter" : null }) },
        order: {
            findFirst: async () => paid ? { id: "order" } : null,
            findUnique: async () => ({ id: "order", customerId: "friend", status: completed ? "COMPLETED" : "PENDING", paymentStatus: paid ? "PAID" : "PENDING", totalPrice: 45, referralDiscount: 5, customer: { referredById: "inviter" } }),
        },
        rewardHistory: { findFirst: async () => null, upsert: async ({ create }) => create },
        notification: {
            upsert: async ({ where, create, update }) => {
                notices.set(where.id, notices.has(where.id) ? { ...notices.get(where.id), ...update } : { ...create, read: false });
            },
            findMany: async () => [],
        },
        $transaction: async (operations) => Promise.all(operations),
    };
    try {
        require.cache[prismaPath] = { exports: prisma };
        delete require.cache[programPath];
        delete require.cache[controllerPath];
        const { grantReferralCompletionRewards } = require(programPath);
        const { listMyNotifications } = require(controllerPath);
        const res = { json: () => {} };
        await listMyNotifications({ user: { id: "inviter" }, query: {} }, res);
        assert.equal(notices.size, 0);
        await listMyNotifications({ user: { id: "friend" }, query: {} }, res);
        assert.equal(notices.size, 1);
        assert.equal(notices.get("first-purchase-friend").userId, "friend");
        assert.equal(notices.get("first-purchase-friend").type, "FIRST_PURCHASE_DISCOUNT");
        await grantReferralCompletionRewards("order");
        assert.equal(notices.size, 1);
        paid = true;
        await grantReferralCompletionRewards("order");
        assert.equal(notices.size, 1);
        completed = true;
        await grantReferralCompletionRewards("order");
        const rewards = [...notices.values()].filter(n => n.type === "REFERRAL_REWARD");
        assert.deepEqual(rewards.map(n => n.userId).sort(), ["friend", "inviter"]);
        for (const notice of rewards) {
            assert.equal(notice.title, "$5 off your next purchase");
            assert.equal(notice.data.goldAmount, 50);
            notice.read = true;
        }
        await grantReferralCompletionRewards("order");
        assert.equal(notices.size, 3);
        assert.ok([...notices.values()].filter(n => n.type === "REFERRAL_REWARD").every(n => n.read));
    } finally {
        for (const [path, cached] of saved) {
            if (cached) require.cache[path] = cached;
            else delete require.cache[path];
        }
    }
});
