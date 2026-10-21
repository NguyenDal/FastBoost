import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { loadStripe } from "@stripe/stripe-js";
import CheckoutPaymentForm, { CheckoutIcon } from "../components/CheckoutPaymentForm";
import CheckoutSkeleton, { PaymentFormSkeleton } from "../components/CheckoutSkeleton";
import PaymentErrorDialog from "../components/PaymentErrorDialog";
import LegalAgreement from "../components/LegalAgreement";
import { paymentErrorMessage } from "../utils/paymentError";
import { checkoutPriceDisplay } from "../utils/checkoutDisplay";
import PaymentResultPage from "./PaymentResultPage";
import Navbar from "../components/Navbar";
import { LiveSaleFooter } from "../components/SaleFooter";
import CleanIcon from "../components/CleanIcon";
import OrderPriceSummary from '../components/OrderPriceSummary';
import CheckoutSecurity from '../components/CheckoutSecurity';
import WalletCheckoutOption from '../components/WalletCheckoutOption';
import { createCheckoutSession, verifyCheckoutSession, checkServiceAvailability } from "../api/orders";
import { getWallet, payOrderWithWallet } from "../api/wallet";
import { walletMoney } from "../utils/wallet";
import { walletCardQuote, walletCheckoutAmounts, walletQuoteMatches } from '../utils/walletCheckout';
import useCheckoutPresence from '../hooks/useCheckoutPresence';
import { checkoutPresenceLost } from '../utils/checkoutPresence';
import "../styles/Checkout.css";

const publishableKey = import.meta.env.STRIPE_PUBLISHABLE_KEY?.trim();
const stripePromise = /^pk_(test|live)_\S+$/.test(publishableKey || "") ? loadStripe(publishableKey) : null;
const appearance = {
    theme: "night",
    variables: { colorPrimary: "#a855f7", colorBackground: "#111827", colorText: "#e5e7eb", colorDanger: "#fb7185", borderRadius: "10px", fontFamily: "Arial, sans-serif" },
};
const money = (cents, currency) => new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase(), currencyDisplay: "symbol" }).format(cents / 100);

export default function CheckoutPage() {
    const { orderId } = useParams();
    // A different order needs a fresh payment form, receipt and pending state.
    // Keep this boundary stable for same-order Gold/coupon quote updates.
    return <OrderCheckout key={orderId} orderId={orderId} />;
}

function OrderCheckout({ orderId }) {
    const active = useRef(true);
    useLayoutEffect(() => {
        active.current = true;
        return () => { active.current = false; };
    }, []);
    const [params, setParams] = useSearchParams();
    const navigate = useNavigate();
    const [data, setData] = useState(null);
    const [displaySession, setDisplaySession] = useState(null);
    const [error, setError] = useState("");
    const [paid, setPaid] = useState(false);
    const [verification, setVerification] = useState(null);
    const [celebratePaid, setCelebratePaid] = useState(false);
    const markPaid = useCallback(() => {
        if (!active.current) return;
        setPaid(true);
        // Reload the saved receipt after verification, including the final Gold/cash split.
        createCheckoutSession(orderId, 0, true, undefined, undefined, { checkoutViewId: checkoutViewRef.current }).then(result => {
            if (active.current && result.paid && result.summary) setData(result);
        }).catch(() => { /* Keep the confirmed checkout quote if the receipt read fails. */ });
    }, [orderId]);
    const completeConfirmation = useCallback(() => {
        if (!active.current) return;
        setVerification(null);
        setCelebratePaid(true);
        window.scrollTo({ top: 0, behavior: "instant" });
    }, []);
    const showPaid = paid && !verification;
    const priceDisplay = checkoutPriceDisplay(data?.summary?.priceSummary, data?.sessionId, displaySession);
    const [attempt, setAttempt] = useState(0);
    const [paymentBusy, setPaymentBusy] = useState(false);
    const [wallet, setWallet] = useState(null);
    const [walletLoading, setWalletLoading] = useState(true);
    const [walletProcessing, setWalletProcessing] = useState(false);
    const [walletConfirmation, setWalletConfirmation] = useState(null);
    const [walletError, setWalletError] = useState('');
    const [walletReload, setWalletReload] = useState(0);
    const walletSubmitting = useRef(false);
    const [updatingPrice, setUpdatingPrice] = useState(false);
    const [priceUpdateError, setPriceUpdateError] = useState(null);
    const priceRequest = useRef(false);
    const [goldConfirmation, setGoldConfirmation] = useState(null);
    const [goldError, setGoldError] = useState("");
    const goldSubmitting = useRef(false);
    const [contactEmail, setContactEmail] = useState(null);
    const [couponNotice, setCouponNotice] = useState(null);
    const request = useRef(null);
    const [fullWallet, setFullWallet] = useState(null);
    const fullWalletRef = useRef(null);
    const checkoutBusy = useRef(false);
    const checkoutViewRef = useRef(null);
    useLayoutEffect(() => { checkoutBusy.current = paymentBusy; }, [paymentBusy]);
    const presence = useCheckoutPresence(orderId, { ready: Boolean(data?.summary) && !paid,
        onLost: () => {
            setData(null); setError(''); setPriceUpdateError(null); setWalletConfirmation(null); setGoldConfirmation(null);
            fullWalletRef.current = null; setFullWallet(null); request.current = null;
        },
        onPaid: result => {
            setData(previous => previous ? { ...previous, clientSecret: undefined } : previous);
            setVerification({ orderId: result.orderId || orderId, wallet: '1' });
            fullWalletRef.current = null; setFullWallet(null); setWalletConfirmation(null);
        },
    });
    const { checkoutViewId } = presence;
    useLayoutEffect(() => { checkoutViewRef.current = checkoutViewId; }, [checkoutViewId]);
    const gold = Math.max(0, Math.floor(Number(params.get("gold")) || 0));
    const walletQuery = Number(params.get('wallet'));
    const requestedWallet = params.has('wallet') ? (Number.isSafeInteger(walletQuery) && walletQuery >= 0 ? walletQuery : 0) : undefined;
    const confirmGoldPayment = useCallback(result => {
        if (!active.current) return;
        // Older servers omit the receipt on Gold success. Keep the order visible
        // while verification reloads it, without displaying the previous cash total.
        setData(previous => ({ ...result, summary: result.summary || (previous?.summary
            ? { ...previous.summary, priceSummary: undefined } : undefined) }));
        setGoldConfirmation(null);
        setVerification({ orderId: result.orderId || orderId, gold: "1" });
    }, [orderId]);
    const syncQuote = useCallback(result => {
        const appliedGold = result.summary.goldRedeemed || 0;
        const appliedWallet = result.summary.walletAppliedCents || 0;
        request.current = { key: `${checkoutViewId}:${orderId}:${appliedGold}:${appliedWallet}:${attempt}`, handled: true };
        setParams(previous => {
            const next = new URLSearchParams(previous);
            next.set('gold', String(appliedGold)); next.set('wallet', String(appliedWallet));
            return next;
        }, { replace: true });
    }, [checkoutViewId, orderId, attempt, setParams]);
    const prepareFullWallet = useCallback(async ({ amountCents, priorWalletCents = 0, goldToUse = 0, couponCode, quote }) => {
        if (!active.current || checkoutBusy.current || priceRequest.current || walletSubmitting.current
            || ['preparing', 'ready', 'restoring'].includes(fullWalletRef.current?.stage)) return;
        const context = { amountCents, priorWalletCents, goldToUse, couponCode, stage: 'preparing', quote: null, error: '' };
        fullWalletRef.current = context; setFullWallet(context); setWalletConfirmation(amountCents);
        priceRequest.current = true;
        try {
            const result = quote || await createCheckoutSession(orderId, goldToUse, true, undefined, couponCode, { walletToUseCents: amountCents, checkoutViewId });
            if (!active.current || fullWalletRef.current !== context) return;
            if (result.paid || result.paidWithGoldOnly || result.completed) {
                fullWalletRef.current = null; setFullWallet(null); setWalletConfirmation(null);
                setData(result);
                setVerification(result.completed && result.sessionId ? { session_id: result.sessionId } : { orderId: result.orderId || orderId, wallet: '1' });
                return;
            }
            const summary = result.summary;
            if (!result.walletOnlyReady || !Number.isSafeInteger(summary?.orderTotalCents) || summary.orderTotalCents <= 0
                || String(summary.currency).toLowerCase() !== 'usd' || summary.walletAppliedCents !== summary.orderTotalCents
                || summary.totalCents !== 0 || summary.cardAmountCents !== 0) throw new Error('Unable to prepare a full wallet payment.');
            const ready = { ...context, amountCents: summary.orderTotalCents, goldToUse: summary.goldRedeemed || 0, stage: 'ready', quote: result };
            fullWalletRef.current = ready; setFullWallet(ready); setWalletConfirmation(summary.orderTotalCents);
            setPriceUpdateError(null); syncQuote(result);
        } catch (failure) {
            if (!active.current || fullWalletRef.current !== context) return;
            if (checkoutPresenceLost(failure)) { presence.recover(failure); return; }
            const failed = { ...context, stage: 'error', error: 'We couldn’t prepare your wallet payment. Try again or return to payment methods.' };
            fullWalletRef.current = failed; setFullWallet(failed);
        } finally { priceRequest.current = false; }
    }, [checkoutViewId, orderId, presence, syncQuote]);
    const restoreCardPayment = async () => {
        if (!active.current || priceRequest.current || walletSubmitting.current || paymentBusy) return;
        const context = fullWalletRef.current;
        if (!context) { setWalletConfirmation(null); return; }
        const restoring = { ...context, stage: 'restoring', error: '' };
        fullWalletRef.current = restoring; setFullWallet(restoring); priceRequest.current = true;
        try {
            const total = context.quote?.summary.orderTotalCents ?? context.amountCents;
            const walletToUseCents = Math.min(context.priorWalletCents, Math.max(0, total - 50));
            const result = await createCheckoutSession(orderId, context.goldToUse, true, undefined, undefined, { walletToUseCents, checkoutViewId });
            if (!active.current || fullWalletRef.current !== restoring) return;
            if (result.paid || result.paidWithGoldOnly || result.completed) {
                setData(result);
                setVerification(result.completed && result.sessionId ? { session_id: result.sessionId } : { orderId: result.orderId || orderId, wallet: '1' });
            } else {
                if (!walletCardQuote(result)) throw new Error('A current card quote is required.');
                setData(result); syncQuote(result); setPriceUpdateError(null); setWalletReload(value => value + 1);
            }
            fullWalletRef.current = null; setFullWallet(null); setWalletConfirmation(null);
        } catch (failure) {
            if (!active.current || fullWalletRef.current !== restoring) return;
            if (checkoutPresenceLost(failure)) { presence.recover(failure); return; }
            const failed = { ...context, stage: 'restore-error', error: 'We couldn’t restore your payment methods. Try returning again before paying.' };
            fullWalletRef.current = failed; setFullWallet(failed);
        } finally { priceRequest.current = false; }
    };

    useEffect(() => {
        let cancelled = false;
        const controller = new AbortController();
        setWalletLoading(true);
        getWallet({ signal: controller.signal }).then(result => {
            if (!cancelled) setWallet(result);
        }).catch(() => { if (!cancelled) setWallet(null); })
            .finally(() => { if (!cancelled) setWalletLoading(false); });
        return () => { cancelled = true; controller.abort(); };
    }, [walletReload]);
    useEffect(() => {
        const refresh = () => { if (!document.hidden && !walletSubmitting.current) setWalletReload(value => value + 1); };
        window.addEventListener('focus', refresh);
        window.addEventListener('wallet:updated', refresh);
        return () => { window.removeEventListener('focus', refresh); window.removeEventListener('wallet:updated', refresh); };
    }, []);

    useEffect(() => {
        let cancelled = false;
        const key = `${checkoutViewId}:${orderId}:${gold}:${requestedWallet ?? ''}:${attempt}`;
        if (request.current?.key !== key) request.current = { key, promise: createCheckoutSession(orderId, gold, true, undefined, undefined, { walletToUseCents: requestedWallet, checkoutViewId }) };
        // Applying a discount already refreshed the quote. Syncing its URL must
        // not send another request or replay the checkout loading state.
        if (request.current.handled) return;
        request.current.promise.then(async (result) => {
            if (cancelled || !active.current) return;
            if (result.couponNotice) setCouponNotice(result.couponNotice);
            if (result.paid) {
                setData(result);
                setPaid(true);
                if (params.get("session_id")) setVerification({ orderId: result.orderId });
            } else if (result.paidWithGoldOnly) {
                confirmGoldPayment(result);
            } else if (result.completed) {
                setData(result);
                setVerification({ session_id: result.sessionId });
            } else if (result.goldOnlyReady) {
                const cardCheckout = await createCheckoutSession(orderId, 0, true, undefined, undefined, { checkoutViewId });
                if (cancelled || !active.current) return;
                if (!cardCheckout.clientSecret) throw new Error("Unable to load card payment.");
                setData(cardCheckout);
                setGoldConfirmation(result.summary.goldRedeemed);
            } else if (result.walletOnlyReady) {
                const cardCheckout = await createCheckoutSession(orderId, result.summary.goldRedeemed || 0, true, undefined, undefined, { walletToUseCents: 0, checkoutViewId });
                if (cancelled || !active.current) return;
                if (cardCheckout.paid || cardCheckout.completed) {
                    setData(cardCheckout);
                    setVerification(cardCheckout.completed && cardCheckout.sessionId ? { session_id: cardCheckout.sessionId } : { orderId, wallet: '1' });
                    return;
                }
                if (!walletCardQuote(cardCheckout)) throw new Error('Unable to load card payment.');
                setData(cardCheckout);
                await prepareFullWallet({ amountCents: result.summary.orderTotalCents, goldToUse: result.summary.goldRedeemed || 0 });
            } else if (result.clientSecret) {
                setData(result);
            } else setError("Unable to start payment. Please try again.");
        }).catch(async (failure) => {
            if (cancelled || !active.current) return;
            if (checkoutPresenceLost(failure)) { presence.recover(failure); return; }
            // Older running servers return an error for an already-paid order.
            // Verify ownership/payment status before presenting the paid screen.
            if (/already (?:been )?paid/i.test(failure.message || "")) {
                try {
                    const order = await verifyCheckoutSession({ orderId });
                    if (cancelled || !active.current) return;
                    if (order.paid) {
                        setError("");
                        setPaid(true);
                        return;
                    }
                } catch {
                    // Keep the original failure if verification is unavailable.
                }
            }
            if (!cancelled && active.current) setError(failure.message || "Unable to load checkout.");
        });
        return () => { cancelled = true; };
    }, [checkoutViewId, orderId, gold, requestedWallet, attempt, params, confirmGoldPayment, prepareFullWallet, presence]);

    const updatePrice = async (goldToUse, couponCode, walletToUseCents = data?.summary?.walletAppliedCents || 0) => {
        if (!active.current || paymentBusy || priceRequest.current || fullWalletRef.current) return;
        priceRequest.current = true;
        setUpdatingPrice(true);
        try {
            let result = await createCheckoutSession(orderId, goldToUse, true, undefined, couponCode, { walletToUseCents, checkoutViewId });
            if (!active.current) return;
            const notice = result.couponNotice;
            let confirmGold = null;
            if (result.goldOnlyReady) {
                confirmGold = result.summary.goldRedeemed;
                result = await createCheckoutSession(orderId, 0, true, undefined, undefined, { walletToUseCents: 0, checkoutViewId });
                if (!active.current) return;
            }
            if (result.walletOnlyReady) {
                priceRequest.current = false;
                await prepareFullWallet({ amountCents: result.summary.orderTotalCents, priorWalletCents: data?.summary.walletAppliedCents || 0, goldToUse, couponCode, quote: result });
                return;
            }
            if (!result.summary || !(result.clientSecret || result.walletOnlyReady || result.paid || result.paidWithGoldOnly || result.completed)) throw new Error("Unable to update checkout.");
            const appliedGold = result.summary.goldRedeemed || 0;
            const appliedWallet = result.summary.walletAppliedCents || 0;
            request.current = { key: `${checkoutViewId}:${orderId}:${appliedGold}:${appliedWallet}:${attempt}`, handled: true };
            setParams(previous => {
                const next = new URLSearchParams(previous);
                next.set("gold", String(appliedGold));
                next.set('wallet', String(appliedWallet));
                return next;
            }, { replace: true });
            setData(result);
            setPriceUpdateError(null);
            if (result.paid) setPaid(true);
            if (result.paidWithGoldOnly) confirmGoldPayment(result);
            if (result.completed) setVerification({ session_id: result.sessionId });
            if (confirmGold !== null) setGoldConfirmation(confirmGold);
            if (notice) setCouponNotice(notice);
        } catch (failure) {
            if (!active.current) return;
            if (checkoutPresenceLost(failure)) { presence.recover(failure); return; }
            if (failure.code === "COUPON_UNAVAILABLE") {
                setCouponNotice({ title: "Coupon not applied", message: failure.message });
            } else {
                // The server may have expired the old session before a network
                // failure. Preserve the form, but require a fresh quote to pay.
                setPriceUpdateError({ goldToUse, couponCode, walletToUseCents });
            }
        } finally {
            priceRequest.current = false;
            if (active.current) setUpdatingPrice(false);
        }
    };
    const applyGold = value => {
        if (paymentBusy || priceRequest.current || fullWalletRef.current) return;
        if (!priceUpdateError && data && value * 10 >= (data.summary.orderTotalCents ?? data.summary.totalCents) + data.summary.goldDiscountCents) {
            setGoldError("");
            setGoldConfirmation(value);
            return;
        }
        return updatePrice(value);
    };
    const applyCoupon = code => updatePrice(data?.summary.goldRedeemed || 0, code);
    const payWithGold = async () => {
        if (!active.current || paymentBusy || goldSubmitting.current || priceRequest.current || fullWalletRef.current || priceUpdateError || goldConfirmation === null) return;
        goldSubmitting.current = true;
        setGoldError("");
        setPaymentBusy(true);
        let settlementStarted = false;
        try {
            const email = (contactEmail ?? data?.summary.email ?? "").trim();
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw Object.assign(new Error(), { code: "email_required" });
            if (!await presence.protect()) return;
            if (!active.current) return;
            settlementStarted = true;
            const result = await createCheckoutSession(orderId, goldConfirmation, false, email, undefined, { walletToUseCents: 0, checkoutViewId });
            if (!active.current) return;
            if (result.couponNotice) setCouponNotice(result.couponNotice);
            if (result.paidWithGoldOnly || result.paid) {
                confirmGoldPayment(result);
            } else if (result.clientSecret) { setData(result); setGoldConfirmation(null); }
            else throw new Error("Your balance changed. Please review your payment again.");
        } catch (failure) {
            if (active.current) {
                if (checkoutPresenceLost(failure)) { presence.recover(failure); return; }
                setGoldConfirmation(null);
                if (settlementStarted && (!Number.isInteger(failure?.status) || failure.status >= 500)) {
                    // A disconnected browser may have missed a committed Gold
                    // payment. Read this order's status before allowing payment.
                    setData(previous => previous?.summary ? { ...previous, summary: { ...previous.summary, priceSummary: undefined } } : previous);
                    setVerification({ orderId, gold: "1" });
                } else { await presence.clearProtection(); if (active.current) setGoldError(paymentErrorMessage(failure)); }
            }
        } finally { goldSubmitting.current = false; if (active.current) setPaymentBusy(false); }
    };
    const beforeConfirm = async () => {
        if (!active.current || fullWalletRef.current) throw new DOMException('Checkout changed.', 'AbortError');
        if (!walletQuoteMatches(data.summary, data.sessionId, displaySession)) {
            setPriceUpdateError({ goldToUse: data.summary.goldRedeemed || 0, walletToUseCents: data.summary.walletAppliedCents });
            throw Object.assign(new Error('The wallet payment quote changed.'), { code: 'WALLET_QUOTE_CHANGED' });
        }
        await checkServiceAvailability(data.summary.serviceId);
        if (!active.current) throw new DOMException('Checkout changed.', 'AbortError');
        if (!await presence.protect()) throw new DOMException('Payment is being verified.', 'AbortError');
        if (!active.current) throw new DOMException('Checkout changed.', 'AbortError');
    };
    const payWithWallet = async () => {
        if (!active.current || walletSubmitting.current || paymentBusy || updatingPrice || priceRequest.current || priceUpdateError || walletConfirmation === null
            || (fullWalletRef.current && fullWalletRef.current.stage !== 'ready')) return;
        walletSubmitting.current = true;
        setWalletProcessing(true);
        setPaymentBusy(true);
        setWalletError('');
        let settlementStarted = false;
        try {
            const email = (contactEmail ?? data?.summary.email ?? '').trim();
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw Object.assign(new Error(), { code: 'email_required' });
            if (!await presence.protect()) return;
            if (!active.current) return;
            settlementStarted = true;
            const confirmedTotal = fullWalletRef.current?.quote?.summary.orderTotalCents ?? walletConfirmation;
            const result = await payOrderWithWallet(orderId, email, confirmedTotal, { checkoutViewId });
            if (!active.current) return;
            setWalletConfirmation(null);
            fullWalletRef.current = null; setFullWallet(null);
            if (result.paidWithWallet || result.paid) {
                if (result.summary) setData(previous => ({ ...previous, ...result }));
                setVerification({ orderId: result.orderId || orderId, wallet: '1' });
                window.dispatchEvent(new Event('wallet:updated'));
            } else if (result.completed && result.sessionId) {
                setVerification({ session_id: result.sessionId });
            } else throw new Error('Payment status needs verification.');
        } catch (failure) {
            if (!active.current) return;
            if (checkoutPresenceLost(failure)) { presence.recover(failure); return; }
            if (settlementStarted && (!Number.isInteger(failure?.status) || failure.status >= 500 || failure.code === 'WALLET_CARD_IN_PROGRESS')) {
                setWalletConfirmation(null); fullWalletRef.current = null; setFullWallet(null);
                setData(previous => previous?.summary ? { ...previous, summary: { ...previous.summary, priceSummary: undefined } } : previous);
                setVerification(failure.code === 'WALLET_CARD_IN_PROGRESS' && data?.sessionId ? { session_id: data.sessionId, orderId } : { orderId, wallet: '1' });
            } else {
                const failedContext = fullWalletRef.current;
                await presence.clearProtection();
                if (!active.current || (failedContext && fullWalletRef.current !== failedContext)) return;
                const messages = {
                    WALLET_INSUFFICIENT: 'Your wallet balance changed and no longer covers this order. Top up your wallet or choose another payment method.',
                    WALLET_FROZEN: 'Your wallet is temporarily restricted. Please contact support.',
                    WALLET_QUOTE_CHANGED: 'Your order total changed. Review the refreshed total before paying.',
                    WALLET_EMAIL: 'Please enter a valid email address so we can send your payment confirmation.',
                };
                const message = messages[failure.code] || paymentErrorMessage(failure);
                if (fullWalletRef.current) {
                    const failed = { ...fullWalletRef.current, stage: 'error', error: message };
                    fullWalletRef.current = failed; setFullWallet(failed);
                } else { setWalletConfirmation(null); setWalletError(message); }
                setWalletReload(value => value + 1);
                if (failure.code === 'WALLET_QUOTE_CHANGED' && !fullWalletRef.current) setAttempt(value => value + 1);
            }
        } finally {
            walletSubmitting.current = false;
            if (active.current) { setWalletProcessing(false); setPaymentBusy(false); }
        }
    };
    const walletBusy = paymentBusy || updatingPrice || Boolean(verification) || paid || goldConfirmation !== null || Boolean(priceUpdateError);
    const fullWalletSelection = amount => prepareFullWallet({ amountCents: amount, priorWalletCents: data?.summary.walletAppliedCents || 0, goldToUse: data?.summary.goldRedeemed || 0 });
    const walletContent = <WalletCheckoutOption key={`${data?.summary?.walletAppliedCents || 0}:${data?.sessionId || ''}`} wallet={wallet} loading={walletLoading} applying={updatingPrice} summary={fullWallet?.quote?.summary || data?.summary} orderId={orderId} busy={walletBusy} onRetry={() => setWalletReload(value => value + 1)} onMax={fullWalletSelection} onApply={amount => amount === walletCheckoutAmounts(wallet, data.summary).order ? fullWalletSelection(amount) : updatePrice(data?.summary.goldRedeemed || 0, undefined, amount)} />;

    return <div className={"checkout-shell checkout-" + (data?.summary?.game || "lol")}>
        <Navbar />
        <main className="checkout-container">
            <h1>Secure Payment</h1>
            <ol className={`checkout-steps checkout-steps-entering${celebratePaid ? " checkout-steps-completing" : ""}`} aria-label="Order progress">
                <li className="done"><span>✓</span><strong>Order Details</strong><small>Completed</small></li>
                <li className={showPaid ? "done active" : "active"} aria-current={showPaid ? undefined : "step"}><span>{showPaid ? "✓" : "2"}</span><strong>Payment</strong><small>{showPaid ? "Completed" : "Complete your payment"}</small></li>
                <li className={showPaid ? "active" : undefined} aria-current={showPaid ? "step" : undefined}><span>3</span><strong>Boost Begins</strong><small>{showPaid ? "Ready to start" : "After payment"}</small></li>
            </ol>
            {error && !showPaid ? <section className="checkout-card"><button className="checkout-pay" onClick={() => { setError(""); setAttempt(value => value + 1); }}>Try again</button></section> : !data?.summary && !showPaid ? <CheckoutSkeleton /> :
                <div className={`checkout-grid${showPaid ? " checkout-grid-paid" : ""}${celebratePaid ? " checkout-grid-celebrate" : ""}`}>
                    <section className="checkout-card checkout-payment" inert={Boolean(verification) || showPaid} aria-hidden={showPaid || undefined}>
                        <h2>Payment Method</h2>
                        {!showPaid && data?.clientSecret && stripePromise ? <CheckoutPaymentForm key={orderId} email={contactEmail ?? data.summary.email ?? ""} onEmailChange={setContactEmail} sessionId={data.sessionId} clientSecret={data.clientSecret} appearance={appearance} stripePromise={stripePromise} updatingPrice={updatingPrice} paymentBlocked={Boolean(priceUpdateError) || walletProcessing || goldConfirmation !== null} suspended={Boolean(fullWallet)} onBusyChange={setPaymentBusy} onCheckoutChange={setDisplaySession} onSuccess={setVerification} onBeforeConfirm={beforeConfirm} onDefinitiveFailure={presence.clearProtection} walletContent={walletContent} allowAdaptivePricing={!(data.summary.walletAppliedCents > 0)} /> : !showPaid && (verification ? <PaymentFormSkeleton /> : <>{walletContent}<p role="alert">Card payment is temporarily unavailable. Please reload this page or contact support.</p></>)}
                    </section>
                    <OrderSummary summary={data?.summary || { orderId }} priceDisplay={priceDisplay} onApplyGold={applyGold} onApplyCoupon={applyCoupon} onRemoveWallet={() => updatePrice(data?.summary.goldRedeemed || 0, undefined, 0)} paymentBusy={paymentBusy || updatingPrice || paid || Boolean(verification) || goldConfirmation !== null} updatingPrice={updatingPrice} priceUpdateError={priceUpdateError} onRetryPrice={() => updatePrice(priceUpdateError.goldToUse, priceUpdateError.couponCode, priceUpdateError.walletToUseCents)} paid={showPaid} onGoToOrder={() => navigate(`/match/${orderId}`)} />
                </div>}
        </main>
        {data?.summary?.serviceId && !paid && !verification && <LiveSaleFooter key={data.summary.serviceId} serviceId={data.summary.serviceId} />}
        {verification && <PaymentResultPage type="success" overlayOnly verification={verification} onVerified={markPaid} onComplete={completeConfirmation} />}
        {error && !paid && <PaymentErrorDialog message={error === paymentErrorMessage({ code: "SERVICE_UNAVAILABLE" }) ? error : "We couldn’t load checkout. Please try again. If this continues, contact support."} action={error === paymentErrorMessage({ code: "SERVICE_UNAVAILABLE" }) ? "Back to Services" : "Retry Checkout"} onClose={() => { if (error === paymentErrorMessage({ code: "SERVICE_UNAVAILABLE" })) navigate("/"); else { setError(""); setAttempt(value => value + 1); } }} />}
        {goldError && <PaymentErrorDialog message={goldError} onClose={() => setGoldError("")} />}
        {walletError && <PaymentErrorDialog message={walletError} onClose={() => setWalletError('')} />}
        {walletConfirmation !== null && <WalletConfirmation totalCents={walletConfirmation} busy={walletProcessing || fullWallet?.stage === 'preparing' || fullWallet?.stage === 'restoring'} error={fullWallet?.error} ready={!fullWallet || fullWallet.stage === 'ready'} onConfirm={payWithWallet} onRetry={() => fullWalletRef.current?.stage === 'restore-error' ? restoreCardPayment() : prepareFullWallet({ ...fullWalletRef.current, quote: undefined })} onBack={restoreCardPayment} />}
        {couponNotice && <PaymentErrorDialog informational title={couponNotice.title} message={couponNotice.message} action="Got it" onClose={() => setCouponNotice(null)} />}
        {goldConfirmation !== null && <GoldConfirmation gold={goldConfirmation} busy={paymentBusy} onConfirm={payWithGold} onBack={() => { if (!paymentBusy) setGoldConfirmation(null); }} />}
    </div>;
}

function WalletConfirmation({ totalCents, busy, error, ready = true, onConfirm, onBack, onRetry }) {
    const dialog = useRef(null);
    useEffect(() => {
        const element = dialog.current;
        element.showModal();
        return () => element.close();
    }, []);
    return <dialog ref={dialog} className="checkout-gold-dialog" aria-labelledby="wallet-confirm-title" aria-describedby="wallet-confirm-description" onCancel={event => { event.preventDefault(); if (!busy) onBack(); }}>
        <h2 id="wallet-confirm-title">Pay with your wallet?</h2>
        <p id="wallet-confirm-description">We’ll deduct <strong>{walletMoney(totalCents)}</strong> from your FastBoost Wallet to pay for this order in full.</p>
        <p className="checkout-agreement"><LegalAgreement action="placing this order" /></p>
        {error && <p className="checkout-error" role="alert">{error}</p>}
        <button className="checkout-pay" disabled={busy} onClick={ready ? onConfirm : onRetry}>{busy ? 'Processing…' : ready ? `Confirm payment · ${walletMoney(totalCents)}` : 'Try again'}</button>
        <button className="checkout-gold-back" autoFocus disabled={busy} onClick={onBack}>Back to payment methods</button>
    </dialog>;
}

function GoldConfirmation({ gold, busy, onConfirm, onBack }) {
    const dialog = useRef(null);
    const [closing, setClosing] = useState(false);
    useEffect(() => {
        const element = dialog.current;
        element.showModal();
        return () => element.close();
    }, []);
    useEffect(() => {
        if (!closing) return;
        const timer = setTimeout(onBack, 180);
        return () => clearTimeout(timer);
    }, [closing, onBack]);
    return <dialog ref={dialog} className={`checkout-gold-dialog${closing ? " is-closing" : ""}`} aria-labelledby="gold-confirm-title" aria-describedby="gold-confirm-description" onCancel={event => { event.preventDefault(); if (!busy) setClosing(true); }}>
        <h2 id="gold-confirm-title">Pay with {gold} gold?</h2>
        <p id="gold-confirm-description">Your gold covers this order in full. Confirm to spend {gold} gold and place your order.</p>
        <p className="checkout-agreement"><LegalAgreement action="placing this order" /></p>
        <button className="checkout-pay" disabled={busy || closing} onClick={onConfirm}>{busy ? "Processing…" : `Pay with ${gold} gold`}</button>
        <button className="checkout-gold-back" autoFocus disabled={busy || closing} onClick={() => setClosing(true)}>Back to card payment</button>
    </dialog>;
}

function OrderSummary({ summary, priceDisplay, onApplyGold, onApplyCoupon, onRemoveWallet, paymentBusy, updatingPrice, priceUpdateError, onRetryPrice, paid, onGoToOrder }) {
    const [promoCode, setPromoCode] = useState("");
    const enteredCode = promoCode.trim();
    return <aside className={`checkout-card checkout-summary${paid ? " checkout-summary-confirmed" : ""}`}>
        <div className="checkout-summary-heading"><h2>{paid ? `Order #${summary.orderNumber || "…"}` : "Order Summary"}</h2>{!paid && <Link to={"/order/" + summary.serviceId}>Edit Order</Link>}</div>
        {!paid && <div className="checkout-game"><CleanIcon src={"https://fastboost-assets.s3.amazonaws.com/logos/" + (summary.game === "tft" ? "tft-logo.png" : "lol-logo.jpg")} alt="" /><div><strong>{summary.game === "tft" ? "Teamfight Tactics" : "League of Legends"}</strong><p className="checkout-service-meta">{[summary.serviceType || summary.title?.replace(/^TFT\s+/i, ""), summary.queueType, summary.region].filter(Boolean).map((value, index) => <span key={index}>{value}</span>)}</p></div></div>}
        {paid ? <div className="checkout-paid-content">
            <div className="checkout-confirmed-layout">
                <div className="checkout-confirmed-game">
                    <CleanIcon src={`https://fastboost-assets.s3.amazonaws.com/logos/${summary.game === "tft" ? "tft-logo.png" : "lol-logo.jpg"}`} alt="" />
                    <div><h3>{summary.game === "tft" ? "Teamfight Tactics" : "League of Legends"}</h3><p>{summary.serviceType || summary.title?.replace(/^TFT\s+/i, "")}</p>
                        <div className="checkout-confirmed-tags">
                            {summary.queueType && <span><CheckoutIcon type="shield" />{summary.queueType}</span>}
                            {summary.region && <span><CheckoutIcon type="globe" />{summary.region}</span>}
                        </div>
                    </div>
                </div>
                <div className="checkout-confirmed-progress"><OrderTracker summary={summary} /></div>
                <section className="checkout-next-steps">
                    <h3>What Happens Next</h3>
                    <div><span className="checkout-next-icon"><CheckoutIcon type="user" /></span><div><strong>Booster Assigned Soon</strong><p>We’ll match you with a booster shortly.</p></div></div>
                    <div><span className="checkout-next-icon"><CheckoutIcon type="chat" /></span><div><strong>Track Progress in Chat</strong><p>Open your order page to message support.</p></div></div>
                </section>
            </div>
            <OrderPriceSummary summary={summary.priceSummary} variant="checkout" settled />
            <p className="checkout-paid-notice" role="status"><span aria-hidden="true">✓</span>Your order has been paid. Your boost is ready to begin.</p>
            <button className="checkout-pay checkout-confirmed-button" onClick={onGoToOrder}>Go to Order <CheckoutIcon type="arrow" /></button>
        </div> : <>
        <div className="checkout-order-details"><OrderTracker summary={summary} /></div>
        {!paid && <GoldRedemption key={summary.goldRedeemed} summary={summary} formatPrice={priceDisplay?.formatPrice} onApply={onApplyGold} disabled={paymentBusy} />}
        <form className="checkout-promo" onSubmit={event => { event.preventDefault(); if (enteredCode && !paymentBusy) onApplyCoupon(enteredCode); }}>
            <label className="checkout-field-label" htmlFor="checkout-promo-code">Coupon code</label>
            <div className="checkout-promo-controls"><div className="checkout-input"><input id="checkout-promo-code" placeholder="Enter your coupon code" autoComplete="off" spellCheck={false} maxLength={32} value={promoCode} disabled={paymentBusy} onChange={event => setPromoCode(event.target.value)} aria-describedby="checkout-promo-help" /></div><button type="submit" disabled={!enteredCode || paymentBusy}>Apply</button></div>
            <p id="checkout-promo-help">Coupons count as used only after successful payment. We apply the larger sale or coupon discount.</p>
        </form>
        <OrderPriceSummary summary={summary.priceSummary} variant="checkout" formatPrice={priceDisplay?.formatPrice} onRemoveCoupon={() => onApplyCoupon('')} onRemoveWallet={onRemoveWallet} busy={paymentBusy} />
        {priceUpdateError && <div className="checkout-price-error" role="alert"><p>We couldn’t refresh your total. Retry before paying. Your entered details are still here.</p><button type="button" disabled={paymentBusy} onClick={onRetryPrice}>{updatingPrice ? "Updating…" : "Retry update"}</button></div>}
        <CheckoutSecurity />
        </>}
    </aside>;
}

function OrderTracker({ summary }) {
    const rankIcon = rank => {
        const tier = rank?.split(" ")[0]?.toLowerCase();
        if (!["unranked", "iron", "bronze", "silver", "gold", "platinum", "emerald", "diamond", "master", "grandmaster", "challenger"].includes(tier)) return null;
        return <img src={`https://fastboost-assets.s3.amazonaws.com/services/ranks/${tier}.${tier === "unranked" ? "webp" : "png"}`} alt="" />;
    };
    const quantityLabel = summary.quantity?.label === "Placement Matches" ? "Matches" : summary.quantity?.label === "Ranked Wins" ? "Wins" : "Games";
    const quantityText = summary.quantity ? `${summary.quantity.value} ${Number(summary.quantity.value) === 1 ? quantityLabel.slice(0, quantityLabel === "Matches" ? -2 : -1) : quantityLabel}` : "";
    return <div className="checkout-order-tracker">
        {summary.currentRank && <div aria-label={`${summary.serviceType === "Placement Boost" ? "Peak" : "Current"} rank: ${summary.currentRank}`}>{rankIcon(summary.currentRank)}<span>{summary.currentRank}</span></div>}
        {(summary.targetRank || summary.quantity) && <span className="checkout-tracker-arrow" aria-hidden="true">→</span>}
        {summary.targetRank && <div aria-label={`Target rank: ${summary.targetRank}`}>{rankIcon(summary.targetRank)}<span>{summary.targetRank}</span></div>}
        {summary.quantity && <div><span>{quantityText}</span></div>}
    </div>;
}

function GoldRedemption({ summary, formatPrice, onApply, disabled }) {
    const [value, setValue] = useState(String(summary.goldRedeemed || 0));
    const available = Math.max(0, summary.availableGold || 0);
    const orderCents = (summary.orderTotalCents ?? summary.totalCents) + summary.goldDiscountCents;
    const rawMaximum = Math.min(available, Math.max(0, Math.floor(orderCents / 10)));
    const remainingCents = orderCents - rawMaximum * 10;
    const orderMaximum = remainingCents > 0 && remainingCents < 50 ? Math.max(0, Math.floor((orderCents - 50) / 10)) : rawMaximum;
    const eligible = available >= 100 && orderMaximum >= 100;
    const maximum = eligible ? Math.min(available, orderMaximum) : 0;
    const warning = !eligible ? "Gold redemption requires at least 100 Gold within your balance and this order’s payment limits." : !/^\d+$/.test(value.trim())
        ? "Please enter a whole number of gold."
        : Number(value) > 0 && Number(value) < 100
            ? "Redeem at least 100 Gold, or enter 0 to remove Gold."
        : Number(value) > available
            ? `You only have ${available} gold available.`
            : Number(value) > orderMaximum
                ? `This exceeds the order total. You can use up to ${orderMaximum} gold for this order.`
                : !Number.isSafeInteger(Number(value))
                    ? "Please enter a whole number of gold."
                    : "";
    const valid = !warning;
    return <form className="checkout-gold" onSubmit={event => { event.preventDefault(); if (valid && !disabled) onApply(Number(value)); }}>
        <div className="checkout-gold-heading"><label htmlFor="checkout-gold">Use your gold</label><span>{summary.availableGold || 0} available</span></div>
        <div className="checkout-gold-controls"><div className="checkout-input"><input id="checkout-gold" inputMode="numeric" value={value} disabled={disabled || !eligible} onChange={event=>setValue(event.target.value.replace(/[^0-9]/g, ""))} aria-invalid={!valid} aria-describedby="checkout-gold-help" /></div><button type="button" disabled={disabled || !eligible} onClick={()=>setValue(String(maximum))}>Max</button><button type="submit" disabled={disabled || !valid || Number(value) === summary.goldRedeemed}>Apply</button></div>
        <div className="checkout-gold-applied"><span>{summary.goldRedeemed || 0} gold applied</span><strong>−{formatPrice ? formatPrice(summary.goldDiscountCents) : money(summary.goldDiscountCents, summary.currency)}</strong></div>
        <p id="checkout-gold-help" aria-live="polite" className={valid ? undefined : "checkout-gold-error"}>{warning || "Minimum redemption: 100 Gold. Enter 0 to remove. Gold is spent only after payment succeeds."}</p>
    </form>;
}
