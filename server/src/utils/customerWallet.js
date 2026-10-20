const WALLET_PACKAGES = Object.freeze([
    [5, 10], [10, 10], [25, 12], [50, 13], [100, 15],
].map(([dollars, bonusPercent]) => Object.freeze({
    id: `usd-${dollars}`, amountCents: dollars * 100, bonusPercent,
    bonusCents: dollars * bonusPercent,
    creditCents: dollars * 100 + dollars * bonusPercent,
})));
const stripeOptions = { timeout: 8000, maxNetworkRetries: 0 };
const transactionOptions = { maxWait: 15000, timeout: 30000 };
const error = (code, message, status = 409) => Object.assign(new Error(message), { code, status });
const paymentIntentId = session => typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id;
const packageFor = id => WALLET_PACKAGES.find(item => item.id === id);
const integer = value => Number.isSafeInteger(value) && Math.abs(value) <= 2147483647;

function assertUsable(account) {
    if (account?.frozenAt) throw error('WALLET_FROZEN', 'Your wallet is on hold. Please contact support before using it.');
}

function validateSessionQuote(topUp, session) {
    const offer = packageFor(topUp.packageId);
    const metadata = session.metadata || {};
    const mode = /^(?:sk|rk)_(live|test)_/.exec(process.env.STRIPE_SECRET_KEY || '')?.[1];
    if (!offer || topUp.currency !== 'usd' || topUp.amountCents !== offer.amountCents || topUp.bonusCents !== offer.bonusCents || topUp.bonusPercent !== offer.bonusPercent ||
        session.object !== 'checkout.session' || session.mode !== 'payment' ||
        typeof session.livemode !== 'boolean' || (mode && session.livemode !== (mode === 'live')) ||
        session.currency !== 'usd' || session.amount_subtotal !== offer.amountCents || session.amount_total !== offer.amountCents ||
        metadata.kind !== 'wallet_topup' || metadata.walletTopUpId !== topUp.id || metadata.customerId !== topUp.userId ||
        metadata.packageId !== offer.id || metadata.amountCents !== String(offer.amountCents) || metadata.bonusCents !== String(offer.bonusCents) ||
        (topUp.stripeCheckoutSessionId && topUp.stripeCheckoutSessionId !== session.id) ||
        (topUp.stripePaymentIntentId && topUp.stripePaymentIntentId !== paymentIntentId(session))) {
        throw error('WALLET_QUOTE_MISMATCH', 'The top-up payment does not match its saved package.', 400);
    }
}

function validateQuote(topUp, session) {
    validateSessionQuote(topUp, session);
    if (session.status !== 'complete' || session.payment_status !== 'paid' || !/^pi_[A-Za-z0-9_]+$/.test(paymentIntentId(session) || '')) {
        throw error('WALLET_QUOTE_MISMATCH', 'The top-up payment has not completed.', 400);
    }
}

function validateIntent(topUp, session, intent) {
    const charge = intent?.latest_charge;
    if (!intent || intent.id !== paymentIntentId(session) || intent.status !== 'succeeded' || intent.currency !== 'usd' ||
        intent.amount !== topUp.amountCents || intent.amount_received !== topUp.amountCents || intent.livemode !== session.livemode ||
        intent.metadata?.walletTopUpId !== topUp.id || intent.metadata?.customerId !== topUp.userId ||
        !charge || typeof charge !== 'object' || charge.paid !== true || charge.currency !== 'usd' || charge.amount !== topUp.amountCents ||
        !Number.isSafeInteger(charge.amount_refunded) || charge.amount_refunded < 0 || charge.amount_refunded > topUp.amountCents ||
        typeof charge.refunded !== 'boolean' || typeof charge.disputed !== 'boolean' ||
        (charge.payment_intent && charge.payment_intent !== intent.id)) {
        throw error('WALLET_QUOTE_MISMATCH', 'The top-up charge could not be verified.', 400);
    }
    return charge.amount_refunded > 0 || charge.refunded === true || charge.disputed === true;
}

function createWalletService({ prisma, stripe }) {
    async function lockAccount(db, userId) {
        const users = await db.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
        // Account deletion must not turn a late webhook into orphan credit.
        if (!users.length) throw error('WALLET_ACCOUNT_UNAVAILABLE', 'This wallet account is unavailable.', 404);
        return db.walletAccount.upsert({ where: { userId }, create: { userId }, update: {} });
    }

    async function snapshot(userId, db = prisma) {
        const account = await db.walletAccount.findUnique({ where: { userId } });
        const transactions = await db.walletEntry.findMany({ where: { userId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 50,
            select: { id: true, type: true, amountCents: true, purchasedCents: true, promotionalCents: true, createdAt: true, orderId: true, description: true } });
        const purchased = account?.purchasedBalanceCents || 0;
        const promotional = account?.promotionalBalanceCents || 0;
        return { currency: 'usd', balanceCents: Math.max(0, purchased + promotional), purchasedBalanceCents: purchased,
            promotionalBalanceCents: promotional, debtCents: Math.max(0, -purchased) + Math.max(0, -promotional),
            frozen: Boolean(account?.frozenAt), packages: WALLET_PACKAGES, transactions };
    }

    async function postEntry(db, account, { key, type, purchasedCents, promotionalCents, topUpId, orderId, description }) {
        const purchasedBalanceCents = account.purchasedBalanceCents + purchasedCents;
        const promotionalBalanceCents = account.promotionalBalanceCents + promotionalCents;
        if (![purchasedCents, promotionalCents, purchasedBalanceCents, promotionalBalanceCents, purchasedBalanceCents + promotionalBalanceCents].every(integer)) {
            throw error('WALLET_LIMIT', 'Your wallet cannot accept this transaction. Please contact support.');
        }
        await db.walletEntry.create({ data: { userId: account.userId, key, type, purchasedCents, promotionalCents,
            amountCents: purchasedCents + promotionalCents, topUpId, orderId, description } });
        return db.walletAccount.update({ where: { userId: account.userId }, data: { purchasedBalanceCents, promotionalBalanceCents } });
    }

    // Called only inside the order's existing customer/order-lock transaction.
    async function spend(db, userId, order, amountCents) {
        if (!integer(amountCents) || amountCents <= 0 || (order.currency || 'usd').toLowerCase() !== 'usd') {
            throw error('WALLET_CURRENCY', 'Wallet payments are available for USD orders only.', 400);
        }
        const account = await lockAccount(db, userId);
        assertUsable(account);
        if (account.purchasedBalanceCents < 0 || account.promotionalBalanceCents < 0 || account.purchasedBalanceCents + account.promotionalBalanceCents < amountCents) {
            throw error('WALLET_INSUFFICIENT', 'Your wallet balance does not cover this order. Please top up or pay by card.');
        }
        // Purchased funds are consumed first; promotional credit remains separate.
        const purchasedCents = Math.min(account.purchasedBalanceCents, amountCents);
        const promotionalCents = amountCents - purchasedCents;
        await postEntry(db, account, { key: `order:${order.id}`, type: 'ORDER_PAYMENT', purchasedCents: -purchasedCents,
            promotionalCents: -promotionalCents, orderId: order.id, description: `Payment for order #${order.orderNumber}.` });
        return { walletAmountCents: amountCents, walletPurchasedCents: purchasedCents, walletPromotionalCents: promotionalCents };
    }

    // The caller owns the order lifecycle transaction and computes eligibility
    // from its locked authoritative order. Entitlements survive order deletion.
    async function adjustCashback(db, { orderId, userId, targetCents }) {
        if (!integer(targetCents) || targetCents < 0) throw error('WALLET_CASHBACK_INVALID', 'The cashback amount is invalid.', 400);
        const account = await lockAccount(db, userId);
        const entitlement = await db.walletCashbackEntitlement.upsert({ where: { orderId }, create: { orderId, userId }, update: {} });
        if (entitlement.userId !== userId) throw error('WALLET_CASHBACK_INVALID', 'The cashback account changed.', 409);
        const delta = targetCents - entitlement.entitledCents;
        if (!delta) return entitlement;
        const revision = entitlement.revision + 1;
        if (!integer(revision)) throw error('WALLET_LIMIT', 'This wallet transaction requires support review.');
        const updated = await postEntry(db, account, { key: `cashback:${orderId}:${revision}`, type: delta > 0 ? 'CASHBACK' : 'CASHBACK_REVERSAL',
            purchasedCents: 0, promotionalCents: delta, orderId,
            description: delta > 0 ? 'Cashback from a completed service order.' : 'Cashback reversed after an order change.' });
        if (updated.promotionalBalanceCents < 0 || updated.purchasedBalanceCents < 0) await db.walletAccount.update({ where: { userId }, data: {
            frozenAt: account.frozenAt || new Date(), freezeReason: account.freezeReason || 'Spent cashback was reversed. Please contact support.',
        } });
        return db.walletCashbackEntitlement.update({ where: { orderId }, data: { entitledCents: targetCents, revision } });
    }

    async function reverseLocked(db, account, topUp, intentId, reason) {
        if (topUp.status === 'REVERSED') return false;
        if (topUp.status === 'PAID') await postEntry(db, account, { key: `reversal:${topUp.id}`, type: 'TOP_UP_REVERSAL',
            purchasedCents: -topUp.amountCents, promotionalCents: -topUp.bonusCents, topUpId: topUp.id,
            description: 'Top-up and bonus reversed after a refund or payment dispute.' });
        await db.walletAccount.update({ where: { userId: topUp.userId }, data: {
            frozenAt: account.frozenAt || new Date(), freezeReason: reason,
        } });
        await db.walletTopUp.update({ where: { id: topUp.id }, data: { status: 'REVERSED', reversedAt: new Date(), stripePaymentIntentId: intentId } });
        return true;
    }

    async function settle(session) {
        const id = session.metadata?.walletTopUpId;
        const initial = id ? await prisma.walletTopUp.findUnique({ where: { id } }) : null;
        if (!initial) throw error('WALLET_TOPUP_UNAVAILABLE', 'The top-up could not be located.', 404);
        validateQuote(initial, session);
        // Refund/dispute events can overtake payment completion. Check the charge
        // before issuing credit, then serialize both event paths on the same user.
        const intent = await stripe.paymentIntents.retrieve(paymentIntentId(session), { expand: ['latest_charge'] }, stripeOptions);
        const reversed = validateIntent(initial, session, intent);
        return prisma.$transaction(async db => {
            const account = await lockAccount(db, initial.userId);
            const current = await db.walletTopUp.findUnique({ where: { id } });
            validateQuote(current, session);
            if (current.status === 'REVERSED') {
                if (!current.stripeCheckoutSessionId) await db.walletTopUp.update({ where: { id }, data: { stripeCheckoutSessionId: session.id } });
                return false;
            }
            if (reversed) return reverseLocked(db, account, current, intent.id, 'Top-up refund or dispute requires support review.');
            if (current.status === 'PAID') return false;
            await postEntry(db, account, { key: `topup:${id}`, type: 'TOP_UP', purchasedCents: current.amountCents,
                promotionalCents: current.bonusCents, topUpId: id,
                description: `$${(current.amountCents / 100).toFixed(2)} top-up with ${current.bonusPercent}% bonus.` });
            await db.walletTopUp.update({ where: { id }, data: { status: 'PAID', paidAt: new Date(), stripeCheckoutSessionId: session.id,
                stripePaymentIntentId: intent.id } });
            return true;
        }, transactionOptions);
    }

    async function createTopUp(userId, packageId, clientUrl) {
        const offer = packageFor(packageId);
        if (!offer) throw error('WALLET_PACKAGE', 'Choose one of the available top-up packages.', 400);
        for (let attempt = 0; attempt < 3; attempt++) {
            // Persist the intent BEFORE contacting Stripe. A lost network reply
            // retries the same durable ID/idempotency key, including after restart.
            const topUp = await prisma.$transaction(async db => {
                const account = await lockAccount(db, userId);
                assertUsable(account);
                return await db.walletTopUp.findFirst({ where: { userId, packageId, status: { in: ['CREATING', 'PENDING'] } }, orderBy: { createdAt: 'desc' } }) ||
                    db.walletTopUp.create({ data: { userId, packageId, amountCents: offer.amountCents, bonusPercent: offer.bonusPercent,
                        bonusCents: offer.bonusCents, currency: 'usd', clientUrl } });
            }, transactionOptions);
            // Stripe may prune an idempotency key after 24h. An ambiguous old
            // create must be reviewed, never silently charged a second time.
            if (!topUp.stripeCheckoutSessionId && Date.now() - new Date(topUp.createdAt).getTime() > 23 * 60 * 60 * 1000) {
                throw error('WALLET_TOPUP_REVIEW_REQUIRED', 'An earlier top-up needs support review before retrying this package.');
            }
            const metadata = { kind: 'wallet_topup', walletTopUpId: topUp.id, customerId: userId, packageId,
                amountCents: String(offer.amountCents), bonusCents: String(offer.bonusCents) };
            let session;
            if (topUp.stripeCheckoutSessionId) session = await stripe.checkout.sessions.retrieve(topUp.stripeCheckoutSessionId, {}, stripeOptions);
            else {
                const created = await stripe.checkout.sessions.create({ mode: 'payment', payment_method_types: ['card', 'link'],
                    adaptive_pricing: { enabled: false }, automatic_tax: { enabled: false },
                    line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: offer.amountCents,
                        product_data: { name: 'FastBoost wallet top-up', description: `$${(offer.creditCents / 100).toFixed(2)} store credit, including ${offer.bonusPercent}% bonus` } } }],
                    metadata, payment_intent_data: { metadata },
                    success_url: `${topUp.clientUrl}/account/wallet?wallet_session_id={CHECKOUT_SESSION_ID}`,
                    cancel_url: `${topUp.clientUrl}/account/wallet?wallet_cancelled=1`,
                }, { ...stripeOptions, idempotencyKey: `wallet-topup-v1-${topUp.id}` });
                session = await stripe.checkout.sessions.retrieve(created.id, {}, stripeOptions);
            }
            validateSessionQuote(topUp, session);
            await prisma.$transaction(async db => {
                await lockAccount(db, userId);
                const current = await db.walletTopUp.findUnique({ where: { id: topUp.id } });
                if (current.stripeCheckoutSessionId && current.stripeCheckoutSessionId !== session.id) throw error('WALLET_QUOTE_MISMATCH', 'The top-up session changed.', 400);
                if (['CREATING', 'PENDING'].includes(current.status)) await db.walletTopUp.update({ where: { id: topUp.id }, data: {
                    stripeCheckoutSessionId: session.id, status: session.status === 'expired' ? 'EXPIRED' : 'PENDING',
                } });
            }, transactionOptions);
            if (session.status === 'expired') continue;
            if (session.status === 'complete' && session.payment_status === 'paid') {
                await settle(session);
                const verified = await prisma.walletTopUp.findUnique({ where: { id: topUp.id } });
                return { topUpId: topUp.id, sessionId: session.id, status: verified.status === 'PAID' ? 'paid' : 'reversed', paid: verified.status === 'PAID' };
            }
            if (session.status !== 'open' || typeof session.url !== 'string' || !session.url.startsWith('https://checkout.stripe.com/')) {
                throw error('WALLET_CHECKOUT_UNAVAILABLE', 'Top-up checkout is not available. Please retry shortly.', 503);
            }
            const currentAccount = await prisma.walletAccount.findUnique({ where: { userId } });
            assertUsable(currentAccount);
            return { topUpId: topUp.id, sessionId: session.id, url: session.url, status: 'pending' };
        }
        throw error('WALLET_CHECKOUT_UNAVAILABLE', 'Top-up checkout could not be prepared. Please retry shortly.', 503);
    }

    async function verify(userId, { sessionId, topUpId }) {
        if ((!sessionId && !topUpId) || (sessionId && (typeof sessionId !== 'string' || !/^cs_[A-Za-z0-9_]+$/.test(sessionId))) ||
            (topUpId && (typeof topUpId !== 'string' || topUpId.length > 100))) throw error('WALLET_TOPUP_ID', 'A valid top-up reference is required.', 400);
        const topUp = await prisma.walletTopUp.findFirst({ where: { userId, ...(sessionId ? { stripeCheckoutSessionId: sessionId } : { id: topUpId }) } });
        if (!topUp) throw error('WALLET_TOPUP_UNAVAILABLE', 'Top-up not found.', 404);
        if (!['PAID', 'REVERSED'].includes(topUp.status) && topUp.stripeCheckoutSessionId) {
            const session = await stripe.checkout.sessions.retrieve(topUp.stripeCheckoutSessionId, {}, stripeOptions);
            if (session.status === 'complete' && session.payment_status === 'paid') await settle(session);
            else if (session.status === 'expired') await expire(session);
        }
        const current = await prisma.walletTopUp.findUnique({ where: { id: topUp.id } });
        return { topUpId: topUp.id, status: current.status === 'PAID' ? 'paid' : current.status === 'REVERSED' ? 'reversed' : current.status === 'EXPIRED' ? 'expired' : 'pending',
            paid: current.status === 'PAID', ...await snapshot(userId) };
    }

    async function expire(session) {
        const id = session.metadata?.walletTopUpId;
        const topUp = id ? await prisma.walletTopUp.findUnique({ where: { id } }) : null;
        if (!topUp) return;
        await prisma.$transaction(async db => {
            await lockAccount(db, topUp.userId);
            await db.walletTopUp.updateMany({ where: { id, stripeCheckoutSessionId: session.id, status: { in: ['CREATING', 'PENDING'] } }, data: { status: 'EXPIRED' } });
        }, transactionOptions);
    }

    async function reversePayment(object, reason) {
        let intentId = typeof object.payment_intent === 'string' ? object.payment_intent : object.payment_intent?.id;
        if (!intentId && object.charge && stripe.charges?.retrieve) {
            const charge = await stripe.charges.retrieve(typeof object.charge === 'string' ? object.charge : object.charge.id, {}, stripeOptions);
            intentId = typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id;
        }
        if (!intentId) return false;
        let topUp = await prisma.walletTopUp.findUnique({ where: { stripePaymentIntentId: intentId } });
        if (!topUp) {
            // A refund can arrive before the completed session webhook records
            // the PaymentIntent. Its server-created metadata recovers that intent.
            const intent = await stripe.paymentIntents.retrieve(intentId, {}, stripeOptions);
            if (!intent.metadata?.walletTopUpId) return false;
            topUp = await prisma.walletTopUp.findUnique({ where: { id: intent.metadata.walletTopUpId } });
            if (!topUp || topUp.userId !== intent.metadata.customerId || topUp.amountCents !== intent.amount || intent.currency !== 'usd') {
                throw error('WALLET_QUOTE_MISMATCH', 'Refund does not match a saved top-up.', 400);
            }
        }
        return prisma.$transaction(async db => {
            const account = await lockAccount(db, topUp.userId);
            const current = await db.walletTopUp.findUnique({ where: { id: topUp.id } });
            if (current.stripePaymentIntentId && current.stripePaymentIntentId !== intentId) throw error('WALLET_QUOTE_MISMATCH', 'Refund payment changed.', 400);
            return reverseLocked(db, account, current, intentId, reason);
        }, transactionOptions);
    }

    async function handleWebhook(event) {
        const object = event.data.object;
        if (event.type.startsWith('checkout.session.') && (object.metadata?.kind === 'wallet_topup' || object.metadata?.walletTopUpId)) {
            if (['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(event.type) && object.payment_status === 'paid') await settle(object);
            if (event.type === 'checkout.session.expired') await expire(object);
            return true;
        }
        if (event.type === 'charge.refunded' && object.amount_refunded > 0) await reversePayment(object, 'A top-up refund requires support review.');
        if (['charge.dispute.created', 'charge.dispute.funds_withdrawn'].includes(event.type)) await reversePayment(object, 'A top-up dispute requires support review.');
        return false;
    }

    return { snapshot, createTopUp, verify, spend, settle, handleWebhook, adjustCashback };
}

module.exports = { WALLET_PACKAGES, createWalletService, validateQuote, validateIntent };
