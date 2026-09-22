const test = require("node:test");
const assert = require("node:assert/strict");
const { notifyOrderStatus } = require("../src/utils/orderNotifications");

test("terminal order notifications target the customer and preserve read state on retry", async () => {
    const records = new Map();
    const prisma = { notification: { upsert: async ({ where, update, create }) => {
        records.set(where.id, records.has(where.id) ? { ...records.get(where.id), ...update } : create);
    } } };
    const order = { id: "order12345", orderNumber: "LOL-RNK-CXBE6", customerId: "customer", status: "COMPLETED", service: { title: "Rank Boost" } };
    await notifyOrderStatus(prisma, order);
    const completed = records.get("order-order12345-completed");
    assert.equal(completed.type, "ORDER_COMPLETED");
    assert.equal(completed.userId, "customer");
    assert.match(completed.message, /LOL-RNK-CXBE6/);
    assert.equal(completed.data.targetPath, "/match/order12345");
    completed.read = true;
    await notifyOrderStatus(prisma, order);
    assert.equal(records.size, 1);
    assert.equal(records.get(completed.id).read, true);
    await notifyOrderStatus(prisma, { ...order, status: "CANCELLED" });
    assert.equal(records.get("order-order12345-cancelled").type, "ORDER_CANCELLED");
    await notifyOrderStatus(prisma, { ...order, status: "IN_PROGRESS" });
    assert.equal(records.size, 2);
});
