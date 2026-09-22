const test = require("node:test");
const assert = require("node:assert/strict");

test("dashboard fetches latest three per category including read items and keeps discount read state", async () => {
    const prismaPath = require.resolve("../src/prisma");
    const referralPath = require.resolve("../src/utils/referralProgram");
    const controllerPath = require.resolve("../src/controllers/notificationController");
    const saved = [prismaPath, referralPath, controllerPath].map(path => [path, require.cache[path]]);
    const queries = [];
    let discount;
    const prisma = { notification: {
        upsert: async ({ create, update }) => {
            discount = discount ? { ...discount, ...update } : { ...create, read: false };
        },
        findMany: async (query) => {
            queries.push(query);
            return [{ id: query.where.type === "CHAT_MESSAGE" ? "message" : "notification", read: true }];
        },
    } };
    try {
        require.cache[prismaPath] = { exports: prisma };
        require.cache[referralPath] = { exports: { getReferralFirstPurchaseOffer: async () => ({ eligible: true, firstPurchaseDiscountPercent: 10 }) } };
        delete require.cache[controllerPath];
        const { listMyNotifications } = require(controllerPath);
        let response;
        const req = { user: { id: "customer" }, query: { view: "dashboard" } };
        const res = { json: (body) => { response = body; } };
        await listMyNotifications(req, res);
        assert.equal(response.notifications.length, 2);
        assert.ok(response.notifications.every(item => item.read));
        assert.equal(queries.length, 2);
        for (const query of queries) {
            assert.equal(query.take, 3);
            assert.equal(query.where.userId, "customer");
            assert.equal(query.where.read, undefined);
            assert.equal(query.orderBy[0].createdAt, "desc");
        }
        assert.equal(discount.title, "10% First Purchase Discount");
        discount.read = true;
        await listMyNotifications(req, res);
        assert.equal(discount.read, true);
    } finally {
        for (const [path, cached] of saved) {
            if (cached) require.cache[path] = cached;
            else delete require.cache[path];
        }
    }
});
