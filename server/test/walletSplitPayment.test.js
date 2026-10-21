const test = require('node:test');
const assert = require('node:assert/strict');
const { walletFixture } = require('../test-helpers/walletFixture');
const { orderEarnings } = require('../src/utils/earnings');
const { buildConfirmation } = require('../src/utils/orderConfirmationEmail');
const { mutateCheckoutOrder } = require('../src/utils/checkoutCoupon');

const preview = (f, orderId = 'order', amount = 750, rest = {}) => f.checkout(orderId, { goldToUse: 0, walletToUseCents: amount, ...rest });
const paidSession = (f, sessionId) => ({ ...structuredClone(f.sessions.get(sessionId)), status: 'complete', payment_status: 'paid', payment_intent: `pi_${sessionId}` });
const cancel = async (f, orderId, sessionId) => {
    const res = f.response();
    await f.controller.cancelCheckoutSession({ user: { id: 'customer' }, body: { orderId, ...(sessionId ? { sessionId } : {}) } }, res);
    return res;
};

test('split checkout reserves without a debit, charges only the remainder, and settles both tenders once', async t => {
    const f = walletFixture(t, { purchased: 500, promotional: 1000, orders: [{ id: 'order' }] });
    const result = await preview(f);
    assert.equal(result.code, 200);
    assert.ok(result.body.clientSecret);
    assert.equal(result.body.summary.walletAppliedCents, 750);
    assert.equal(result.body.summary.totalCents, 1250);
    assert.equal(result.body.summary.orderTotalCents, 2000);
    assert.equal(result.body.summary.priceSummary.totalCents, 2000);
    assert.equal(result.body.summary.priceSummary.cardAmountCents, 1250);
    assert.equal(f.ledger.entries.length, 0);
    assert.equal(f.ledger.accounts[0].purchasedBalanceCents, 500);
    assert.equal(f.ledger.holds[0].purchasedCents, 500);
    assert.equal(f.ledger.holds[0].promotionalCents, 250);
    assert.equal(f.sessions.get(result.body.sessionId).amount_subtotal, 1250);
    const before = await f.service().snapshot('customer');
    assert.equal(before.balanceCents, 1500);
    assert.equal(before.availableBalanceCents, 750);
    assert.equal(before.reservedBalanceCents, 750);
    const paid = paidSession(f, result.body.sessionId);
    const replies = await Promise.all([f.webhook('checkout.session.completed', paid), f.webhook('checkout.session.async_payment_succeeded', paid)]);
    assert.deepEqual(replies.map(reply => reply.code), [200, 200]);
    assert.equal(f.ledger.entries.length, 1);
    assert.equal(f.ledger.entries[0].amountCents, -750);
    assert.equal(f.state.orders[0].walletAmountCents, 750);
    assert.equal(f.state.orders[0].cashAmountCents, 2000, 'earnings and cashback keep the full economic total');
    assert.equal(f.ledger.holds.length, 0);
    assert.equal(f.state.queued.length, 1);
});

test('active holds protect the same wallet from another split order and the full-wallet debit path', async t => {
    const f = walletFixture(t, { purchased: 2200, orders: [{ id: 'order' }, { id: 'other' }] });
    assert.equal((await preview(f, 'order', 1500)).code, 200);
    const second = await preview(f, 'other', 1000);
    assert.equal(second.code, 409);
    assert.equal(second.body.code, 'WALLET_INSUFFICIENT');
    const full = await f.payOrder('other');
    assert.equal(full.code, 409);
    assert.equal(full.body.code, 'WALLET_INSUFFICIENT');
    assert.equal(f.ledger.entries.length, 0);
    assert.equal(f.ledger.holds.length, 1);
    assert.equal((await preview(f, 'order', 1600)).code, 200, 'editing includes this order’s own held funds');
});

test('full-wallet Apply reserves available funds; only the explicit wallet payment commits the debit', async t => {
    const f = walletFixture(t, { purchased: 2500, orders: [{ id: 'order' }] });
    const ready = await preview(f, 'order', 2000);
    assert.equal(ready.body.walletOnlyReady, true);
    assert.equal(ready.body.summary.totalCents, 0);
    assert.equal(ready.body.summary.orderTotalCents, 2000);
    assert.equal(f.state.created.length, 0);
    assert.equal(f.ledger.entries.length, 0);
    assert.equal(f.ledger.holds.length, 1);
    assert.equal(f.ledger.holds[0].stripeParametersJson.walletOnly, true);
    assert.equal((await f.service().snapshot('customer')).availableBalanceCents, 500);
    assert.equal((await f.payOrder('order')).body.paidWithWallet, true);
    assert.equal(f.ledger.entries.length, 1);
    assert.equal(f.ledger.holds.length, 0);
});

test('removing wallet credit safely expires the reduced card session before releasing its hold', async t => {
    const f = walletFixture(t, { purchased: 3000, orders: [{ id: 'order' }] });
    const first = await preview(f);
    const removed = await preview(f, 'order', 0);
    assert.equal(removed.code, 200);
    assert.equal(removed.body.summary.walletAppliedCents, 0);
    assert.equal(removed.body.summary.totalCents, 2000);
    assert.equal(f.sessions.get(first.body.sessionId).status, 'expired');
    assert.equal(f.ledger.holds.length, 0);
    assert.equal(f.ledger.entries.length, 0);
    assert.equal((await f.service().snapshot('customer')).availableBalanceCents, 3000);
});

test('failed expiration and a payment already confirming keep the original reservation and price intact', async t => {
    const f = walletFixture(t, { purchased: 3000, orders: [{ id: 'order' }] });
    const first = await preview(f);
    f.state.failExpire = true;
    assert.equal((await preview(f, 'order', 0)).code, 409);
    assert.equal(f.ledger.holds[0].amountCents, 750);
    assert.equal(f.state.created.length, 1);
    f.state.failExpire = false;
    f.sessions.get(first.body.sessionId).status = 'complete';
    const pending = await preview(f, 'order', 0);
    assert.equal(pending.body.completed, true);
    assert.equal(f.ledger.holds[0].amountCents, 750);
    assert.equal(f.ledger.entries.length, 0);
});

test('changing Gold safely replaces a split quote and keeps the selected wallet amount', async t => {
    const f = walletFixture(t, { purchased: 2000, orders: [{ id: 'order' }] });
    const first = await preview(f, 'order', 500);
    const changed = await f.checkout('order', { goldToUse: 100 });
    assert.equal(changed.code, 200);
    assert.equal(changed.body.summary.orderTotalCents, 1000);
    assert.equal(changed.body.summary.walletAppliedCents, 500);
    assert.equal(changed.body.summary.totalCents, 500);
    assert.equal(f.sessions.get(first.body.sessionId).status, 'expired');
    assert.equal(f.ledger.holds.length, 1);
    assert.equal(f.ledger.holds[0].goldRedeemed, 100);
});

test('wallet requests are integer cents and preserve Stripe’s fifty-cent minimum', async t => {
    const f = walletFixture(t, { purchased: 5000, orders: [{ id: 'order' }] });
    for (const value of [-1, 0.1, '100', NaN, Number.MAX_SAFE_INTEGER]) assert.equal((await preview(f, 'order', value)).code, 400);
    const minimum = await preview(f, 'order', 1999);
    assert.equal(minimum.code, 200);
    assert.equal(minimum.body.summary.walletAppliedCents, 1950);
    assert.equal(minimum.body.summary.totalCents, 50);
    assert.equal(f.sessions.get(minimum.body.sessionId).amount_subtotal, 50);
});

test('a confirmed card remainder settles reserved wallet funds even after a reversal freezes the wallet', async t => {
    const f = walletFixture(t, { purchased: 1000, orders: [{ id: 'order' }] });
    const first = await preview(f, 'order', 750);
    f.ledger.accounts[0].purchasedBalanceCents = 0;
    f.ledger.accounts[0].frozenAt = new Date();
    assert.equal((await f.webhook('checkout.session.completed', paidSession(f, first.body.sessionId))).code, 200);
    assert.equal(f.state.orders[0].paymentStatus, 'PAID');
    assert.equal(f.state.orders[0].cashAmountCents, 2000);
    assert.equal(f.ledger.accounts[0].purchasedBalanceCents, -750);
    assert.equal(f.ledger.holds.length, 0);
    assert.equal((await f.service().snapshot('customer')).debtCents, 750);
});

test('lost first Stripe response and restart reuse the committed reservation and identical parameters', async t => {
    const f = walletFixture(t, { purchased: 3000, orders: [{ id: 'order' }] });
    f.loseCreateResponse();
    assert.equal((await preview(f)).code, 503);
    assert.equal(f.ledger.holds.length, 1);
    assert.equal(f.ledger.holds[0].stripeCheckoutSessionId, null);
    assert.equal(f.ledger.entries.length, 0);
    const recovered = await preview(f);
    assert.equal(recovered.code, 200);
    assert.equal(recovered.body.sessionId, 'cs_test_1');
    assert.equal(f.state.created.length, 1);
    assert.deepEqual(f.createCalls[0], f.createCalls[1]);
    assert.ok(f.createCalls[0].parameters.expires_at > Date.now() / 1000 + 22 * 3600);
});

test('payment after a lost session attachment recovers from hold metadata without losing the card charge', async t => {
    const f = walletFixture(t, { purchased: 3000, orders: [{ id: 'order' }] });
    f.loseCreateResponse();
    await preview(f);
    assert.equal(f.state.orders[0].stripeCheckoutSessionId, null);
    const paid = paidSession(f, 'cs_test_1');
    assert.equal((await f.webhook('checkout.session.completed', paid)).code, 200);
    assert.equal(f.state.orders[0].paymentStatus, 'PAID');
    assert.equal(f.state.orders[0].stripeCheckoutSessionId, 'cs_test_1');
    assert.equal(f.ledger.entries.length, 1);
});

test('cancellation releases only a confirmed expired hold, and a paid race reports the actual payment', async t => {
    const f = walletFixture(t, { purchased: 3000, orders: [{ id: 'order' }] });
    const first = await preview(f);
    const cancelled = await cancel(f, 'order', first.body.sessionId);
    assert.equal(cancelled.body.cancelled, true);
    assert.equal(f.ledger.holds.length, 0);
    assert.equal(f.ledger.entries.length, 0);
    const second = await preview(f);
    f.stripe.checkout.sessions.expire = async id => { Object.assign(f.sessions.get(id), paidSession(f, id)); throw new Error('payment won'); };
    const paid = await cancel(f, 'order', second.body.sessionId);
    assert.equal(paid.body.cancelled, false);
    assert.equal(paid.body.paid, true);
    assert.equal(f.ledger.entries.length, 1);
});

test('stale expiry and paid events cannot release or debit a newer quote', async t => {
    const f = walletFixture(t, { purchased: 3000, orders: [{ id: 'order' }] });
    const first = await preview(f);
    const stalePaid = paidSession(f, first.body.sessionId);
    const second = await preview(f, 'order', 500);
    const expired = { ...f.sessions.get(first.body.sessionId) };
    assert.equal((await f.webhook('checkout.session.expired', expired)).code, 200);
    assert.equal(f.ledger.holds[0].amountCents, 500);
    assert.equal((await f.webhook('checkout.session.completed', stalePaid)).code, 500, 'unmatched paid sessions require review, never a second wallet spend');
    assert.equal(f.ledger.entries.length, 0);
    assert.equal(f.ledger.holds[0].stripeCheckoutSessionId, second.body.sessionId);
});

test('simultaneous drafts reserve disjoint funds and cannot spend the same wallet cents', async t => {
    const f = walletFixture(t, { purchased: 3000, orders: [{ id: 'first' }, { id: 'second' }] });
    const results = await Promise.all([preview(f, 'first', 1500), preview(f, 'second', 1500)]);
    assert.deepEqual(results.map(result => result.code), [200, 200]);
    assert.equal((await f.service().snapshot('customer')).availableBalanceCents, 0);
    await Promise.all(results.map(result => f.webhook('checkout.session.completed', paidSession(f, result.body.sessionId))));
    assert.equal(f.ledger.accounts[0].purchasedBalanceCents, 0);
    assert.equal(f.ledger.entries.length, 2);
    assert.equal(f.ledger.holds.length, 0);
});

test('settlement rolls wallet debit, hold consumption and paid order back together when receipt queuing fails', async t => {
    const f = walletFixture(t, { purchased: 3000, orders: [{ id: 'order' }] });
    const first = await preview(f);
    f.state.failQueue = true;
    const paid = paidSession(f, first.body.sessionId);
    assert.equal((await f.webhook('checkout.session.completed', paid)).code, 500);
    assert.equal(f.ledger.entries.length, 0);
    assert.equal(f.ledger.holds.length, 1);
    assert.equal(f.ledger.accounts[0].purchasedBalanceCents, 3000);
    assert.equal(f.state.orders[0].paymentStatus, 'PENDING');
    f.state.failQueue = false;
    assert.equal((await f.webhook('checkout.session.completed', paid)).code, 200);
    assert.equal(f.ledger.entries.length, 1);
    assert.equal(f.ledger.holds.length, 0);
});

test('economic totals fund cashback and earnings, while receipt tenders reconcile wallet plus card', async t => {
    const f = walletFixture(t, { purchased: 2000, orders: [
        { id: 'prior', status: 'COMPLETED', paymentStatus: 'PAID', totalPrice: 500 },
        { id: 'order', status: 'COMPLETED' },
    ] });
    const result = await preview(f, 'order', 500, { goldToUse: 100 });
    assert.equal(result.body.summary.orderTotalCents, 1000);
    assert.equal(result.body.summary.totalCents, 500);
    assert.equal((await f.webhook('checkout.session.completed', paidSession(f, result.body.sessionId))).code, 200);
    const order = f.state.orders.find(row => row.id === 'order');
    assert.equal(order.cashAmountCents, 1000);
    assert.equal(orderEarnings(order).boosterCents, 700);
    assert.equal(f.ledger.entries.find(row => row.type === 'CASHBACK').amountCents, 50);
    const receipt = buildConfirmation(order, 'receipt@example.test', { type: 'card', brand: 'visa', last4: '4242' });
    assert.match(receipt.text, /Total: (?:US)?\$10\.00/);
    assert.match(receipt.text, /FastBoost Wallet: (?:US)?\$5\.00/);
    assert.match(receipt.text, /VISA \(•••• 4242\): (?:US)?\$5\.00/);
});

test('Gold transfer recovers and closes a split reservation before changing the older order’s quote', async t => {
    const f = walletFixture(t, { purchased: 3000, orders: [{ id: 'first' }, { id: 'second' }] });
    f.loseCreateResponse();
    const first = await preview(f, 'first', 500, { goldToUse: 100 });
    assert.equal(first.code, 503);
    assert.equal(f.ledger.holds[0].stripeCheckoutSessionId, null);
    const second = await f.checkout('second', { goldToUse: 100 });
    assert.equal(second.code, 200);
    assert.equal(f.sessions.get('cs_test_1').status, 'expired');
    assert.equal(f.ledger.holds.length, 0);
    assert.equal(f.state.orders[0].cashAmountCents, 2000);
    assert.equal(f.state.orders[0].goldRedeemed, 0);
    assert.equal(f.ledger.entries.length, 0);
});

test('a new coupon expires the old split session before using its revised economic total', async t => {
    const f = walletFixture(t, { purchased: 3000, orders: [{ id: 'order' }] });
    const first = await preview(f);
    const sale = { id: 'coupon', title: 'Ten percent', couponCode: 'SAVE10', scope: 'GLOBAL', active: true, discountPercent: 10 };
    f.db.serviceSale = { findFirst: async () => sale, findUnique: async () => sale };
    let claim;
    f.db.couponUse = { findUnique: async () => claim || null, create: async ({ data }) => { claim = { id: 'claim', ...data, usedAt: null }; return claim; } };
    const changed = await preview(f, 'order', 750, { couponCode: 'SAVE10' });
    assert.equal(changed.code, 200);
    assert.equal(changed.body.summary.orderTotalCents, 1800);
    assert.equal(changed.body.summary.totalCents, 1050);
    assert.equal(f.sessions.get(first.body.sessionId).status, 'expired');
    assert.equal(f.ledger.holds[0].stripeParametersJson.metadata.couponCode, 'SAVE10');
    assert.equal(f.ledger.entries.length, 0);
});

test('expiry releases only its exact hold and missed expiry webhooks are reclaimed before another spend', async t => {
    const f = walletFixture(t, { purchased: 2500, orders: [{ id: 'order' }, { id: 'other' }] });
    const first = await preview(f, 'order', 1000);
    const session = f.sessions.get(first.body.sessionId);
    session.status = 'expired';
    f.ledger.holds[0].stripeParametersJson.expires_at = Math.floor(Date.now() / 1000) - 1;
    assert.equal((await f.payOrder('other')).code, 200);
    assert.equal(f.ledger.holds.length, 0);
    assert.equal(f.ledger.accounts[0].purchasedBalanceCents, 500);
    assert.equal((await f.webhook('checkout.session.expired', session)).code, 200);
    assert.equal(f.ledger.accounts[0].purchasedBalanceCents, 500);
});

test('frozen wallets and foreign orders cannot reserve new funds, and card refunds do not mint wallet credit', async t => {
    const f = walletFixture(t, { purchased: 3000, orders: [{ id: 'order' }, { id: 'foreign', customerId: 'other' }] });
    assert.equal((await preview(f, 'foreign')).code, 403);
    f.ledger.accounts[0].frozenAt = new Date();
    assert.equal((await preview(f)).body.code, 'WALLET_FROZEN');
    assert.equal(f.ledger.holds.length, 0);
    f.ledger.accounts[0].frozenAt = null;
    const first = await preview(f);
    assert.equal((await f.webhook('checkout.session.completed', paidSession(f, first.body.sessionId))).code, 200);
    f.intents.set('pi_unrelated_card', { id: 'pi_unrelated_card', metadata: {} });
    assert.equal((await f.webhook('charge.refunded', { payment_intent: 'pi_unrelated_card', amount_refunded: 100, metadata: {} })).code, 200);
    assert.equal(f.ledger.entries.length, 1);
    assert.equal(f.ledger.accounts[0].purchasedBalanceCents, 2250);
});

test('verification recovers a paid reservation before session attachment and never fetches a foreign session', async t => {
    const f = walletFixture(t, { purchased: 3000, orders: [{ id: 'order' }, { id: 'ordinary' }] });
    f.loseCreateResponse();
    await preview(f);
    Object.assign(f.sessions.get('cs_test_1'), paidSession(f, 'cs_test_1'));
    const verified = f.response();
    await f.controller.verifyCheckoutSession({ user: { id: 'customer' }, query: { orderId: 'order', sessionId: 'cs_test_1' } }, verified);
    assert.equal(verified.body.paid, true);
    assert.equal(f.ledger.entries.length, 1);
    const ordinary = await f.checkout('ordinary', { goldToUse: 0 });
    let reads = 0;
    f.stripe.checkout.sessions.retrieve = async () => { reads++; throw new Error('foreign session must not be retrieved'); };
    const rejected = f.response();
    await f.controller.verifyCheckoutSession({ user: { id: 'customer' }, query: { orderId: 'ordinary', sessionId: 'cs_foreign' } }, rejected);
    assert.equal(rejected.code, 404);
    assert.equal(reads, 0);
    assert.ok(ordinary.body.sessionId);
});

test('unpaid order deletion or edits recover and close an unattached held session before mutating the order', async t => {
    const f = walletFixture(t, { purchased: 3000, orders: [{ id: 'order' }] });
    f.loseCreateResponse();
    await preview(f);
    let mutations = 0;
    await mutateCheckoutOrder(f.db, f.state.orders[0], f.stripe, async () => {
        assert.equal(f.ledger.holds.length, 0);
        assert.equal(f.sessions.get('cs_test_1').status, 'expired');
        mutations++;
    });
    assert.equal(mutations, 1);
    const next = await preview(f);
    Object.assign(f.sessions.get(next.body.sessionId), paidSession(f, next.body.sessionId));
    await assert.rejects(mutateCheckoutOrder(f.db, f.state.orders[0], f.stripe, async () => { mutations++; }), { code: 'WALLET_CHECKOUT_PENDING' });
    assert.equal(mutations, 1);
    assert.equal(f.ledger.holds.length, 1);
});

test('a previous ordinary card expiry cannot cancel the new reserved quote before its session attaches', async t => {
    const f = walletFixture(t, { purchased: 3000, orders: [{ id: 'order' }] });
    const ordinary = await f.checkout('order', { goldToUse: 0 });
    f.loseCreateResponse();
    assert.equal((await preview(f)).code, 503);
    assert.equal(f.ledger.holds.length, 1);
    assert.equal(f.ledger.holds[0].stripeCheckoutSessionId, null);
    const expired = f.sessions.get(ordinary.body.sessionId);
    assert.equal(expired.status, 'expired');
    let locked = false;
    const query = f.db.$queryRaw;
    f.db.$queryRaw = async (...args) => { if (args[0].join('').includes('FOR UPDATE')) locked = true; return query(...args); };
    const find = f.db.walletCheckoutHold.findUnique;
    f.db.walletCheckoutHold.findUnique = async (...args) => { assert.equal(locked, true, 'expiry must check for newer holds after acquiring checkout locks'); return find(...args); };
    assert.equal((await f.webhook('checkout.session.expired', expired)).code, 200);
    assert.equal(f.state.orders[0].paymentStatus, 'PENDING');
    assert.equal(f.ledger.holds.length, 1);
    assert.equal((await preview(f)).code, 200);
});

test('full-wallet holds block another order and release immediately on removal or cancellation without Stripe calls', async t => {
    const f = walletFixture(t, { purchased: 2500, orders: [{ id: 'order' }, { id: 'other' }] });
    assert.equal((await preview(f, 'order', 2000)).body.walletOnlyReady, true);
    assert.equal((await preview(f, 'other', 1000)).body.code, 'WALLET_INSUFFICIENT');
    assert.equal((await f.payOrder('other')).body.code, 'WALLET_INSUFFICIENT');
    let stripeCalls = 0;
    for (const method of ['retrieve', 'create', 'expire']) f.stripe.checkout.sessions[method] = async () => { stripeCalls++; throw new Error('wallet-only hold must not contact Stripe'); };
    const cancelled = await cancel(f, 'order');
    assert.equal(cancelled.body.cancelled, true);
    assert.equal(f.ledger.holds.length, 0);
    assert.equal((await f.service().snapshot('customer')).availableBalanceCents, 2500);
    assert.equal(stripeCalls, 0);
    assert.equal(f.ledger.entries.length, 0);
});

test('full-wallet retries reuse one hold after response loss and cannot consume reversed or frozen funds', async t => {
    const f = walletFixture(t, { purchased: 2500, orders: [{ id: 'order' }] });
    const transact = f.db.$transaction;
    let lost = true;
    f.db.$transaction = async (...args) => {
        const result = await transact(...args);
        if (lost) { lost = false; throw new Error('hold committed but response lost'); }
        return result;
    };
    assert.equal((await preview(f, 'order', 2000)).code, 503);
    assert.equal(f.ledger.holds.length, 1);
    const holdId = f.ledger.holds[0].id;
    const recovered = await preview(f, 'order', 2000);
    assert.equal(recovered.body.walletOnlyReady, true);
    assert.equal(f.ledger.holds[0].id, holdId);
    assert.equal(f.state.created.length, 0);
    f.ledger.accounts[0].purchasedBalanceCents = 0;
    f.ledger.accounts[0].frozenAt = new Date();
    assert.equal((await f.payOrder('order')).body.code, 'WALLET_FROZEN');
    assert.equal(f.ledger.entries.length, 0);
    assert.equal(f.state.orders[0].paymentStatus, 'PENDING');
    assert.equal(f.ledger.holds.length, 1);
    assert.equal((await cancel(f, 'order')).body.cancelled, true, 'a frozen customer can release an unpaid full-wallet hold');
});

test('wallet balance reads lazily clear expired full-wallet and card holds while retaining live reservations', async t => {
    const f = walletFixture(t, { purchased: 4000, orders: [{ id: 'full' }, { id: 'split' }] });
    await preview(f, 'full', 2000);
    const split = await preview(f, 'split', 750);
    assert.equal((await f.service().snapshot('customer')).availableBalanceCents, 1250);
    f.ledger.holds.forEach(hold => { hold.stripeParametersJson.expires_at = Math.floor(Date.now() / 1000) - 1; });
    f.sessions.get(split.body.sessionId).status = 'expired';
    const snapshot = await f.service().snapshot('customer');
    assert.equal(snapshot.availableBalanceCents, 4000);
    assert.equal(snapshot.reservedBalanceCents, 0);
    assert.equal(snapshot.balanceCents, 4000);
    assert.equal(f.ledger.entries.length, 0);
    assert.equal(f.ledger.holds.length, 0);
});
