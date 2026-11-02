const { normalizeGoldToUse } = require("../utils/goldRedemption");
const { createHash } = require("node:crypto");
const prisma = require("../prisma");
const { queueOrderConfirmation, validEmail } = require("../utils/orderConfirmationEmail");
const { queueAdminOrderEmail, wakeAdminOrderEmailWorker } = require("../utils/adminOrderEmail");
const { retrieveReceiptPaymentMethod } = require("../utils/receiptPaymentMethod");
const { withEarningsLedgerMutation } = require("../utils/boosterEarningsLedger");
const { withBoosterOrderEmails } = require("../utils/boosterOrderEmail");
const stripe = require("../utils/stripeClient");
const { checkoutSummary, checkoutTenderSummary } = require("../utils/checkoutSummary");
const { lockCheckout, mutateCheckoutOrder, applyCheckoutCoupon, expireUnpaidSession, stripeOptions } = require("../utils/checkoutCoupon");
const { validateHeldSession, recoverHeldSession, releaseHold, closeHeldCheckout, releaseExpiredWalletHolds,
    reserveWalletCheckout, walletError, isWalletOnlyHold } = require('../utils/checkoutWallet');
const { renewCheckoutPresence, closeCheckoutPresence } = require('../utils/checkoutPresence');
const { abandonWalletHold, reconcileFailedWalletCheckout } = require('../utils/abandonedWalletCheckout');
const { releaseOtherGoldCheckouts } = require("../utils/checkoutGold");
const { snapshotCashbackPercent } = require('../utils/customerCashback');
const { enforceCheckoutReferral } = require("../utils/checkoutReferral");
const { createWalletService } = require('../utils/customerWallet');
const { clientOrigin } = require('../utils/clientOrigin');
const customerWallet = createWalletService({ prisma, stripe, settleOrderPayment: completeCheckoutSessionPayment });
const walletPaymentRequest = Symbol('walletPaymentRequest');
const {
    grantReferralCompletionRewards,
} = require("../utils/referralProgram");

function getUserId(req) {
    return req.user?.id || req.user?.userId;
}

async function getAvailableGold(userId, db = prisma) {
    const completedOrders = await db.order.findMany({
        where: {
            customerId: userId,
            status: "COMPLETED",
            paymentStatus: "PAID",
        },
        select: {
            totalPrice: true,
        },
    });

    const completedOrderGold = completedOrders.reduce((sum, order) => {
        return sum + Math.floor(Number(order.totalPrice || 0));
    }, 0);

    const rewardStats = await db.rewardHistory.aggregate({
        where: {
            userId,
        },
        _sum: {
            goldAmount: true,
        },
    });

    const rewardGold = Number(rewardStats._sum.goldAmount || 0);

    return Math.max(0, completedOrderGold + rewardGold);
}


async function completeCheckoutSessionPayment(order, session) {
    const paymentIntentId =
        typeof session.payment_intent === "string"
            ? session.payment_intent
            : session.payment_intent?.id || null;

    // Best-effort enrichment before taking checkout locks: Stripe being slow
    // or unavailable for this optional lookup cannot roll back a paid order.
    const paymentMethod = process.env.ORDER_CONFIRMATION_EMAILS_ENABLED === "true"
        ? await retrieveReceiptPaymentMethod(stripe, session) : null;

    const paymentApplied = await prisma.$transaction(async (transaction) => withEarningsLedgerMutation(transaction, order.id, async () => {
        await lockCheckout(transaction, order.customerId, order.id);
        const current = await transaction.order.findUnique({ where: { id: order.id } });
        if (!current || current.paymentStatus === "PAID" || current.status === "CANCELLED") return false;
        const hold = session.metadata?.walletHoldId ? await transaction.walletCheckoutHold.findUnique({ where: { id: session.metadata.walletHoldId } }) : null;
        if (session.metadata?.walletHoldId) {
            if (!hold || hold.orderId !== current.id || hold.userId !== current.customerId ||
                hold.orderAmountCents !== current.amountCents || hold.cashAmountCents !== current.cashAmountCents ||
                hold.goldRedeemed !== current.goldRedeemed || hold.goldDiscountCents !== current.goldDiscountCents) {
                throw walletError('WALLET_QUOTE_CHANGED', 'The paid wallet checkout does not match its saved order.', 400);
            }
            validateHeldSession(hold, session);
        } else if (current.stripeCheckoutSessionId !== session.id) return false;
        const amountCents = Number(current.amountCents ?? Math.round(Number(current.totalPrice || 0) * 100));
        const goldRedeemed = Number(current.goldRedeemed || 0);
        const goldDiscountCents = Number(current.goldDiscountCents || 0);
        const cashAmountCents = Number(current.cashAmountCents ?? amountCents - goldDiscountCents);
        const walletAppliedCents = hold?.amountCents || 0;
        const cardAmountCents = cashAmountCents - walletAppliedCents;
        const metadata = session.metadata || {};
        const configuredMode = /^(?:sk|rk)_(live|test)_/.exec(process.env.STRIPE_SECRET_KEY || "")?.[1];
        // Stripe's API amounts stay in the integration currency even when
        // Adaptive Pricing presents a different currency to the customer.
        // Tax may increase the final total; the pre-tax line item must still
        // match the immutable cash/Gold quote that owns this exact session.
        if (session.object !== "checkout.session" || session.mode !== "payment" || session.status !== "complete" || session.payment_status !== "paid" ||
            typeof session.livemode !== "boolean" || (configuredMode && session.livemode !== (configuredMode === "live")) ||
            typeof paymentIntentId !== "string" || !/^pi_[A-Za-z0-9_]+$/.test(paymentIntentId) ||
            session.currency !== (current.currency || "usd").toLowerCase() ||
            !Number.isSafeInteger(session.amount_subtotal) || session.amount_subtotal !== cardAmountCents ||
            !Number.isSafeInteger(session.amount_total) || session.amount_total < session.amount_subtotal ||
            metadata.orderId !== current.id || metadata.customerId !== current.customerId ||
            Number(metadata.goldRedeemed) !== goldRedeemed || Number(metadata.goldDiscountCents) !== goldDiscountCents ||
            Number(metadata.cashAmountCents) !== cardAmountCents ||
            Number(metadata.walletAppliedCents || 0) !== walletAppliedCents || !Number.isSafeInteger(amountCents) || amountCents <= 0 ||
            !Number.isSafeInteger(goldRedeemed) || !Number.isSafeInteger(goldDiscountCents) || goldDiscountCents !== goldRedeemed * 10 ||
            goldDiscountCents < 0 || (goldRedeemed !== 0 && goldRedeemed < 100) || cardAmountCents < 50 || amountCents - goldDiscountCents !== cashAmountCents) {
            throw Object.assign(new Error("Paid Stripe session does not match the saved order quote."), { code: "PAYMENT_QUOTE_MISMATCH" });
        }
        return withBoosterOrderEmails(transaction, order.id, async () => {
            const cashbackPercent = await snapshotCashbackPercent(transaction, current);
            const walletFields = hold ? await customerWallet.spendReserved(transaction, current.customerId, current, hold) : {};
            const updateResult = await transaction.order.updateMany({
                where: {
                    id: order.id,
                    ...(!hold ? { stripeCheckoutSessionId: session.id } : {}),
                    paymentStatus: { not: "PAID" },
                    status: { not: "CANCELLED" },
                },
                data: {
                    paymentStatus: "PAID",
                    stripePaymentIntentId: paymentIntentId,
                    stripeCheckoutSessionId: session.id,
                    paidAt: new Date(),
                    amountCents,
                    cashAmountCents: session.amount_total + walletAppliedCents,
                    ...walletFields,
                    cashbackPercent,
                    currency: current.currency || "usd",
                },
            });

            if (updateResult.count === 0) {
                if (hold) throw walletError('WALLET_QUOTE_CHANGED', 'The order changed while its wallet payment was settling.');
                return false;
            }
            if (hold) await transaction.walletCheckoutHold.deleteMany({ where: { id: hold.id } });

            if (goldRedeemed > 0) {
                await transaction.rewardHistory.createMany({
                    data: [
                        {
                            userId: current.customerId,
                            type: "ORDER_REDEMPTION",
                            goldAmount: -goldRedeemed,
                            title: "Gold redeemed for order",
                            description: `Used ${goldRedeemed} gold for order #${current.orderNumber}.`,
                            sourceUserId: order.id,
                        },
                    ],
                    skipDuplicates: true,
                });
            }

            await queueOrderConfirmation(transaction, order.id, session.customer_details?.email || session.customer_email, paymentMethod);
            await queueAdminOrderEmail(transaction, order.id);
            await grantReferralCompletionRewards(order.id, transaction);
            return true;
        });
    }));

    if (paymentApplied) {
        wakeAdminOrderEmailWorker(prisma);
        console.log(`Stripe payment completed for order ${order.id}.`);
    }

    return paymentApplied;
}

async function createRecoverableCheckoutSession(parameters, originalKey, createdSessions, previousSessionId) {
    let idempotencyKey = originalKey;
    let expiredReplays = 0;
    let lastExpiredSessionId;
    for (let attempt = 0; attempt < 3; attempt++) {
        const created = await stripe.checkout.sessions.create(parameters, { ...stripeOptions, idempotencyKey });
        createdSessions.push(created.id);
        // Stripe replays the original create response for an idempotency key.
        // A rollback may have expired that session since the response was cached.
        const current = await stripe.checkout.sessions.retrieve(created.id, {}, stripeOptions);
        if (current.status === "expired") {
            createdSessions.pop();
            expiredReplays++;
            lastExpiredSessionId = current.id;
            idempotencyKey = `checkout-retry-v1-${createHash("sha256").update(originalKey).update(":" + current.id).digest("hex")}`;
            continue;
        }
        if (current.status === "complete") {
            createdSessions.pop();
            return current;
        }
        if (current.status === "open" && current.client_secret) return current;
        break;
    }
    throw Object.assign(new Error("Checkout could not be prepared. Please try again shortly."), {
        status: 503, code: "CHECKOUT_SESSION_UNAVAILABLE",
        ...(expiredReplays === 3 ? { checkoutRecovery: { previousSessionId: previousSessionId || null, expiredSessionId: lastExpiredSessionId } } : {}),
    });
}

const buildCheckoutSession = async (req, res, db, createdSessions) => {
    try {
        const userId = getUserId(req);
        const { orderId, goldToUse, deferGoldOnly, contactEmail, couponCode, expectedTotalCents, walletToUseCents, checkoutViewId } = req.body || {};
        const useWallet = req[walletPaymentRequest] === true;
        if (useWallet && (!Number.isSafeInteger(expectedTotalCents) || expectedTotalCents < 0)) {
            return res.status(400).json({ ok: false, code: 'WALLET_QUOTE_CHANGED', message: 'Refresh your order total before paying from your wallet.' });
        }
        if (walletToUseCents !== undefined && (!Number.isSafeInteger(walletToUseCents) || walletToUseCents < 0 || walletToUseCents > 2147483647)) {
            return res.status(400).json({ ok: false, code: 'WALLET_AMOUNT', message: 'Choose a valid wallet amount in cents.' });
        }
        if (goldToUse != null && (!Number.isSafeInteger(Number(goldToUse)) || Number(goldToUse) < 0 || (Number(goldToUse) > 0 && Number(goldToUse) < 100))) {
            return res.status(400).json({ ok: false, message: "Redeem at least 100 Gold, or enter 0 to remove Gold." });
        }

        if (!userId) {
            return res.status(401).json({
                ok: false,
                message: "Invalid user token",
            });
        }

        if (!orderId) {
            return res.status(400).json({
                ok: false,
                message: "orderId is required",
            });
        }

        const order = await db.order.findUnique({
            where: { id: orderId },
            include: {
                service: true,
                customer: {
                    select: {
                        id: true,
                        email: true,
                    },
                },
            },
        });

        if (!order) {
            return res.status(404).json({
                ok: false,
                message: "Order not found",
            });
        }

        if (String(order.customerId) !== String(userId)) {
            return res.status(403).json({
                ok: false,
                message: "You can only pay for your own order",
            });
        }

        if (order.paymentStatus === "PAID") {
            const savedSummary = checkoutSummary(order);
            return res.json({ ok: true, paid: true, orderId: order.id,
                summary: checkoutTenderSummary(order, savedSummary.goldRedeemed, savedSummary.goldDiscountCents, savedSummary.totalCents, order.walletAmountCents || 0) });
        }

        if (order.status === "CANCELLED") {
            return res.status(400).json({ ok: false, message: "This order has been cancelled" });
        }
        // Validate before presence, coupon, wallet, or Stripe changes. A bad
        // return destination must not disturb an existing checkout.
        const clientUrl = clientOrigin(req);
        if (checkoutViewId !== undefined) await renewCheckoutPresence(db, userId, order.id, checkoutViewId, { create: !useWallet });

        const checkoutCurrency = (order.currency || "usd").toLowerCase();
        if (useWallet && checkoutCurrency !== 'usd') return res.status(400).json({ ok: false, code: 'WALLET_CURRENCY', message: 'Wallet payments are available for USD orders only.' });
        // Charge in the order currency so a USD price remains USD at checkout.
        // Historical orders retain their original currency.
        const adaptivePricingEnabled = false;

        let currentHold = await db.walletCheckoutHold.findUnique({ where: { orderId: order.id } });
        const previousWalletCents = currentHold?.amountCents || 0;
        if (currentHold && !isWalletOnlyHold(currentHold)) {
            const heldSession = await recoverHeldSession(currentHold, stripe);
            if (heldSession.status === 'expired' && heldSession.payment_status === 'unpaid') {
                await releaseHold(db, currentHold, heldSession);
                currentHold = null;
            } else {
                await db.walletCheckoutHold.update({ where: { id: currentHold.id }, data: { stripeCheckoutSessionId: heldSession.id } });
                await db.order.update({ where: { id: order.id }, data: { stripeCheckoutSessionId: heldSession.id } });
                order.stripeCheckoutSessionId = heldSession.id;
                if (heldSession.status === 'complete') return res.json({ ok: true, completed: true, sessionId: heldSession.id,
                    summary: checkoutTenderSummary(order, order.goldRedeemed, order.goldDiscountCents, currentHold.cashAmountCents, currentHold.amountCents) });
            }
        }
        await releaseExpiredWalletHolds(db, userId, stripe);

        // Check for a payment already in flight before changing its price snapshot.
        const previousCoupon = order.couponCode;
        const previousAmount = order.amountCents;
        let previousSession;
        if (order.stripeCheckoutSessionId) {
            previousSession = await stripe.checkout.sessions.retrieve(order.stripeCheckoutSessionId, {}, stripeOptions);
            if (previousSession.status === "complete") {
                const saved = checkoutSummary(order);
                return res.json({ ok: true, completed: true, sessionId: previousSession.id,
                    summary: checkoutTenderSummary(order, saved.goldRedeemed, saved.goldDiscountCents, saved.totalCents, order.walletAmountCents || 0) });
            }
        }
        const availableRule = await db.servicePriceRule.findFirst({ where: { serviceId: order.serviceId, active: true }, select: { id: true } });
        if (!availableRule) return res.status(409).json({ ok: false, code: "SERVICE_UNAVAILABLE", message: "This service is currently unavailable. Please choose another service or check back later." });
        const referralNotice = await enforceCheckoutReferral(db, order, stripe);
        const couponNotice = await applyCheckoutCoupon(db, order, couponCode, stripe);
        res.couponNotice = couponNotice || referralNotice;

        const amountCents =
            order.amountCents || Math.round(Number(order.totalPrice || 0) * 100);

        const availableGold = await getAvailableGold(userId, db);

        const {
            goldRedeemed,
            goldDiscountCents,
            cashAmountCents,
        } = normalizeGoldToUse((useWallet || previousWalletCents > 0) && goldToUse === undefined ? order.goldRedeemed : goldToUse, availableGold, amountCents);

        if (useWallet && cashAmountCents !== expectedTotalCents) {
            return res.status(409).json({ ok: false, code: 'WALLET_QUOTE_CHANGED', message: 'Your order total changed. Please review the refreshed amount before paying.' });
        }

        if (!amountCents || amountCents < 50) {
            return res.status(400).json({
                ok: false,
                message: "Invalid order amount",
            });
        }

        let walletAppliedCents = useWallet ? 0 : Math.min(walletToUseCents ?? previousWalletCents, cashAmountCents);
        if (walletAppliedCents > 0 && checkoutCurrency !== 'usd') throw walletError('WALLET_CURRENCY', 'Wallet payments are available for USD orders only.', 400);
        if (walletAppliedCents > 0 && cashAmountCents - walletAppliedCents > 0 && cashAmountCents - walletAppliedCents < 50) walletAppliedCents = Math.max(0, cashAmountCents - 50);

        if (goldRedeemed > 0 && cashAmountCents > 0) {
            await releaseOtherGoldCheckouts(db, order, stripe);
        }

        const availableWallet = await customerWallet.spendable(db, userId, undefined, order.id);
        if (walletAppliedCents > 0 && availableWallet.frozen) throw walletError('WALLET_FROZEN', 'Your wallet is on hold. Please contact support before using it.');
        if (walletAppliedCents > availableWallet.availableBalanceCents) throw walletError('WALLET_INSUFFICIENT', 'Your available wallet balance does not cover this amount. Please review your balance.');
        const summary = checkoutTenderSummary(order, goldRedeemed, goldDiscountCents, cashAmountCents, walletAppliedCents, availableWallet.availableBalanceCents);
        summary.availableGold = availableGold;

        currentHold = await db.walletCheckoutHold.findUnique({ where: { orderId: order.id } });
        const walletOnlyPaymentHold = useWallet && isWalletOnlyHold(currentHold) && currentHold.amountCents === cashAmountCents &&
            currentHold.orderAmountCents === amountCents && currentHold.goldRedeemed === goldRedeemed && currentHold.goldDiscountCents === goldDiscountCents &&
            currentHold.stripeParametersJson.metadata.couponCode === (order.couponCode || '') ? currentHold : null;
        if (currentHold && !useWallet && currentHold.amountCents === walletAppliedCents && currentHold.cashAmountCents === cashAmountCents &&
            currentHold.orderAmountCents === amountCents && currentHold.goldRedeemed === goldRedeemed &&
            currentHold.stripeParametersJson.metadata.couponCode === (order.couponCode || '')) {
            if (isWalletOnlyHold(currentHold)) return res.json({ ok: true, walletOnlyReady: true, summary });
            res.walletCheckoutHoldId = currentHold.id;
            return res.json({ ok: true, summary });
        }
        if (currentHold && !walletOnlyPaymentHold) {
            const closed = await closeHeldCheckout(db, currentHold, stripe);
            if (closed) {
                order.stripeCheckoutSessionId = closed.id;
                previousSession = closed;
                await db.order.update({ where: { id: order.id }, data: { stripeCheckoutSessionId: closed.id } });
            }
        }

        // Reuse an open session on refresh. Expire it before changing the amount.
        if (order.stripeCheckoutSessionId) {
            const existingSession = previousCoupon === order.couponCode && previousAmount === order.amountCents
                ? previousSession : await stripe.checkout.sessions.retrieve(order.stripeCheckoutSessionId, {}, stripeOptions);
            if ((useWallet || walletAppliedCents > 0) && (existingSession.id !== order.stripeCheckoutSessionId || existingSession.object !== 'checkout.session' || existingSession.mode !== 'payment' ||
                existingSession.metadata?.orderId !== order.id || existingSession.metadata?.customerId !== order.customerId || existingSession.currency !== checkoutCurrency)) {
                throw Object.assign(new Error('The existing card payment could not be verified. Please contact support.'), { status: 409, code: 'WALLET_CARD_IN_PROGRESS' });
            }
            if (existingSession.status === "complete") {
                return res.json({ ok: true, completed: true, sessionId: existingSession.id, summary });
            }
            if (existingSession.status === "open") {
                if (!useWallet && walletAppliedCents === 0 && !existingSession.metadata?.walletHoldId && existingSession.ui_mode === "elements" &&
                    existingSession.adaptive_pricing?.enabled === adaptivePricingEnabled &&
                    (!existingSession.currency || existingSession.currency === checkoutCurrency) &&
                    existingSession.metadata?.editableEmail === "1" &&
                    existingSession.metadata?.orderNumber === order.orderNumber &&
                    (existingSession.metadata?.couponCode || "") === (order.couponCode || "") &&
                    existingSession.amount_total === cashAmountCents &&
                    Number(existingSession.metadata?.goldRedeemed || 0) === goldRedeemed) {
                    return res.json({ ok: true, clientSecret: existingSession.client_secret, sessionId: existingSession.id, summary });
                }
                const expired = await stripe.checkout.sessions.expire(existingSession.id, {}, stripeOptions);
                if ((useWallet || walletAppliedCents > 0) && (expired?.id !== existingSession.id || expired?.status !== 'expired' || expired?.payment_status !== 'unpaid')) {
                    throw Object.assign(new Error('The card payment could not be safely closed. Please verify payment before retrying.'), { status: 409, code: 'WALLET_CARD_IN_PROGRESS' });
                }
            }
            if ((useWallet || walletAppliedCents > 0) && (existingSession.payment_status === 'paid' || !['open', 'expired'].includes(existingSession.status))) {
                throw Object.assign(new Error('A card payment is being confirmed. Please verify payment before using your wallet.'), { status: 409, code: 'WALLET_CARD_IN_PROGRESS' });
            }
        }

        if (!useWallet && walletAppliedCents > 0) {
            await db.order.update({ where: { id: order.id }, data: { amountCents, cashAmountCents, goldRedeemed, goldDiscountCents, paymentStatus: 'PENDING' } });
            const hold = await reserveWalletCheckout(db, customerWallet, order,
                { amountCents: walletAppliedCents, cashAmountCents, goldRedeemed, goldDiscountCents, clientUrl });
            if (isWalletOnlyHold(hold)) {
                await db.order.update({ where: { id: order.id }, data: { stripeCheckoutSessionId: null } });
                return res.json({ ok: true, walletOnlyReady: true, summary });
            }
            res.walletCheckoutHoldId = hold.id;
            return res.json({ ok: true, summary });
        }

        if (useWallet && cashAmountCents > 0) {
            if (!validEmail(contactEmail)) return res.status(400).json({ ok: false, code: 'WALLET_EMAIL', message: 'Please enter a valid receipt email before paying from your wallet.' });
            // Other payable Gold sessions must be closed before consuming Gold,
            // including the case where the wallet pays the entire cash remainder.
            if (goldRedeemed > 0) await releaseOtherGoldCheckouts(db, order, stripe);
            const walletFields = walletOnlyPaymentHold
                ? await customerWallet.spendReserved(db, userId, order, walletOnlyPaymentHold, { requireUsable: true })
                : await customerWallet.spend(db, userId, order, cashAmountCents);
            const cashbackPercent = await snapshotCashbackPercent(db, order);
            const result = await db.order.updateMany({ where: { id: order.id, customerId: userId, paymentStatus: { not: 'PAID' }, status: { not: 'CANCELLED' } },
                data: { paymentStatus: 'PAID', paidAt: new Date(), amountCents, cashAmountCents, goldRedeemed, goldDiscountCents,
                    currency: 'usd', stripeCheckoutSessionId: null, stripePaymentIntentId: null, cashbackPercent, ...walletFields } });
            if (result.count !== 1) throw Object.assign(new Error('The order changed while paying. Please verify payment.'), { status: 409, code: 'WALLET_ORDER_CHANGED' });
            if (walletOnlyPaymentHold) await db.walletCheckoutHold.deleteMany({ where: { id: walletOnlyPaymentHold.id } });
            if (goldRedeemed > 0) await db.rewardHistory.create({ data: { userId, type: 'ORDER_REDEMPTION', goldAmount: -goldRedeemed,
                title: 'Gold redeemed for order', description: `Used ${goldRedeemed} gold for order #${order.orderNumber}.`, sourceUserId: order.id } });
            await queueOrderConfirmation(db, order.id, contactEmail, { type: 'account_balance' });
            await queueAdminOrderEmail(db, order.id);
            await grantReferralCompletionRewards(order.id, db);
            return res.json({ ok: true, paidWithWallet: true, orderId: order.id,
                summary: { ...checkoutTenderSummary({ ...order, ...walletFields }, goldRedeemed, goldDiscountCents, cashAmountCents, cashAmountCents), availableGold: Math.max(0, availableGold - goldRedeemed) },
                redirectUrl: `${clientUrl}/payment/success/${order.serviceId}?orderId=${order.id}&wallet=1` });
        }

        if (cashAmountCents <= 0) {
            if (deferGoldOnly === true) {
                return res.json({ ok: true, goldOnlyReady: true, summary });
            }
            if (!validEmail(contactEmail)) {
                return res.status(400).json({ ok: false, message: "Please enter a valid email address before paying with gold." });
            }
            if (goldRedeemed > 0) await releaseOtherGoldCheckouts(db, order, stripe);
            await (async transaction => {
                const result = await transaction.order.updateMany({
                    where: { id: order.id, paymentStatus: { not: "PAID" } },
                    data: {
                        paymentStatus: "PAID",
                        paidAt: new Date(),
                        amountCents,
                        cashAmountCents: 0,
                        cashbackPercent: 0,
                        goldRedeemed,
                        goldDiscountCents,
                        currency: order.currency || "usd",
                    },
                });
                if (!result.count) return false;
                if (goldRedeemed > 0) {
                    await transaction.rewardHistory.create({
                            data: {
                                userId,
                                type: "ORDER_REDEMPTION",
                                goldAmount: -goldRedeemed,
                                title: "Gold redeemed for order",
                                description: `Used ${goldRedeemed} gold for order #${order.orderNumber}.`,
                                sourceUserId: order.id,
                            },
                    });
                }
                await queueOrderConfirmation(transaction, order.id, contactEmail);
                await queueAdminOrderEmail(transaction, order.id);
                await grantReferralCompletionRewards(order.id, transaction);
                return true;
            })(db);

            return res.json({
                ok: true,
                paidWithGoldOnly: true,
                orderId: order.id,
                summary: { ...summary, availableGold: Math.max(0, availableGold - goldRedeemed) },
                redirectUrl: `${clientUrl}/payment/success/${order.serviceId}?orderId=${order.id}&gold=1`,
            });
        }

        const session = await createRecoverableCheckoutSession({
            mode: "payment",
            ui_mode: "elements",
            // Collect contact email in the editable checkout form. Setting
            // customer_email here locks it and rejects confirm({ email }).
            payment_method_types: ["card", "link"],
            adaptive_pricing: { enabled: adaptivePricingEnabled },
            line_items: [
                {
                    quantity: 1,
                    price_data: {
                        currency: checkoutCurrency,
                        unit_amount: cashAmountCents,
                        product_data: {
                            name: order.service?.title || order.boostType || "FastBoost Order",
                            description:
                                goldRedeemed > 0
                                    ? `Order #${order.orderNumber} • ${goldRedeemed} gold applied`
                                    : `Order #${order.orderNumber}`,
                        },
                    },
                },
            ],
            metadata: {
                editableEmail: "1",
                orderNumber: order.orderNumber,
                orderId: order.id,
                customerId: order.customerId,
                goldRedeemed: String(goldRedeemed),
                goldDiscountCents: String(goldDiscountCents),
                cashAmountCents: String(cashAmountCents),
                couponCode: order.couponCode || "",
            },
            return_url: `${clientUrl}/checkout/${order.id}?session_id={CHECKOUT_SESSION_ID}`,
            payment_intent_data: { metadata: { orderId: order.id, orderNumber: order.orderNumber, couponCode: order.couponCode || "" } },
        }, `checkout-fixed-currency-v3-${order.id}-${cashAmountCents}-${goldRedeemed}-${order.couponSaleId || "none"}-${order.stripeCheckoutSessionId || "new"}`, createdSessions, order.stripeCheckoutSessionId);

        await db.order.update({
            where: { id: order.id },
            data: {
                stripeCheckoutSessionId: session.id,
                paymentStatus: "PENDING",
                amountCents,
                cashAmountCents,
                goldRedeemed,
                goldDiscountCents,
                currency: order.currency || "usd",
            },
        });

        if (session.status === "complete") return res.json({ ok: true, completed: true, sessionId: session.id, summary });

        return res.json({
            ok: true,
            clientSecret: session.client_secret,
            sessionId: session.id,
            summary,
        });
    } catch (error) {
        if (error.checkoutRecovery) res.checkoutRecovery = error.checkoutRecovery;
        if (error.code?.startsWith('WALLET_') || ["COUPON_UNAVAILABLE", "GOLD_CHECKOUT_IN_PROGRESS", "GOLD_CHECKOUT_UNAVAILABLE", "CHECKOUT_SESSION_UNAVAILABLE", "CHECKOUT_URL_UNAVAILABLE"].includes(error.code)) {
            return res.status(error.status).json({ ok: false, code: error.code, message: error.message });
        }
        console.error("createCheckoutSession error:", error);

        return res.status(500).json({
            ok: false,
            message: "Failed to create checkout session",
            error: error.message,
        });
    }
};

const verifyCheckoutSession = async (req, res) => {
    try {
        const userId = getUserId(req);
        const { sessionId, orderId } = req.query || {};

        if (!userId) {
            return res.status(401).json({
                ok: false,
                message: "Invalid user token",
            });
        }

        if (!sessionId && !orderId) {
            return res.status(400).json({
                ok: false,
                message: "sessionId or orderId is required",
            });
        }

        const order = await prisma.order.findFirst({
            where: {
                customerId: userId,
                ...(orderId ? { id: orderId } : { stripeCheckoutSessionId: sessionId }),
            },
            select: {
                id: true,
                customerId: true,
                paymentStatus: true,
                status: true,
                paidAt: true,
                stripeCheckoutSessionId: true,
                orderNumber: true,
                goldRedeemed: true,
                goldDiscountCents: true,
            },
        });

        if (!order) {
            return res.status(404).json({
                ok: false,
                message: "Order not found",
            });
        }

        // A power/network interruption may prevent the Stripe return URL from
        // reaching the browser. Recover its durable session from the owned order.
        const held = order.paymentStatus !== 'PAID' ? await prisma.walletCheckoutHold.findUnique({ where: { orderId: order.id } }) : null;
        if (held && isWalletOnlyHold(held) && sessionId) return res.status(404).json({ ok: false, message: 'This wallet checkout has no card session.' });
        if (sessionId && !held && sessionId !== order.stripeCheckoutSessionId) return res.status(404).json({ ok: false, message: 'Checkout session not found for this order.' });
        const savedSessionId = sessionId || order.stripeCheckoutSessionId;
        if ((savedSessionId || held) && !isWalletOnlyHold(held) && order.paymentStatus !== "PAID") {
            try {
                const session = held ? await recoverHeldSession(held, stripe) : await stripe.checkout.sessions.retrieve(savedSessionId, {}, stripeOptions);
                if (sessionId && session.id !== sessionId) return res.status(404).json({ ok: false, message: 'Checkout session not found for this order.' });
                const sessionOrderId = session.metadata?.orderId;

                if (
                    session.payment_status === "paid" &&
                    String(sessionOrderId) === String(order.id)
                ) {
                    await completeCheckoutSessionPayment(order, session);
                }
            } catch (error) {
                console.error(
                    `Stripe session reconciliation failed for order ${order.id}:`,
                    error.message
                );
            }
        }

        const verifiedOrder = await prisma.order.findUnique({
            where: { id: order.id },
            select: {
                id: true,
                paymentStatus: true,
                status: true,
                paidAt: true,
            },
        });

        return res.json({
            ok: true,
            orderId: verifiedOrder.id,
            paymentStatus: verifiedOrder.paymentStatus,
            paid: verifiedOrder.paymentStatus === "PAID",
            orderStatus: verifiedOrder.status,
            paidAt: verifiedOrder.paidAt,
        });
    } catch (error) {
        console.error("verifyCheckoutSession error:", error);

        return res.status(500).json({
            ok: false,
            message: "Failed to verify checkout session",
            error: error.message,
        });
    }
};

const handleStripeWebhook = async (req, res) => {
    const signature = req.headers["stripe-signature"];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!webhookSecret) {
        console.error("Missing STRIPE_WEBHOOK_SECRET in environment variables");
        return res.status(500).send("Webhook secret not configured");
    }

    let event;

    try {
        event = stripe.webhooks.constructEvent(req.body, signature, webhookSecret);
    } catch (error) {
        console.error("Stripe webhook signature verification failed:", error.message);
        return res.status(400).send(`Webhook Error: ${error.message}`);
    }

    try {
        if (await customerWallet.handleWebhook(event)) return res.json({ received: true });
        if (
            event.type === "checkout.session.completed" ||
            event.type === "checkout.session.async_payment_succeeded"
        ) {
            const session = event.data.object;

            const orderId = session.metadata?.orderId;

            if (!orderId) {
                console.warn(`${event.type} missing orderId metadata`);
                return res.json({ received: true });
            }

            if (session.payment_status !== "paid") {
                return res.json({ received: true });
            }

            const order = await prisma.order.findFirst({
                where: {
                    id: orderId,
                    ...(session.metadata?.walletHoldId ? {} : { stripeCheckoutSessionId: session.id }),
                },
                select: {
                    id: true,
                    customerId: true,
                    paymentStatus: true,
                    goldRedeemed: true,
                    orderNumber: true,
                    goldDiscountCents: true,
                },
            });

            if (!order || order.paymentStatus === "PAID") {
                return res.json({ received: true });
            }

            await completeCheckoutSessionPayment(order, session);
        }

        if (event.type === 'checkout.session.async_payment_failed' && event.data.object.metadata?.walletHoldId) {
            const eventSession = event.data.object;
            let failedOrder, outcome;
            await prisma.$transaction(async db => {
                const initial = await db.walletCheckoutHold.findUnique({ where: { id: eventSession.metadata.walletHoldId } });
                if (!initial) return;
                await lockCheckout(db, initial.userId, initial.orderId);
                const hold = await db.walletCheckoutHold.findUnique({ where: { id: initial.id } });
                if (!hold) return;
                validateHeldSession(hold, eventSession);
                failedOrder = await db.order.findUnique({ where: { id: hold.orderId } });
                if (failedOrder?.paymentStatus !== 'PAID') outcome = await reconcileFailedWalletCheckout(db, hold, stripe);
            }, { maxWait: 15000, timeout: 30000 });
            if (outcome?.paidSession) await completeCheckoutSessionPayment(failedOrder, outcome.paidSession);
        }

        if (event.type === "checkout.session.expired") {
            const session = event.data.object;
            const orderId = session.metadata?.orderId;

            if (session.metadata?.walletHoldId) {
                await prisma.$transaction(async db => {
                    const hold = await db.walletCheckoutHold.findUnique({ where: { id: session.metadata.walletHoldId } });
                    if (!hold) return;
                    await lockCheckout(db, hold.userId, hold.orderId);
                    const current = await db.walletCheckoutHold.findUnique({ where: { id: hold.id } });
                    if (current) await releaseHold(db, current, session);
                });
                return res.json({ received: true });
            }

            if (orderId) {
                const expiringOrder = await prisma.order.findUnique({ where: { id: orderId }, select: { id: true, customerId: true } });
                if (expiringOrder) await mutateCheckoutOrder(prisma, expiringOrder, stripe, async db => {
                    // Recheck under the same customer/order locks as creation:
                    // a newer hold may have committed while this event waited.
                    const activeHold = await db.walletCheckoutHold.findUnique({ where: { orderId } });
                    if (activeHold) return;
                    return db.order.updateMany({
                    where: {
                        id: orderId,
                        stripeCheckoutSessionId: session.id,
                        paymentStatus: "PENDING",
                    },
                    data: {
                        paymentStatus: "CANCELLED",
                    },
                    });
                }, false);

                console.log(`Stripe checkout expired for order ${orderId}`);
            }
        }

        return res.json({ received: true });
    } catch (error) {
        console.error("Stripe webhook handling error:", error);
        return res.status(500).send("Webhook handler failed");
    }
};

const createCheckoutSession = async (req, res) => {
    const userId = getUserId(req);
    const orderId = req.body?.orderId;
    if (!userId || !orderId || typeof orderId !== "string") return res.status(400).json({ ok: false, message: "A valid user and order are required." });
    const response = { code: 200, body: null, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
    const createdSessions = [];
    try {
        await prisma.$transaction(async db => withEarningsLedgerMutation(db, orderId, async () => {
            await lockCheckout(db, userId, orderId);
            return withBoosterOrderEmails(db, orderId, async () => {
                await buildCheckoutSession(req, response, db, createdSessions);
                // Expected validation failures must roll back coupon and price changes too.
                if (response.code >= 400) throw Object.assign(new Error("Checkout rejected"), { checkoutResponse: true });
            });
        }), { maxWait: 15000, timeout: 60000 });
    } catch (error) {
        for (const id of createdSessions) {
            try { await stripe.checkout.sessions.expire(id, {}, stripeOptions); }
            catch { console.error("Could not expire rolled-back checkout session", id); }
        }
        if (error.checkoutResponse && response.checkoutRecovery) {
            // Keep bounded replay recovery moving after repeated rollbacks. Only
            // record a session already confirmed expired, and never overwrite a
            // newer checkout that acquired the lock after our rollback.
            try {
                await prisma.$transaction(async db => {
                    await lockCheckout(db, userId, orderId);
                    await db.order.updateMany({
                        where: { id: orderId, customerId: userId, paymentStatus: { not: "PAID" }, status: { not: "CANCELLED" },
                            stripeCheckoutSessionId: response.checkoutRecovery.previousSessionId },
                        data: { stripeCheckoutSessionId: response.checkoutRecovery.expiredSessionId },
                    });
                }, { maxWait: 15000, timeout: 15000 });
            } catch { console.error("Checkout recovery checkpoint deferred", orderId); }
        }
        if (!error.checkoutResponse) {
            console.error("Checkout transaction failed:", error.code || error.name);
            return res.status(503).json({ ok: false, message: "Checkout is busy. Please try again shortly." });
        }
        return res.status(response.code).json(response.body);
    }
    if (response.body?.paidWithWallet || response.body?.paidWithGoldOnly) wakeAdminOrderEmailWorker(prisma);
    if (response.walletCheckoutHoldId) {
        try {
            const hold = await prisma.walletCheckoutHold.findUnique({ where: { id: response.walletCheckoutHoldId } });
            if (!hold || hold.userId !== userId || hold.orderId !== orderId) throw walletError('WALLET_QUOTE_CHANGED', 'This wallet checkout changed. Please review it again.');
            const session = await recoverHeldSession(hold, stripe);
            await prisma.$transaction(async db => {
                await lockCheckout(db, userId, orderId);
                const current = await db.walletCheckoutHold.findUnique({ where: { id: hold.id } });
                const order = await db.order.findUnique({ where: { id: orderId } });
                if (!current || !order || order.paymentStatus === 'PAID' || order.status === 'CANCELLED') throw walletError('WALLET_QUOTE_CHANGED', 'This wallet checkout changed. Please verify its payment status.');
                validateHeldSession(current, session);
                if (session.status === 'expired') {
                    await releaseHold(db, current, session);
                    return;
                }
                await db.walletCheckoutHold.update({ where: { id: hold.id }, data: { stripeCheckoutSessionId: session.id } });
                await db.order.update({ where: { id: orderId }, data: { stripeCheckoutSessionId: session.id } });
            });
            if (session.status === 'complete') return res.json({ ...response.body, completed: true, sessionId: session.id });
            if (session.status !== 'open' || session.payment_status !== 'unpaid' || !session.client_secret) throw walletError('WALLET_CHECKOUT_PENDING', 'This wallet checkout is not available. Please review the payment before retrying.');
            return res.json({ ...response.body, sessionId: session.id, clientSecret: session.client_secret,
                ...(response.couponNotice ? { couponNotice: response.couponNotice } : {}) });
        } catch (error) {
            return res.status(error.status || 503).json({ ok: false, code: error.code || 'WALLET_CHECKOUT_UNAVAILABLE',
                message: error.status ? error.message : 'Wallet checkout could not be opened. Retry the same order to recover your payment.' });
        }
    }
    return res.status(response.code).json({ ...response.body, ...(response.couponNotice ? { couponNotice: response.couponNotice } : {}) });
};

const payWithWallet = (req, res) => {
    req[walletPaymentRequest] = true;
    return createCheckoutSession(req, res);
};

const cancelCheckoutSession = async (req, res) => {
    const userId = getUserId(req);
    const { orderId, sessionId } = req.body || {};
    if (!userId || typeof orderId !== 'string' || !orderId || (sessionId !== undefined && (typeof sessionId !== 'string' || !/^cs_[A-Za-z0-9_]+$/.test(sessionId)))) {
        return res.status(400).json({ ok: false, message: 'A valid order and checkout reference are required.' });
    }
    let paidSession, ownedOrder;
    try {
        const result = await prisma.$transaction(async db => {
            await lockCheckout(db, userId, orderId);
            const order = await db.order.findFirst({ where: { id: orderId, customerId: userId } });
            if (!order) throw walletError('WALLET_ORDER_UNAVAILABLE', 'Order not found.', 404);
            ownedOrder = order;
            if (order.paymentStatus === 'PAID') return { paid: true, cancelled: false, orderId };
            const hold = await db.walletCheckoutHold.findUnique({ where: { orderId } });
            let session = hold ? await recoverHeldSession(hold, stripe) : order.stripeCheckoutSessionId
                ? await stripe.checkout.sessions.retrieve(order.stripeCheckoutSessionId, {}, stripeOptions) : null;
            if (sessionId && session?.id !== sessionId) throw walletError('WALLET_ORDER_UNAVAILABLE', 'Checkout not found for this order.', 404);
            if (session && !hold && (session.object !== 'checkout.session' || session.mode !== 'payment' || session.metadata?.orderId !== orderId || session.metadata?.customerId !== userId)) {
                throw walletError('WALLET_QUOTE_CHANGED', 'This checkout could not be verified.', 400);
            }
            if (session?.status === 'open' && session.payment_status === 'unpaid') {
                try { session = await stripe.checkout.sessions.expire(session.id, {}, stripeOptions); }
                catch { session = await stripe.checkout.sessions.retrieve(session.id, {}, stripeOptions); }
                if (hold) validateHeldSession(hold, session);
            }
            if (session?.status === 'complete' || session?.payment_status === 'paid') {
                if (session.status === 'complete' && session.payment_status === 'paid') paidSession = session;
                return { paid: false, cancelled: false, completed: true, pending: true, sessionId: session.id, orderId };
            }
            if (session && (session.status !== 'expired' || session.payment_status !== 'unpaid')) return { paid: false, cancelled: false, pending: true, orderId };
            if (hold) await releaseHold(db, hold, session);
            return { paid: false, cancelled: true, orderId, ...(session ? { sessionId: session.id } : {}) };
        }, { maxWait: 15000, timeout: 60000 });
        if (paidSession) {
            await completeCheckoutSessionPayment(ownedOrder, paidSession);
            const current = await prisma.order.findUnique({ where: { id: orderId }, select: { paymentStatus: true } });
            return res.json({ ok: true, ...result, paid: current.paymentStatus === 'PAID', pending: current.paymentStatus !== 'PAID' });
        }
        return res.json({ ok: true, ...result });
    } catch (error) {
        return res.status(error.status || 503).json({ ok: false, code: error.code || 'WALLET_CHECKOUT_UNAVAILABLE',
            message: error.status ? error.message : 'Checkout could not be safely cancelled. Please verify its payment status.' });
    }
};

const checkoutPresenceAction = leaving => async (req, res) => {
    const userId = getUserId(req);
    const { orderId, checkoutViewId, paymentInProgress = false } = req.body || {};
    if (!userId || typeof orderId !== 'string' || !orderId || typeof paymentInProgress !== 'boolean') {
        return res.status(400).json({ ok: false, message: 'A valid checkout view and order are required.' });
    }
    let ownedOrder, paidSession;
    try {
        const result = await prisma.$transaction(async db => {
            await lockCheckout(db, userId, orderId);
            const order = await db.order.findFirst({ where: { id: orderId, customerId: userId } });
            if (!order) throw walletError('WALLET_ORDER_UNAVAILABLE', 'Order not found.', 404);
            ownedOrder = order;
            if (leaving) await closeCheckoutPresence(db, userId, orderId, checkoutViewId, { paymentInProgress });
            else if (order.paymentStatus !== 'PAID') await renewCheckoutPresence(db, userId, orderId, checkoutViewId, { paymentInProgress });
            const hold = await db.walletCheckoutHold.findUnique({ where: { orderId } });
            const outcome = leaving && hold && order.paymentStatus !== 'PAID' ? await abandonWalletHold(db, hold, stripe)
                : { released: leaving && !hold && order.paymentStatus !== 'PAID', pending: Boolean(hold), paid: order.paymentStatus === 'PAID' };
            paidSession = outcome.paidSession;
            const available = await customerWallet.spendable(db, userId);
            return { orderId, released: Boolean(outcome.released), paid: order.paymentStatus === 'PAID', pending: Boolean(outcome.pending),
                availableBalanceCents: available.availableBalanceCents, reservedBalanceCents: available.reservedBalanceCents };
        }, { maxWait: 15000, timeout: 60000 });
        if (paidSession) {
            await completeCheckoutSessionPayment(ownedOrder, paidSession);
            const current = await prisma.order.findUnique({ where: { id: orderId }, select: { paymentStatus: true } });
            const wallet = await customerWallet.snapshot(userId);
            return res.json({ ok: true, ...result, paid: current.paymentStatus === 'PAID', pending: current.paymentStatus !== 'PAID',
                availableBalanceCents: wallet.availableBalanceCents, reservedBalanceCents: wallet.reservedBalanceCents });
        }
        return res.json({ ok: true, ...result });
    } catch (error) {
        return res.status(error.status || 503).json({ ok: false, code: error.code || 'WALLET_CHECKOUT_UNAVAILABLE',
            message: error.status ? error.message : 'Checkout presence could not be updated. Your reserved funds will be checked again shortly.' });
    }
};
const heartbeatCheckoutPresence = checkoutPresenceAction(false);
const leaveCheckoutPresence = checkoutPresenceAction(true);

module.exports = { createCheckoutSession, verifyCheckoutSession, handleStripeWebhook, payWithWallet, cancelCheckoutSession,
    heartbeatCheckoutPresence, leaveCheckoutPresence, completeCheckoutSessionPayment };

