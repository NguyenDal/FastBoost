const test = require('node:test');
const assert = require('node:assert/strict');

test('customer, booster and admin order responses share the saved receipt and preserve access checks', async t => {
    let order = {
        id: 'order', customerId: 'customer', assignments: [{ boosterId: 'booster' }],
        paymentStatus: 'PAID', status: 'IN_PROGRESS', currency: 'cad',
        basePrice: 100, addonPrice: 20, amountCents: 10800, totalPrice: 108,
        couponSaleId: 'coupon', couponCode: 'WELCOME10', couponTitle: 'Welcome',
        couponDiscountCents: 1200, couponOriginalAmountCents: 11400,
        goldRedeemed: 1080, goldDiscountCents: 10800, cashAmountCents: 0,
    };
    let listWhere;
    const prisma = {
        order: {
            findUnique: async () => ({ ...order }),
            findMany: async ({ where }) => { listWhere = where; return [{ ...order }]; },
            count: async () => 1,
        },
        user: { findUnique: async () => ({ id: 'booster', role: 'PROVIDER' }) },
    };
    // No database, Stripe, KMS or notification calls are needed to serialize a receipt.
    const replacements = new Map([
        [require.resolve('../src/prisma'), prisma],
        [require.resolve('../src/utils/stripeClient'), {}],
        [require.resolve('../src/config/env'), { env: { awsRegion: 'ca-central-1' } }],
    ]);
    const saved = new Map();
    for (const [path, exports] of replacements) {
        saved.set(path, require.cache[path]);
        require.cache[path] = { id: path, filename: path, loaded: true, exports };
    }
    const path = require.resolve('../src/controllers/orderController');
    delete require.cache[path];
    t.after(() => {
        delete require.cache[path];
        for (const [key, value] of saved) {
            if (value) require.cache[key] = value;
            else delete require.cache[key];
        }
    });
    const controller = require(path);
    const invoke = async (name, user) => {
        const res = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
        await controller[name]({ user, params: { id: order.id }, query: {} }, res);
        return res;
    };
    const customer = { id: 'customer', role: 'CUSTOMER' };
    const booster = { id: 'booster', role: 'PROVIDER' };
    const admin = { id: 'admin', role: 'ADMIN' };
    const expected = { currency: 'cad', subtotalCents: 12000, promotionCents: 0,
        coupon: { title: 'Welcome', code: 'WELCOME10', amountCents: 1200 },
        referralCents: 0, goldRedeemed: 1080, goldDiscountCents: 10800, totalCents: 0 };
    for (const [name, user, key] of [
        ['getOrderById', customer, 'order'], ['getOrderById', booster, 'order'],
        ['getOrderAdminById', admin, 'order'], ['getMyOrders', customer, 'orders'],
        ['listAssignedOrdersForProvider', booster, 'items'], ['listAllOrders', admin, 'items'],
    ]) {
        const res = await invoke(name, user);
        assert.equal(res.code, 200, name);
        const result = key === 'order' ? res.body.order : res.body[key][0];
        assert.deepEqual(result.priceSummary, expected, `${name} (${user.role})`);
        if (name === 'getMyOrders') assert.equal(listWhere.customerId, customer.id);
        if (name === 'listAssignedOrdersForProvider') assert.equal(listWhere.assignments.some.boosterId, booster.id);
    }
    const denied = await invoke('getOrderById', { id: 'unassigned', role: 'PROVIDER' });
    assert.equal(denied.code, 403);
    assert.equal(denied.body.order, undefined);

    // Older paid records without cashAmountCents still deduct Gold exactly once.
    order = { ...order, basePrice: 10, addonPrice: 0, totalPrice: 10, amountCents: 1000,
        couponSaleId: null, couponOriginalAmountCents: null, goldRedeemed: 10,
        goldDiscountCents: 100, cashAmountCents: null };
    const legacy = await invoke('getOrderById', booster);
    assert.equal(legacy.body.order.priceSummary.subtotalCents, 1000);
    assert.equal(legacy.body.order.priceSummary.totalCents, 900);
});
