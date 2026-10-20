const assert = require('node:assert/strict');
const Stripe = require('stripe');

const matches = (row, where = {}) => Object.entries(where).every(([key, condition]) => {
    if (condition && typeof condition === 'object') return Object.entries(condition).every(([operator, value]) => {
        if (operator === 'not') return row[key] !== value;
        if (operator === 'gt') return row[key] > value;
        assert.fail(`Unsupported payment fixture condition: ${operator}`);
    });
    return row[key] === condition;
});
const selected = (row, select) => row == null ? null : structuredClone(select
    ? Object.fromEntries(Object.keys(select).filter(key => select[key]).map(key => [key, row[key]])) : row);
const response = () => ({ code: 200, status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; }, send(body) { this.body = body; return this; } });

function paymentFixture(t, { orders = [], initialGold = 100 } = {}) {
    const state = { orders: orders.map(order => ({ orderNumber: `TEST-${order.id}`, customerId: 'customer',
        serviceId: 'service', status: 'PENDING', paymentStatus: 'PENDING', currency: 'usd',
        amountCents: 2000, totalPrice: 20, basePrice: 20, goldRedeemed: 0, goldDiscountCents: 0, cashbackPercent: null,
        stripeCheckoutSessionId: null, customer: { email: 'unused@example.test' }, service: { title: 'Test service' }, ...order })),
    redemptions: [], queued: [], referrals: [], expired: [], created: [], failRetrieve: false, failExpire: false, failQueue: false, failReferral: false };
    const sessions = new Map();
    let transactions = Promise.resolve();
    const db = {
        $queryRaw: async () => [],
        $transaction: callback => {
            const result = transactions.then(async () => {
                const snapshot = structuredClone({ orders: state.orders, redemptions: state.redemptions, queued: state.queued, referrals: state.referrals });
                try { return await callback(db); }
                catch (error) { Object.assign(state, snapshot); throw error; }
            });
            transactions = result.catch(() => {});
            return result;
        },
        servicePriceRule: { findFirst: async () => ({ id: 'active-rule' }) },
        order: {
            aggregate: async ({ where }) => ({ _sum: { totalPrice: state.orders.filter(row => matches(row, where))
                .reduce((sum, row) => sum + Number(row.totalPrice || 0), 0) } }),
            findMany: async ({ where, select }) => state.orders.filter(row => matches(row, where)).map(row => selected(row, select)),
            findFirst: async ({ where, select }) => selected(state.orders.find(row => matches(row, where)), select),
            findUnique: async ({ where, select }) => selected(state.orders.find(row => matches(row, where)), select),
            update: async ({ where, data }) => {
                const row = state.orders.find(row => matches(row, where));
                assert.ok(row, 'updated order exists');
                Object.assign(row, Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined)));
                return structuredClone(row);
            },
            updateMany: async ({ where, data }) => {
                const rows = state.orders.filter(row => matches(row, where));
                for (const row of rows) Object.assign(row, Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined)));
                return { count: rows.length };
            },
        },
        rewardHistory: {
            aggregate: async ({ where }) => ({ _sum: { goldAmount: initialGold + state.redemptions
                .filter(row => row.userId === where.userId).reduce((sum, row) => sum + row.goldAmount, 0) } }),
            create: async ({ data }) => { state.redemptions.push(structuredClone(data)); return data; },
            createMany: async ({ data }) => {
                let count = 0;
                for (const row of data) if (!state.redemptions.some(old => old.userId === row.userId && old.type === row.type && old.sourceUserId === row.sourceUserId)) {
                    state.redemptions.push(structuredClone(row)); count++;
                }
                return { count };
            },
        },
    };
    const stripe = { webhooks: new Stripe('sk_test_offline_fixture').webhooks, checkout: { sessions: {
        retrieve: async id => {
            if (state.failRetrieve) throw new Error('Simulated retrieval failure');
            assert.ok(sessions.has(id), `fixture session ${id} exists`);
            return structuredClone(sessions.get(id));
        },
        expire: async id => {
            const session = sessions.get(id);
            assert.ok(session, 'expired fixture session exists');
            if (state.completeOnExpire) session.status = 'complete';
            if (state.failExpire || session.status !== 'open') throw new Error('Simulated expiration failure');
            session.status = 'expired'; state.expired.push(id);
            return structuredClone(session);
        },
        create: async args => {
            const id = `cs_test_${state.created.length + 1}`;
            const amount = args.line_items[0].price_data.unit_amount;
            const session = { id, object: 'checkout.session', mode: args.mode, status: 'open', payment_status: 'unpaid', livemode: false, ui_mode: 'elements',
                client_secret: 'offline-secret', metadata: args.metadata, amount_subtotal: amount, amount_total: amount,
                currency: args.line_items[0].price_data.currency, adaptive_pricing: { ...args.adaptive_pricing } };
            sessions.set(id, session); state.created.push(id);
            return structuredClone(session);
        },
    } } };
    const replacements = new Map([
        [require.resolve('../src/prisma'), db], [require.resolve('../src/utils/stripeClient'), stripe],
        [require.resolve('../src/utils/referralProgram'), { grantReferralCompletionRewards: async (id, tx) => {
            assert.equal(tx, db, 'referral Gold awards must share the settlement transaction');
            if (state.failReferral) throw new Error('Simulated referral award failure');
            if (!state.referrals.includes(id)) state.referrals.push(id);
            return { granted: false };
        } }],
        [require.resolve('../src/utils/orderConfirmationEmail'), {
            validEmail: email => typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),
            queueOrderConfirmation: async (tx, id, email) => {
                if (state.failQueue) throw new Error('Simulated confirmation queue failure');
                assert.equal((await tx.order.findUnique({ where: { id } })).paymentStatus, 'PAID');
                state.queued.push({ id, email });
            },
        }],
    ]);
    const originals = new Map();
    for (const [file, exports] of replacements) {
        originals.set(file, require.cache[file]); require.cache[file] = { id: file, filename: file, loaded: true, exports };
    }
    const controllerPath = require.resolve('../src/controllers/paymentController');
    originals.set(controllerPath, require.cache[controllerPath]); delete require.cache[controllerPath];
    let controller = require(controllerPath);
    const env = { STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET, CLIENT_URL: process.env.CLIENT_URL, STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY };
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_offline_fixture';
    process.env.CLIENT_URL = 'http://localhost:5173';
    process.env.STRIPE_SECRET_KEY = 'sk_test_offline_fixture';
    t.mock.method(console, 'error', () => {});
    t.mock.method(console, 'log', () => {});
    t.mock.method(console, 'warn', () => {});
    t.after(() => {
        for (const [file, original] of originals) { if (original) require.cache[file] = original; else delete require.cache[file]; }
        for (const [key, value] of Object.entries(env)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    });
    async function checkout(orderId, body = {}) {
        const res = response();
        await controller.createCheckoutSession({ user: { id: 'customer' }, body: { orderId, goldToUse: 100, ...body },
            hostname: 'localhost', get: () => 'http://localhost:5173' }, res);
        return res;
    }
    async function webhook(type, session, overrides = {}) {
        const payload = JSON.stringify({ id: 'evt_offline', object: 'event', livemode: false, type, data: { object: session } });
        const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: 'whsec_offline_fixture' });
        const res = response();
        await controller.handleStripeWebhook({ body: Buffer.from(payload), headers: { 'stripe-signature': signature }, ...overrides }, res);
        return res;
    }
    return { state, sessions, db, stripe, get controller() { return controller; }, checkout, webhook, response,
        restart() { delete require.cache[controllerPath]; controller = require(controllerPath); return controller; },
        paidSession(orderId, overrides = {}) {
            const order = state.orders.find(row => row.id === orderId);
            const cash = order.cashAmountCents ?? order.amountCents - (order.goldDiscountCents || 0);
            return { id: order.stripeCheckoutSessionId, object: 'checkout.session', mode: 'payment', status: 'complete',
                payment_status: 'paid', livemode: false, payment_intent: 'pi_test_synthetic', amount_subtotal: cash, amount_total: cash,
                currency: order.currency, metadata: { orderId, customerId: order.customerId,
                    goldRedeemed: String(order.goldRedeemed || 0), goldDiscountCents: String(order.goldDiscountCents || 0), cashAmountCents: String(cash) },
                ...overrides };
        },
        balance: () => initialGold + state.redemptions.reduce((sum, row) => sum + row.goldAmount, 0) };
}

module.exports = { paymentFixture };
