import { useEffect, useRef, useState } from "react";
import { ExpressCheckoutElement, useCheckoutElements } from "@stripe/react-stripe-js/checkout";
import { COUNTRIES } from "../utils/countries";
import PaymentErrorDialog from "./PaymentErrorDialog";
import { paymentErrorMessage } from "../utils/paymentError";

const fieldStyle = { base: { color: "#e5e7eb", fontFamily: "Arial, sans-serif", fontSize: "15px", "::placeholder": { color: "#8797b3" } }, invalid: { color: "#fda4af" } };
const options = { style: fieldStyle };

export function CheckoutIcon({ type }) {
    const paths = {
        mail: <><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 6 9 7 9-7"/></>,
        card: <><rect x="2" y="4" width="20" height="16" rx="3"/><path d="M2 9h20M6 15h4"/></>,
        calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 11h18"/></>,
        lock: <><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/></>,
        user: <><circle cx="12" cy="7" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/></>,
        globe: <><circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/></>,
        arrow: <path d="M4 12h16m-6-6 6 6-6 6"/>,
    };
    return <svg className="checkout-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[type]}</svg>;
}

export default function CheckoutPaymentForm({ summary, sessionId, stripePromise, onBusyChange, onSuccess }) {
    const state = useCheckoutElements();
    const cardFields = useRef(null);
    const numberNode = useRef(null);
    const expiryNode = useRef(null);
    const cvcNode = useRef(null);
    const [ready, setReady] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [wallets, setWallets] = useState(false);
    const [name, setName] = useState("");
    const [country, setCountry] = useState("");
    const submitting = useRef(false);
    useEffect(() => {
        if (state.type !== "success") return;
        let cancelled = false;
        let mounted = [];
        stripePromise.then(stripe => {
            if (cancelled || !stripe) return;
            const elements = stripe.elements();
            // Keep Link in Express Checkout only, without the inline Autofill badge.
            const number = elements.create("cardNumber", { ...options, disableLink: true });
            const expiry = elements.create("cardExpiry", options);
            const cvc = elements.create("cardCvc", options);
            mounted = [number, expiry, cvc];
            number.mount(numberNode.current);
            expiry.mount(expiryNode.current);
            cvc.mount(cvcNode.current);
            cardFields.current = { stripe, number };
            number.on("ready", () => { if (!cancelled) setReady(true); });
        }).catch(() => { if (!cancelled) setError("Unable to load secure card fields. Please reload checkout."); });
        return () => { cancelled = true; mounted.forEach(element => element.destroy()); cardFields.current = null; };
    }, [state.type, stripePromise]);
    const confirm = async (expressEvent) => {
        if (submitting.current || state.type !== "success" || !cardFields.current) return;
        submitting.current = true;
        setBusy(true);
        onBusyChange?.(true);
        setError("");
        try {
            let confirmation = { redirect: "if_required" };
            if (expressEvent) confirmation.expressCheckoutConfirmEvent = expressEvent;
            else {
                const billing = { name: name.trim(), email: summary.email, address: { country } };
                if (!billing.name || !country) throw Object.assign(new Error(), { code: "billing_required" });
                const result = await cardFields.current.stripe.createPaymentMethod({ type: "card", card: cardFields.current.number, billing_details: billing });
                if (result.error) throw result.error;
                // Billing details are already attached to this PaymentMethod. Stripe
                // rejects a separate billingAddress when confirming with its ID.
                confirmation = { ...confirmation, paymentMethod: result.paymentMethod.id };
            }
            const result = await state.checkout.confirm(confirmation);
            if (result.type === "error") setError(paymentErrorMessage(result.error));
            else onSuccess({ session_id: sessionId });
        } catch (failure) { setError(paymentErrorMessage(failure)); }
        finally { submitting.current = false; setBusy(false); onBusyChange?.(false); }
    };
    if (state.type === "loading") return <p role="status">Loading payment form…</p>;
    if (state.type === "error") return <PaymentErrorDialog message="We couldn’t load the payment form. Please reload checkout and try again." action="Reload Checkout" onClose={() => window.location.reload()} />;
    // Stripe requires reading and displaying its current total before confirmation.
    const total = state.checkout.total.total.amount;
    const termsUrl = import.meta.env.VITE_TERMS_URL;
    return <>
        <div id="checkout-express" className={wallets ? "checkout-express" : "checkout-express-empty"}>
            {wallets && <h3>Express Checkout</h3>}
            <ExpressCheckoutElement options={{ paymentMethods: { applePay: "always" }, buttonTheme: { applePay: "black" }, paymentMethodOrder: ["apple_pay", "link"] }} onConfirm={confirm} onReady={({ availablePaymentMethods }) => { setWallets(Boolean(availablePaymentMethods && Object.values(availablePaymentMethods).some(Boolean))); }} />
            {wallets && <p className="checkout-or">OR</p>}
        </div>
        <form noValidate onSubmit={event => { event.preventDefault(); confirm(); }}>
            <h3>Contact Information</h3>
            <p className="checkout-help">We’ll use this email to send your order confirmation.</p>
            <div className="checkout-input checkout-contact"><CheckoutIcon type="mail"/><span>{summary.email}</span></div>
            <h3>Card Information</h3>
            <label className="checkout-sr-only" htmlFor="checkout-card-number">Card number</label>
            <div className="checkout-input checkout-card-number"><CheckoutIcon type="card"/><div className="StripeElement" id="checkout-card-number" ref={numberNode}/><span className="checkout-networks" aria-label="Visa, Mastercard, American Express, Discover"><b className="network-visa">VISA</b><b className="network-mastercard" aria-label="Mastercard"><i/><i/></b><b className="network-amex">AMEX</b><b className="network-discover">DISCOVER</b></span></div>
            <div className="checkout-card-row">
                <div><label className="checkout-sr-only" htmlFor="checkout-card-expiry">Expiration date</label><div className="checkout-input"><CheckoutIcon type="calendar"/><div className="StripeElement" id="checkout-card-expiry" ref={expiryNode}/></div></div>
                <div><label className="checkout-sr-only" htmlFor="checkout-card-cvc">CVC</label><div className="checkout-input"><CheckoutIcon type="lock"/><div className="StripeElement" id="checkout-card-cvc" ref={cvcNode}/><CheckoutIcon type="card"/></div></div>
            </div>
            <label className="checkout-field-label" htmlFor="checkout-cardholder">Cardholder Name</label>
            <div className="checkout-input"><CheckoutIcon type="user"/><input id="checkout-cardholder" autoComplete="cc-name" placeholder="Full name on card" value={name} onChange={event=>setName(event.target.value)} required maxLength={150}/></div>
            <label className="checkout-field-label" htmlFor="checkout-country">Country / Region</label>
            <div className="checkout-input"><CheckoutIcon type="globe"/><select id="checkout-country" autoComplete="country" required value={country} onChange={event=>setCountry(event.target.value)}><option value="">Select country</option>{COUNTRIES.map(item=><option key={item.code} value={item.code}>{item.name}</option>)}</select></div>
            {error && <PaymentErrorDialog message={error} action={ready ? "Back to Payment" : "Reload Checkout"} onClose={() => { if (ready) setError(""); else window.location.reload(); }} />}
            <button className="checkout-pay" disabled={busy || !ready} type="submit"><CheckoutIcon type="lock"/><span>{busy ? "Processing…" : `Pay Securely — ${total}`}</span><CheckoutIcon type="arrow"/></button>
            <p className="checkout-agreement">By placing this order, {termsUrl ? <>you agree to our <a href={termsUrl} target="_blank" rel="noreferrer">Terms of Service</a> and </> : null}you confirm that all information provided is accurate.</p>
        </form>
    </>;
}


