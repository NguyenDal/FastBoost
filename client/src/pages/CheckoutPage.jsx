import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { loadStripe } from "@stripe/stripe-js";
import { CheckoutElementsProvider } from "@stripe/react-stripe-js/checkout";
import CheckoutPaymentForm from "../components/CheckoutPaymentForm";
import PaymentErrorDialog from "../components/PaymentErrorDialog";
import { paymentErrorMessage } from "../utils/paymentError";
import PaymentResultPage from "./PaymentResultPage";
import Navbar from "../components/Navbar";
import CleanIcon from "../components/CleanIcon";
import { createCheckoutSession, verifyCheckoutSession } from "../api/orders";
import "../styles/Checkout.css";

const publishableKey = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;
const stripePromise = publishableKey ? loadStripe(publishableKey) : null;
const appearance = {
    theme: "night",
    variables: { colorPrimary: "#a855f7", colorBackground: "#111827", colorText: "#e5e7eb", colorDanger: "#fb7185", borderRadius: "10px", fontFamily: "Arial, sans-serif" },
};
const money = (cents, currency) => new Intl.NumberFormat("en-CA", { style: "currency", currency: currency.toUpperCase(), currencyDisplay: "symbol" }).format(cents / 100);

export default function CheckoutPage() {
    const { orderId } = useParams();
    const [params, setParams] = useSearchParams();
    const navigate = useNavigate();
    const [data, setData] = useState(null);
    const [error, setError] = useState("");
    const [paid, setPaid] = useState(false);
    const [verification, setVerification] = useState(null);
    const [celebratePaid, setCelebratePaid] = useState(false);
    const markPaid = useCallback(() => setPaid(true), []);
    const completeConfirmation = useCallback(() => {
        setVerification(null);
        setCelebratePaid(true);
        window.scrollTo({ top: 0, behavior: "instant" });
    }, []);
    const showPaid = paid && !verification;
    const [attempt, setAttempt] = useState(0);
    const [paymentBusy, setPaymentBusy] = useState(false);
    const [goldConfirmation, setGoldConfirmation] = useState(null);
    const [goldError, setGoldError] = useState("");
    const request = useRef(null);
    const gold = Math.max(0, Math.floor(Number(params.get("gold")) || 0));

    useEffect(() => {
        let cancelled = false;
        const key = `${orderId}:${gold}:${attempt}`;
        if (request.current?.key !== key) request.current = { key, promise: createCheckoutSession(orderId, gold) };
        request.current.promise.then(async (result) => {
            if (cancelled) return;
            if (result.paid) {
                setData(result);
                setPaid(true);
                if (params.get("session_id")) setVerification({ orderId: result.orderId });
            } else if (result.paidWithGoldOnly) {
                setVerification({ orderId: result.orderId, gold: "1" });
            } else if (result.completed) {
                setData(result);
                setVerification({ session_id: result.sessionId });
            } else if (result.goldOnlyReady) {
                const cardCheckout = await createCheckoutSession(orderId, 0);
                if (cancelled) return;
                if (!cardCheckout.clientSecret) throw new Error("Unable to load card payment.");
                setData(cardCheckout);
                setGoldConfirmation(result.summary.goldRedeemed);
            } else if (result.clientSecret) {
                setData(result);
            } else setError("Unable to start payment. Please try again.");
        }).catch(async (failure) => {
            if (cancelled) return;
            // Older running servers return an error for an already-paid order.
            // Verify ownership/payment status before presenting the paid screen.
            if (/already (?:been )?paid/i.test(failure.message || "")) {
                try {
                    const order = await verifyCheckoutSession({ orderId });
                    if (cancelled) return;
                    if (order.paid) {
                        setError("");
                        setPaid(true);
                        return;
                    }
                } catch {
                    // Keep the original failure if verification is unavailable.
                }
            }
            if (!cancelled) setError(failure.message || "Unable to load checkout.");
        });
        return () => { cancelled = true; };
    }, [orderId, gold, attempt, params]);

    const applyGold = value => {
        if (paymentBusy) return;
        if (data && value * 10 >= data.summary.totalCents + data.summary.goldDiscountCents) {
            setGoldError("");
            setGoldConfirmation(value);
            return;
        }
        setData(null);
        setError("");
        setParams({ gold: String(value) }, { replace: true });
        setAttempt(value => value + 1);
    };
    const payWithGold = async () => {
        if (paymentBusy || goldConfirmation === null) return;
        setGoldError("");
        setPaymentBusy(true);
        try {
            const result = await createCheckoutSession(orderId, goldConfirmation, false);
            if (result.paidWithGoldOnly) {
                setGoldConfirmation(null);
                setVerification({ orderId: result.orderId, gold: "1" });
            } else if (result.clientSecret) { setData(result); setGoldConfirmation(null); }
            else throw new Error("Your balance changed. Please review your payment again.");
        } catch (failure) { setGoldConfirmation(null); setGoldError(paymentErrorMessage(failure)); }
        finally { setPaymentBusy(false); }
    };

    return <div className={"checkout-shell checkout-" + (data?.summary.game || "lol")}>
        <Navbar />
        <main className="checkout-container">
            <h1>Secure Payment</h1>
            <ol className={`checkout-steps${celebratePaid ? " checkout-steps-completing" : ""}`} aria-label="Order progress">
                <li className="done"><span>✓</span><strong>Order Details</strong><small>Completed</small></li>
                <li className={showPaid ? "done active" : "active"} aria-current={showPaid ? undefined : "step"}><span>{showPaid ? "✓" : "2"}</span><strong>Payment</strong><small>{showPaid ? "Completed" : "Complete your payment"}</small></li>
                <li className={showPaid ? "active" : undefined} aria-current={showPaid ? "step" : undefined}><span>3</span><strong>Boost Begins</strong><small>{showPaid ? "Ready to start" : "After payment"}</small></li>
            </ol>
            {showPaid ? <section className={`checkout-card${celebratePaid ? " checkout-paid-reveal" : ""}`} aria-live="polite"><p>{celebratePaid ? "Your order has been paid. Your boost is ready to begin." : "This order has already been paid."}</p><button className="checkout-pay" onClick={() => navigate(`/match/${orderId}`)}>Go to Order</button></section> : error ? <section className="checkout-card"><button className="checkout-pay" onClick={() => { setError(""); setAttempt(value => value + 1); }}>Try again</button></section> : !data ? <section className="checkout-card" role="status">Preparing your secure checkout…</section> :
                <div className="checkout-grid">
                    <section className="checkout-card checkout-payment">
                        <h2>Payment Method</h2>
                        {paid ? <><p>This order has already been paid.</p><button className="checkout-pay" onClick={() => navigate(`/match/${orderId}`)}>Go to Order</button></> : data.clientSecret && stripePromise ? <CheckoutElementsProvider key={data.sessionId} stripe={stripePromise} options={{ clientSecret: data.clientSecret, elementsOptions: { appearance } }}>
                            <CheckoutPaymentForm summary={data.summary} sessionId={data.sessionId} stripePromise={stripePromise} onBusyChange={setPaymentBusy} onSuccess={setVerification} />
                        </CheckoutElementsProvider> : <p role="alert">Payment is temporarily unavailable. Please contact support.</p>}
                    </section>
                    <OrderSummary summary={data.summary} onApplyGold={applyGold} paymentBusy={paymentBusy || paid || Boolean(verification)} paid={paid} />
                </div>}
        </main>
        {verification && <PaymentResultPage type="success" overlayOnly verification={verification} onVerified={markPaid} onComplete={completeConfirmation} />}
        {error && !paid && <PaymentErrorDialog message="We couldn’t load checkout. Please try again. If this continues, contact support." action="Retry Checkout" onClose={() => { setError(""); setAttempt(value => value + 1); }} />}
        {goldError && <PaymentErrorDialog message={goldError} onClose={() => setGoldError("")} />}
        {goldConfirmation !== null && <GoldConfirmation gold={goldConfirmation} busy={paymentBusy} onConfirm={payWithGold} onBack={() => { if (!paymentBusy) setGoldConfirmation(null); }} />}
    </div>;
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
        <button className="checkout-pay" disabled={busy || closing} onClick={onConfirm}>{busy ? "Processing…" : `Pay with ${gold} gold`}</button>
        <button className="checkout-gold-back" autoFocus disabled={busy || closing} onClick={() => setClosing(true)}>Back to card payment</button>
    </dialog>;
}

function OrderSummary({ summary, onApplyGold, paymentBusy, paid }) {
    const [promoCode, setPromoCode] = useState("");
    const [promoSubmitted, setPromoSubmitted] = useState(false);
    const enteredCode = promoCode.trim();
    const price = value => money(value, summary.currency);
    return <aside className="checkout-card checkout-summary">
        <div className="checkout-summary-heading"><h2>Order Summary</h2><Link to={"/order/" + summary.serviceId}>Edit Order</Link></div>
        <div className="checkout-game"><CleanIcon src={"https://fastboost-assets.s3.amazonaws.com/logos/" + (summary.game === "tft" ? "tft-logo.png" : "lol-logo.jpg")} alt="" /><div><strong>{summary.game === "tft" ? "Teamfight Tactics" : "League of Legends"}</strong><p>{summary.title}</p></div></div>
        <dl className="checkout-order-details">
            {[["Current Rank", summary.currentRank], ["Target Rank", summary.targetRank], ["Queue Type", summary.queueType], ["Server / Region", summary.region]].filter(([, value]) => value).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
        </dl>
        {!paid && <GoldRedemption key={summary.goldRedeemed} summary={summary} onApply={onApplyGold} disabled={paymentBusy} />}
        <form className="checkout-promo" onSubmit={event => { event.preventDefault(); if (enteredCode && !paymentBusy) setPromoSubmitted(true); }}>
            <label className="checkout-field-label" htmlFor="checkout-promo-code">Promo code</label>
            <div className="checkout-promo-controls"><div className="checkout-input"><input id="checkout-promo-code" placeholder="Enter your discount code" autoComplete="off" spellCheck={false} maxLength={64} value={promoCode} disabled={paymentBusy} onChange={event => { setPromoCode(event.target.value); setPromoSubmitted(false); }} aria-describedby="checkout-promo-help" /></div><button type="submit" disabled={!enteredCode || paymentBusy}>Apply</button></div>
            <p id="checkout-promo-help" role="status">{promoSubmitted ? "Promo codes aren't available yet. Your total hasn't changed." : "Promo codes are coming soon. No discount has been applied."}</p>
        </form>
        <dl className="checkout-totals">
            <div><dt>Base Price</dt><dd>{price(summary.basePriceCents)}</dd></div>
            {summary.addonPriceCents > 0 && <div><dt>Add-ons</dt><dd>{price(summary.addonPriceCents)}</dd></div>}
            {[["Sale Discount", summary.saleDiscountCents], ["Referral Discount", summary.referralDiscountCents], ["Gold Discount", summary.goldDiscountCents]].filter(([, value]) => value > 0).map(([label, value]) => <div className="checkout-discount" key={label}><dt>{label}</dt><dd>−{price(value)}</dd></div>)}
            {summary.promoDiscount?.title && summary.promoDiscount.amountCents > 0 && <div className="checkout-discount"><dt>{summary.promoDiscount.title}</dt><dd>−{price(summary.promoDiscount.amountCents)}</dd></div>}
            <div className="checkout-total"><dt>Total</dt><dd>{price(summary.totalCents)}</dd></div>
        </dl>
        <div className="checkout-security"><strong>Secure Payment</strong><p>Powered by Stripe. FastBoost does not receive or store your full card details.</p><p><a href="https://stripe.com/legal/consumer" target="_blank" rel="noreferrer">Stripe Terms</a> · <a href="https://stripe.com/privacy" target="_blank" rel="noreferrer">Privacy Policy</a></p></div>
    </aside>;
}

function GoldRedemption({ summary, onApply, disabled }) {
    const [value, setValue] = useState(String(summary.goldRedeemed || 0));
    const available = Math.max(0, summary.availableGold || 0);
    const orderMaximum = Math.max(0, Math.floor((summary.totalCents + summary.goldDiscountCents) / 10));
    const maximum = Math.min(available, orderMaximum);
    const warning = !/^\d+$/.test(value.trim())
        ? "Please enter a whole number of gold."
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
        <div className="checkout-gold-controls"><div className="checkout-input"><input id="checkout-gold" inputMode="numeric" value={value} disabled={disabled} onChange={event=>setValue(event.target.value.replace(/[^0-9]/g, ""))} aria-invalid={!valid} aria-describedby="checkout-gold-help" /></div><button type="button" disabled={disabled} onClick={()=>setValue(String(maximum))}>Max</button><button type="submit" disabled={disabled || !valid || Number(value) === summary.goldRedeemed}>Apply</button></div>
        <div className="checkout-gold-applied"><span>{summary.goldRedeemed || 0} gold applied</span><strong>−{money(summary.goldDiscountCents, summary.currency)}</strong></div>
        <p id="checkout-gold-help" aria-live="polite" className={valid ? undefined : "checkout-gold-error"}>{warning || "Gold is spent only after payment succeeds."}</p>
    </form>;
}


