const test = require('node:test');
const assert = require('node:assert/strict');
const { WALLET_PACKAGES } = require('../src/utils/customerWallet');
const { walletFixture } = require('../test-helpers/walletFixture');
const topUp = (f, offer = 'usd-25') => f.service().createTopUp('customer', offer, 'http://localhost:5173');

test('wallet offers exactly the five USD packages and fixed bonus credits', async t => {
    assert.deepEqual(WALLET_PACKAGES.map(p => [p.amountCents, p.bonusPercent, p.bonusCents, p.creditCents]),
        [[500, 10, 50, 550], [1000, 10, 100, 1100], [2500, 12, 300, 2800], [5000, 13, 650, 5650], [10000, 15, 1500, 11500]]);
    const f = walletFixture(t);
    await assert.rejects(topUp(f, 'usd-999'), { code: 'WALLET_PACKAGE' });
    assert.equal(f.state.created.length, 0);
    assert.equal((await f.service().snapshot('other')).balanceCents, 0);
    assert.equal(f.ledger.accounts.length, 1, 'balance reads never create accounts');
});

test('concurrent top-up creation and restart reuse one durable intent and Stripe idempotency key', async t => {
    const f = walletFixture(t);
    const [first, second] = await Promise.all([topUp(f), topUp(f)]);
    assert.equal(first.sessionId, second.sessionId);
    assert.equal(first.url, second.url);
    assert.equal(f.state.created.length, 1);
    assert.equal(f.ledger.topUps.length, 1);
    assert.equal((await topUp(f)).sessionId, first.sessionId);
    assert.equal(f.ledger.entries.length, 0, 'checkout preparation never grants balance');
});

test('lost Stripe create reply is recoverable after restart without a second charge session', async t => {
    const f = walletFixture(t);
    f.loseCreateResponse();
    await assert.rejects(topUp(f), /response was lost/);
    assert.equal(f.ledger.topUps[0].status, 'CREATING');
    assert.equal(f.ledger.topUps[0].stripeCheckoutSessionId, null);
    const recovered = await topUp(f);
    assert.equal(recovered.sessionId, 'cs_test_1');
    assert.equal(f.state.created.length, 1);
    assert.equal(f.ledger.topUps.length, 1);
});

test('expired checkout starts a new intent while ambiguous old creates require review', async t => {
    const f = walletFixture(t);
    const first = await topUp(f);
    f.sessions.get(first.sessionId).status = 'expired';
    const next = await topUp(f);
    assert.notEqual(next.sessionId, first.sessionId);
    assert.equal(f.ledger.topUps[0].status, 'EXPIRED');
    f.ledger.topUps[1].stripeCheckoutSessionId = null;
    f.ledger.topUps[1].createdAt = new Date(Date.now() - 24 * 3600000);
    await assert.rejects(topUp(f), { code: 'WALLET_TOPUP_REVIEW_REQUIRED' });
    assert.equal(f.state.created.length, 2);
});

test('paid top-up webhooks and verification credit purchased/bonus exactly once across duplicate events', async t => {
    const f = walletFixture(t);
    const created = await topUp(f);
    const session = f.paidTopUp(created.sessionId);
    const replies = await Promise.all([
        f.webhook('checkout.session.completed', session), f.webhook('checkout.session.async_payment_succeeded', session),
        f.service().verify('customer', { sessionId: session.id }),
    ]);
    assert.equal(replies[0].code, 200);
    assert.equal(replies[1].code, 200);
    assert.equal(replies[2].paid, true);
    assert.equal(f.ledger.entries.length, 1);
    assert.equal(f.ledger.accounts[0].purchasedBalanceCents, 2500);
    assert.equal(f.ledger.accounts[0].promotionalBalanceCents, 300);
    assert.equal((await f.service().snapshot('customer')).balanceCents, 2800);
    assert.equal(f.state.queued.length, 0, 'top-ups are not service orders');
});

test('top-up return verification enforces ownership before retrieving Stripe', async t => {
    const f = walletFixture(t);
    const created = await topUp(f);
    await assert.rejects(f.service().verify('other', { sessionId: created.sessionId }), { code: 'WALLET_TOPUP_UNAVAILABLE' });
    await assert.rejects(f.service().verify('other', { topUpId: created.topUpId }), { code: 'WALLET_TOPUP_UNAVAILABLE' });
    await assert.rejects(f.service().verify('customer', { sessionId: ['cs_bad'] }), { code: 'WALLET_TOPUP_ID' });
    assert.equal(f.ledger.entries.length, 0);
});

test('session amount, currency, mode, environment and metadata mismatches cannot grant credit', async t => {
    const f = walletFixture(t);
    const created = await topUp(f);
    const paid = f.paidTopUp(created.sessionId);
    for (const change of [
        { amount_total: 2499 }, { amount_subtotal: 1 }, { currency: 'cad' }, { livemode: true }, { mode: 'setup' },
        { metadata: { ...paid.metadata, customerId: 'other' } }, { metadata: { ...paid.metadata, bonusCents: '999999' } },
        { id: 'cs_different' }, { payment_intent: 'pi_other' },
    ]) await assert.rejects(f.service().settle({ ...paid, ...change }));
    assert.equal(f.ledger.entries.length, 0);
    assert.equal(f.ledger.accounts[0].purchasedBalanceCents, 0);
});

test('PaymentIntent mismatch and unverified charge cannot grant credit', async t => {
    const f = walletFixture(t);
    const created = await topUp(f);
    const session = f.paidTopUp(created.sessionId);
    const original = structuredClone(f.intents.get(session.payment_intent));
    for (const change of [{ amount_received: 1 }, { metadata: {} }, { status: 'processing' }, { latest_charge: 'ch_not_expanded' },
        { latest_charge: { ...original.latest_charge, paid: false } }]) {
        f.intents.set(session.payment_intent, { ...original, ...change });
        await assert.rejects(f.service().settle(session), { code: 'WALLET_QUOTE_MISMATCH' });
    }
    assert.equal(f.ledger.entries.length, 0);
});

test('metadata-bearing refund reverses the entire credited top-up and freezes spent debt exactly once', async t => {
    const f = walletFixture(t, { orders: [{ id: 'first' }] });
    const created = await topUp(f);
    const session = f.paidTopUp(created.sessionId);
    await f.service().settle(session);
    assert.equal((await f.payOrder('first')).code, 200);
    const charge = { ...f.intents.get(session.payment_intent).latest_charge, amount_refunded: 500, metadata: session.metadata };
    assert.equal((await f.webhook('charge.refunded', charge)).code, 200);
    assert.equal((await f.webhook('charge.refunded', charge)).code, 200);
    const wallet = await f.service().snapshot('customer');
    assert.equal(wallet.frozen, true);
    assert.equal(wallet.balanceCents, 0);
    assert.equal(wallet.debtCents, 2000);
    assert.equal(f.ledger.entries.filter(row => row.type === 'TOP_UP_REVERSAL').length, 1);
    await assert.rejects(topUp(f), { code: 'WALLET_FROZEN' });
});

test('refund arriving before completion and refunded charge lookup never issue usable balance', async t => {
    const f = walletFixture(t);
    const created = await topUp(f);
    const session = f.paidTopUp(created.sessionId);
    const charge = { ...f.intents.get(session.payment_intent).latest_charge, amount_refunded: 2500 };
    await f.webhook('charge.refunded', charge);
    await f.service().settle(session);
    assert.equal(f.ledger.entries.length, 0);
    assert.equal(f.ledger.topUps[0].status, 'REVERSED');
    assert.equal((await f.service().snapshot('customer')).frozen, true);
});

test('charge already refunded before a delayed paid webhook is frozen without credit', async t => {
    const f = walletFixture(t);
    const created = await topUp(f);
    const session = f.paidTopUp(created.sessionId);
    f.intents.get(session.payment_intent).latest_charge.amount_refunded = 2500;
    await f.service().settle(session);
    assert.equal(f.ledger.topUps[0].status, 'REVERSED');
    assert.equal(f.ledger.entries.length, 0);
});

test('dispute resolves its charge, reverses once, and a later paid event cannot regrant credit', async t => {
    const f = walletFixture(t);
    const created = await topUp(f, 'usd-5');
    const session = f.paidTopUp(created.sessionId);
    await f.service().settle(session);
    const dispute = { charge: f.intents.get(session.payment_intent).latest_charge.id, metadata: session.metadata };
    await f.webhook('charge.dispute.created', dispute);
    await f.webhook('charge.dispute.funds_withdrawn', dispute);
    await f.service().settle(session);
    assert.equal(f.ledger.entries.length, 2);
    assert.equal(f.ledger.accounts[0].purchasedBalanceCents, 0);
    assert.ok(f.ledger.accounts[0].frozenAt);
});

test('top-up create recovery reports reversed when a dispute overtakes its completed session', async t => {
    const f = walletFixture(t);
    const created = await topUp(f);
    const session = f.paidTopUp(created.sessionId);
    const retrieve = f.stripe.checkout.sessions.retrieve;
    let reverse = true;
    f.stripe.checkout.sessions.retrieve = async (...args) => {
        if (reverse) {
            reverse = false;
            await f.webhook('charge.dispute.created', { payment_intent: session.payment_intent });
        }
        return retrieve(...args);
    };
    const recovered = await topUp(f);
    assert.equal(recovered.status, 'reversed');
    assert.equal(recovered.paid, false);
    assert.equal(f.ledger.entries.length, 0);
});

test('top-up credit rollback and lost commit reply recover exactly one ledger credit', async t => {
    const f = walletFixture(t);
    const created = await topUp(f);
    const session = f.paidTopUp(created.sessionId);
    const update = f.db.walletTopUp.update;
    f.db.walletTopUp.update = async args => {
        if (args.data.status === 'PAID') throw new Error('simulated paid-state persistence failure');
        return update(args);
    };
    await assert.rejects(f.service().settle(session), /persistence/);
    assert.equal(f.ledger.entries.length, 0);
    assert.equal(f.ledger.accounts[0].purchasedBalanceCents, 0);
    f.db.walletTopUp.update = update;
    const transact = f.db.$transaction;
    let lose = true;
    f.db.$transaction = async (...args) => {
        const result = await transact(...args);
        if (lose) { lose = false; throw new Error('database committed but acknowledgement was lost'); }
        return result;
    };
    await assert.rejects(f.service().settle(session), /acknowledgement/);
    assert.equal(f.ledger.topUps[0].status, 'PAID');
    assert.equal((await f.service().verify('customer', { sessionId: session.id })).paid, true);
    await f.service().settle(session);
    assert.equal(f.ledger.entries.length, 1);
    assert.equal(f.ledger.accounts[0].purchasedBalanceCents, 2500);
});

test('a changed pending Stripe quote is rejected before returning a payment URL', async t => {
    const f = walletFixture(t);
    const created = await topUp(f);
    f.sessions.get(created.sessionId).amount_total = 999;
    await assert.rejects(topUp(f), { code: 'WALLET_QUOTE_MISMATCH' });
    assert.equal(f.ledger.entries.length, 0);
    assert.equal(f.state.created.length, 1);
});
