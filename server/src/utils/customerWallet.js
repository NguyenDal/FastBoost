const { randomUUID } = require('node:crypto');
const { releaseExpiredWalletHolds } = require('./checkoutWallet');
const { abandonOwnedWalletHolds } = require('./abandonedWalletCheckout');
const WALLET_PACKAGES = Object.freeze([
    [5, 8, 'usd-5-v2'], [10, 10], [25, 12], [50, 13], [100, 15],
].map(([dollars, bonusPercent, id = `usd-${dollars}`]) => Object.freeze({
    id, amountCents: dollars * 100, bonusPercent,
    bonusCents: dollars * bonusPercent,
    creditCents: dollars * 100 + dollars * bonusPercent,
})));
const stripeOptions = { timeout: 8000, maxNetworkRetries: 0 };
const transactionOptions = { maxWait: 15000, timeout: 30000 };
const error = (code, message, status = 409) => Object.assign(new Error(message), { code, status });
const paymentIntentId = session => typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id;
// Old paid/pending intents retain the exact credit promised when they started.
const retiredPackages = [{ id: 'usd-5', amountCents: 500, bonusPercent: 10, bonusCents: 50, creditCents: 550 }];
const packageFor = id => WALLET_PACKAGES.find(item => item.id === id) || retiredPackages.find(item => item.id === id);
const integer = value => Number.isSafeInteger(value) && Math.abs(value) <= 2147483647;
// The durable ID namespace versions checkout creation without a schema change.
// Legacy intents always recreate the original hosted payload/idempotency key,
// even if their first Stripe response was lost before a session ID was saved.
const checkoutUiMode = topUp => topUp.id.startsWith('wte_') ? 'elements' : 'hosted';
const sessionUiMode = session => ['hosted', 'hosted_page', null, undefined].includes(session.ui_mode) ? 'hosted' : session.ui_mode;
const topUpSummary = offer => ({ packageId: offer.id, currency: 'usd', amountCents: offer.amountCents,
    bonusPercent: offer.bonusPercent, bonusCents: offer.bonusCents, creditCents: offer.creditCents });

function assertUsable(account) {
    if (account?.frozenAt) throw error('WALLET_FROZEN', 'Your wallet is on hold. Please contact support before using it.');
}

function validateSessionQuote(topUp, session) {
    const offer = packageFor(topUp.packageId);
    const metadata = session.metadata || {};
    const mode = /^(?:sk|rk)_(live|test)_/.exec(process.env.STRIPE_SECRET_KEY || '')?.[1];
    if (!offer || topUp.currency !== 'usd' || topUp.amountCents !== offer.amountCents || topUp.bonusCents !== offer.bonusCents || topUp.bonusPercent !== offer.bonusPercent ||
        session.object !== 'checkout.session' || session.mode !== 'payment' || sessionUiMode(session) !== checkoutUiMode(topUp) ||
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

function createWalletService({ prisma, stripe, settleOrderPayment }) {
    async function lockAccount(db, userId) {
        const users = await db.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
        // Account deletion must not turn a late webhook into orphan credit.
        if (!users.length) throw error('WALLET_ACCOUNT_UNAVAILABLE', 'This wallet account is unavailable.', 404);
        return db.walletAccount.upsert({ where: { userId }, create: { userId }, update: {} });
    }

    async function snapshot(userId, db = prisma) {
        if (db === prisma && stripe) {
            const result = await prisma.$transaction(async tx => {
                await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
                await releaseExpiredWalletHolds(tx, userId, stripe);
                const paid = await abandonOwnedWalletHolds(tx, userId, stripe);
                return { wallet: await snapshotValues(userId, tx), paid };
            }, transactionOptions);
            if (result.paid.length && settleOrderPayment) {
                for (const paid of result.paid) {
                    const order = await prisma.order.findUnique({ where: { id: paid.orderId } });
                    if (order) await settleOrderPayment(order, paid.session);
                }
                return prisma.$transaction(async tx => {
                    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
                    return snapshotValues(userId, tx);
                }, transactionOptions);
            }
            return result.wallet;
        }
        return snapshotValues(userId, db);
    }

    async function snapshotValues(userId, db) {
        const account = await db.walletAccount.findUnique({ where: { userId } });
        const available = await spendable(db, userId, account);
        const transactions = await db.walletEntry.findMany({ where: { userId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 50,
            select: { id: true, type: true, amountCents: true, purchasedCents: true, promotionalCents: true, createdAt: true, orderId: true, description: true } });
        const purchased = account?.purchasedBalanceCents || 0;
        const promotional = account?.promotionalBalanceCents || 0;
        return { currency: 'usd', balanceCents: Math.max(0, purchased + promotional), purchasedBalanceCents: purchased,
            promotionalBalanceCents: promotional, debtCents: Math.max(0, -purchased) + Math.max(0, -promotional),
            frozen: available.frozen, availableBalanceCents: available.availableBalanceCents,
            reservedBalanceCents: available.reservedBalanceCents, packages: WALLET_PACKAGES, transactions };
    }

    async function spendable(db, userId, savedAccount, excludeOrderId) {
        const account = savedAccount || await db.walletAccount.findUnique({ where: { userId } });
        const holds = await db.walletCheckoutHold.findMany({ where: { userId }, select: { orderId: true, purchasedCents: true, promotionalCents: true } });
        const reserved = holds.filter(hold => hold.orderId !== excludeOrderId).reduce((sum, hold) => ({
            purchased: sum.purchased + hold.purchasedCents, promotional: sum.promotional + hold.promotionalCents,
        }), { purchased: 0, promotional: 0 });
        const availablePurchasedCents = Math.max(0, (account?.purchasedBalanceCents || 0) - reserved.purchased);
        const availablePromotionalCents = Math.max(0, (account?.promotionalBalanceCents || 0) - reserved.promotional);
        return { availablePurchasedCents, availablePromotionalCents, availableBalanceCents: availablePurchasedCents + availablePromotionalCents,
            reservedBalanceCents: reserved.purchased + reserved.promotional,
            frozen: Boolean(account?.frozenAt) || (account?.purchasedBalanceCents || 0) < 0 || (account?.promotionalBalanceCents || 0) < 0 };
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
        const available = await spendable(db, userId, account);
        if (account.purchasedBalanceCents < 0 || account.promotionalBalanceCents < 0 || available.availableBalanceCents < amountCents) {
            throw error('WALLET_INSUFFICIENT', 'Your wallet balance does not cover this order. Please top up or pay by card.');
        }
        // Purchased funds are consumed first; promotional credit remains separate.
        const purchasedCents = Math.min(available.availablePurchasedCents, amountCents);
        const promotionalCents = amountCents - purchasedCents;
        await postEntry(db, account, { key: `order:${order.id}`, type: 'ORDER_PAYMENT', purchasedCents: -purchasedCents,
            promotionalCents: -promotionalCents, orderId: order.id, description: `Payment for order #${order.orderNumber}.` });
        return { walletAmountCents: amountCents, walletPurchasedCents: purchasedCents, walletPromotionalCents: promotionalCents };
    }

    async function spendReserved(db, userId, order, hold, { requireUsable = false } = {}) {
        if (hold.userId !== userId || hold.orderId !== order.id || !integer(hold.amountCents) || hold.amountCents <= 0 ||
            !integer(hold.purchasedCents) || !integer(hold.promotionalCents) || hold.purchasedCents < 0 || hold.promotionalCents < 0 ||
            hold.purchasedCents + hold.promotionalCents !== hold.amountCents) {
            throw error('WALLET_QUOTE_CHANGED', 'The saved wallet payment does not match this order.', 400);
        }
        const account = await lockAccount(db, userId);
        if (requireUsable) {
            assertUsable(account);
            const available = await spendable(db, userId, account, order.id);
            if (available.frozen || available.availablePurchasedCents < hold.purchasedCents || available.availablePromotionalCents < hold.promotionalCents) {
                throw error('WALLET_INSUFFICIENT', 'Your reserved wallet funds are no longer available. Please refresh your balance or contact support.');
            }
        }
        // A later top-up dispute can freeze/reverse reserved funds after Stripe
        // has charged the card remainder. Record the actual paid purchase and
        // resulting debt, instead of losing the customer's verified card payment.
        const updated = await postEntry(db, account, { key: `order:${order.id}`, type: 'ORDER_PAYMENT',
            purchasedCents: -hold.purchasedCents, promotionalCents: -hold.promotionalCents, orderId: order.id,
            description: `Wallet payment toward order #${order.orderNumber}.` });
        if (updated.purchasedBalanceCents < 0 || updated.promotionalBalanceCents < 0) await db.walletAccount.update({ where: { userId }, data: {
            frozenAt: account.frozenAt || new Date(), freezeReason: account.freezeReason || 'A reserved wallet payment requires support review.',
        } });
        return { walletAmountCents: hold.amountCents, walletPurchasedCents: hold.purchasedCents, walletPromotionalCents: hold.promotionalCents };
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

    async function createTopUp(userId, packageId, clientUrl, { uiMode = 'hosted' } = {}) {
        const offer = packageFor(packageId);
        if (!offer) throw error('WALLET_PACKAGE', 'Choose one of the available top-up packages.', 400);
        if (!['hosted', 'elements'].includes(uiMode)) throw error('WALLET_CHECKOUT_MODE', 'Choose a supported top-up checkout.', 400);
        for (let attempt = 0; attempt < 3; attempt++) {
            // Persist the intent BEFORE contacting Stripe. A lost network reply
            // retries the same durable ID/idempotency key, including after restart.
            const topUp = await prisma.$transaction(async db => {
                const account = await lockAccount(db, userId);
                assertUsable(account);
                const pending = await db.walletTopUp.findFirst({ where: { userId, packageId, status: { in: ['CREATING', 'PENDING'] } }, orderBy: { createdAt: 'desc' } });
                if (pending) return pending;
                if (!WALLET_PACKAGES.some(item => item.id === packageId)) throw error('WALLET_PACKAGE', 'This package has changed. Refresh your wallet to choose a current package.', 400);
                return db.walletTopUp.create({ data: { ...(uiMode === 'elements' ? { id: `wte_${randomUUID()}` } : {}),
                        userId, packageId, amountCents: offer.amountCents, bonusPercent: offer.bonusPercent,
                        bonusCents: offer.bonusCents, currency: 'usd', clientUrl } });
            }, transactionOptions);
            // Stripe may prune an idempotency key after 24h. An ambiguous old
            // create must be reviewed, never silently charged a second time.
            if (!topUp.stripeCheckoutSessionId && Date.now() - new Date(topUp.createdAt).getTime() > 23 * 60 * 60 * 1000) {
                throw error('WALLET_TOPUP_REVIEW_REQUIRED', 'An earlier top-up needs support review before retrying this package.');
            }
            const metadata = { kind: 'wallet_topup', walletTopUpId: topUp.id, customerId: userId, packageId,
                amountCents: String(offer.amountCents), bonusCents: String(offer.bonusCents) };
            const savedUiMode = checkoutUiMode(topUp);
            let session;
            if (topUp.stripeCheckoutSessionId) session = await stripe.checkout.sessions.retrieve(topUp.stripeCheckoutSessionId, {}, stripeOptions);
            else {
                const created = await stripe.checkout.sessions.create({ mode: 'payment', payment_method_types: ['card', 'link'],
                    adaptive_pricing: { enabled: false }, automatic_tax: { enabled: false },
                    line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: offer.amountCents,
                        product_data: { name: 'FastBoost wallet top-up', description: `$${(offer.creditCents / 100).toFixed(2)} store credit, including ${offer.bonusPercent}% bonus` } } }],
                    metadata, payment_intent_data: { metadata },
                    ...(savedUiMode === 'elements' ? {
                        ui_mode: 'elements',
                        return_url: `${topUp.clientUrl}/account/wallet?wallet_session_id={CHECKOUT_SESSION_ID}`,
                    } : {
                        success_url: `${topUp.clientUrl}/account/wallet?wallet_session_id={CHECKOUT_SESSION_ID}`,
                        cancel_url: `${topUp.clientUrl}/account/wallet?wallet_cancelled=1`,
                    }),
                }, { ...stripeOptions, idempotencyKey: `${savedUiMode === 'elements' ? 'wallet-topup-elements-v1' : 'wallet-topup-v1'}-${topUp.id}` });
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
            const currentAccount = await prisma.walletAccount.findUnique({ where: { userId } });
            assertUsable(currentAccount);
            if (session.status !== 'open' || session.payment_status !== 'unpaid') {
                throw error('WALLET_TOPUP_PENDING', 'An earlier top-up is awaiting payment confirmation. Please check it before starting another top-up.');
            }
            if (savedUiMode !== uiMode) {
                // Switching presentation must never leave two payable sessions.
                // Stripe can complete the old payment while expiration races it.
                let closed;
                try { closed = await stripe.checkout.sessions.expire(session.id, {}, stripeOptions); }
                catch { closed = await stripe.checkout.sessions.retrieve(session.id, {}, stripeOptions); }
                validateSessionQuote(topUp, closed);
                if (closed.status === 'complete' && closed.payment_status === 'paid') {
                    await settle(closed);
                    const verified = await prisma.walletTopUp.findUnique({ where: { id: topUp.id } });
                    return { topUpId: topUp.id, sessionId: closed.id, status: verified.status === 'PAID' ? 'paid' : 'reversed', paid: verified.status === 'PAID' };
                }
                if (closed.status !== 'expired' || closed.payment_status === 'paid') {
                    throw error('WALLET_TOPUP_PENDING', 'The existing top-up could not be safely closed. Please check its payment before retrying.');
                }
                await expire(closed);
                continue;
            }
            const details = { topUpId: topUp.id, sessionId: session.id, status: 'pending', uiMode: savedUiMode, summary: topUpSummary(offer) };
            if (savedUiMode === 'elements') {
                if (typeof session.client_secret !== 'string' || !session.client_secret) {
                    throw error('WALLET_CHECKOUT_UNAVAILABLE', 'Top-up checkout is not available. Please retry shortly.', 503);
                }
                return { ...details, clientSecret: session.client_secret };
            }
            if (typeof session.url !== 'string' || !session.url.startsWith('https://checkout.stripe.com/')) {
                throw error('WALLET_CHECKOUT_UNAVAILABLE', 'Top-up checkout is not available. Please retry shortly.', 503);
            }
            return { ...details, url: session.url };
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

    async function cancel(userId, sessionId) {
        if (typeof sessionId !== 'string' || !/^cs_[A-Za-z0-9_]+$/.test(sessionId)) {
            throw error('WALLET_TOPUP_ID', 'A valid top-up reference is required.', 400);
        }
        // Resolve the signed-in owner's saved intent before any Stripe access.
        const topUp = await prisma.walletTopUp.findFirst({ where: { userId, stripeCheckoutSessionId: sessionId } });
        if (!topUp) throw error('WALLET_TOPUP_UNAVAILABLE', 'Top-up not found.', 404);
        let expired = false;
        if (!['PAID', 'REVERSED'].includes(topUp.status)) {
            let session = await stripe.checkout.sessions.retrieve(sessionId, {}, stripeOptions);
            validateSessionQuote(topUp, session);
            if (session.status === 'open' && session.payment_status === 'unpaid') {
                try { session = await stripe.checkout.sessions.expire(sessionId, {}, stripeOptions); }
                catch { session = await stripe.checkout.sessions.retrieve(sessionId, {}, stripeOptions); }
                validateSessionQuote(topUp, session);
            }
            if (session.status === 'complete' && session.payment_status === 'paid') await settle(session);
            else if (session.status === 'expired' && session.payment_status === 'unpaid') {
                await expire(session);
                expired = true;
            }
        }
        const current = await prisma.walletTopUp.findUnique({ where: { id: topUp.id } });
        const cancelled = expired && current.status === 'EXPIRED';
        return { topUpId: topUp.id, sessionId, cancelled, paid: current.status === 'PAID',
            status: current.status === 'PAID' ? 'paid' : current.status === 'REVERSED' ? 'reversed' : cancelled ? 'cancelled' : 'pending',
            ...await snapshot(userId) };
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

    return { snapshot, createTopUp, verify, cancel, spend, spendable, spendReserved, settle, handleWebhook, adjustCashback };
}

module.exports = { WALLET_PACKAGES, createWalletService, validateQuote, validateIntent };
