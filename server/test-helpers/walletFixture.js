const assert = require('node:assert/strict');
const { paymentFixture } = require('./paymentFixture');
const { createWalletService } = require('../src/utils/customerWallet');
const clone = value => value == null ? value : structuredClone(value);
const matches = (row, where = {}) => Object.entries(where).every(([key, condition]) => {
    if (condition && typeof condition === 'object' && !Array.isArray(condition)) return Object.entries(condition).every(([operator, value]) => {
        if (operator === 'in') return value.includes(row[key]);
        if (operator === 'not') return row[key] !== value;
        throw new Error(`Unsupported wallet fixture condition ${operator}`);
    });
    return row[key] === condition;
});

function walletFixture(t, { purchased = 0, promotional = 0, frozen = false, ...options } = {}) {
    const f = paymentFixture(t, options);
    const ledger = { accounts: [{ userId: 'customer', purchasedBalanceCents: purchased, promotionalBalanceCents: promotional,
        frozenAt: frozen ? new Date() : null }], topUps: [], entries: [], entitlements: [] };
    const transaction = f.db.$transaction;
    f.db.$transaction = (callback, config) => transaction(async db => {
        const before = clone(ledger);
        try { return await callback(db); }
        catch (error) { Object.assign(ledger, before); throw error; }
    }, config);
    f.db.$queryRaw = async () => [{ id: 'customer' }];
    f.db.order.aggregate = async ({ where }) => ({ _sum: { totalPrice: f.state.orders.filter(row => matches(row, where))
        .reduce((sum, row) => sum + Number(row.totalPrice || 0), 0) } });
    const model = (rows, defaults = {}) => ({
        findUnique: async ({ where }) => clone(ledger[rows].find(row => matches(row, where)) || null),
        findFirst: async ({ where }) => clone([...ledger[rows]].reverse().find(row => matches(row, where)) || null),
        findMany: async ({ where, take }) => clone([...ledger[rows]].reverse().filter(row => matches(row, where)).slice(0, take || Infinity)),
        create: async ({ data }) => {
            if (data.key && ledger[rows].some(row => row.key === data.key)) throw Object.assign(new Error('Duplicate immutable ledger key'), { code: 'P2002' });
            const row = { id: `${rows}_${ledger[rows].length + 1}`, createdAt: new Date(), ...defaults, ...clone(data) };
            ledger[rows].push(row); return clone(row);
        },
        update: async ({ where, data }) => {
            const row = ledger[rows].find(row => matches(row, where)); assert.ok(row, `${rows} updated record exists`);
            Object.assign(row, clone(data)); return clone(row);
        },
        updateMany: async ({ where, data }) => {
            const records = ledger[rows].filter(row => matches(row, where)); records.forEach(row => Object.assign(row, clone(data)));
            return { count: records.length };
        },
    });
    f.db.walletAccount = model('accounts');
    f.db.walletAccount.upsert = async ({ where, create }) => {
        let account = ledger.accounts.find(row => matches(row, where));
        if (!account) { account = { purchasedBalanceCents: 0, promotionalBalanceCents: 0, frozenAt: null, ...clone(create) }; ledger.accounts.push(account); }
        return clone(account);
    };
    f.db.walletTopUp = model('topUps', { status: 'CREATING', stripeCheckoutSessionId: null, stripePaymentIntentId: null });
    f.db.walletEntry = model('entries');
    f.db.walletCashbackEntitlement = model('entitlements', { entitledCents: 0, revision: 0 });
    f.db.walletCashbackEntitlement.upsert = async ({ where, create }) => {
        let entitlement = ledger.entitlements.find(row => matches(row, where));
        if (!entitlement) { entitlement = { entitledCents: 0, revision: 0, ...clone(create) }; ledger.entitlements.push(entitlement); }
        return clone(entitlement);
    };
    const createSession = f.stripe.checkout.sessions.create;
    const idempotency = new Map();
    const intents = new Map();
    let failAfterCreate = false;
    f.stripe.checkout.sessions.create = async (parameters, config = {}) => {
        if (idempotency.has(config.idempotencyKey)) return clone(f.sessions.get(idempotency.get(config.idempotencyKey)));
        const session = await createSession(parameters);
        if (parameters.metadata?.kind === 'wallet_topup') {
            const stored = f.sessions.get(session.id);
            stored.url = `https://checkout.stripe.com/c/pay/${session.id}`;
            idempotency.set(config.idempotencyKey, session.id);
        }
        if (failAfterCreate) { failAfterCreate = false; throw new Error('Stripe accepted request but response was lost'); }
        return clone(f.sessions.get(session.id));
    };
    f.stripe.paymentIntents = { retrieve: async id => { assert.ok(intents.has(id), 'offline PaymentIntent exists'); return clone(intents.get(id)); } };
    f.stripe.charges = { retrieve: async id => {
        const intent = [...intents.values()].find(row => row.latest_charge.id === id); assert.ok(intent); return clone(intent.latest_charge);
    } };
    const service = () => createWalletService({ prisma: f.db, stripe: f.stripe });
    async function payOrder(id, body = {}, user = 'customer') {
        const res = f.response();
        await f.controller.payWithWallet({ user: { id: user }, body: { orderId: id, contactEmail: 'receipt@example.test', expectedTotalCents: 2000, ...body },
            hostname: 'localhost', get: () => 'http://localhost:5173' }, res);
        return res;
    }
    function paidTopUp(sessionId, changes = {}) {
        const session = f.sessions.get(sessionId);
        assert.ok(session);
        Object.assign(session, { status: 'complete', payment_status: 'paid', payment_intent: `pi_${sessionId}` }, changes);
        const intent = { id: session.payment_intent, amount: session.amount_subtotal, amount_received: session.amount_subtotal, currency: 'usd',
            livemode: false, status: 'succeeded', metadata: clone(session.metadata), latest_charge: { id: `ch_${sessionId}`,
                amount: session.amount_subtotal, currency: 'usd', paid: true, amount_refunded: 0, refunded: false, disputed: false, payment_intent: session.payment_intent } };
        intents.set(intent.id, intent);
        return clone(session);
    }
    return { ...f, ledger, service, payOrder, paidTopUp, intents, loseCreateResponse() { failAfterCreate = true; } };
}

module.exports = { walletFixture };
