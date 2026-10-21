import { useEffect, useRef, useState } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import CheckoutPaymentForm from './CheckoutPaymentForm';
import CheckoutSecurity from './CheckoutSecurity';
import { PaymentFormSkeleton } from './CheckoutSkeleton';
import { getStoredUser } from '../utils/authSession';
import '../styles/Checkout.css';
import '../styles/WalletTopUpCheckout.css';

const publishableKey = import.meta.env.STRIPE_PUBLISHABLE_KEY?.trim();
const stripePromise = /^pk_(test|live)_\S+$/.test(publishableKey || '') ? loadStripe(publishableKey) : null;
const appearance = { theme: 'night', variables: { colorPrimary: '#a855f7', colorBackground: '#111827', colorText: '#e5e7eb', colorDanger: '#fb7185', borderRadius: '10px', fontFamily: 'Arial, sans-serif' } };
const money = cents => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);

export default function WalletTopUpCheckout({ offer, checkout, busy, error, onClose, onRetry, onBusyChange, onBeforeConfirm, onDefinitiveFailure, onSuccess }) {
    const [email, setEmail] = useState(() => getStoredUser()?.email || '');
    const heading = useRef(null);
    useEffect(() => {
        window.scrollTo({ top: 0, behavior: 'instant' });
        heading.current?.focus({ preventScroll: true });
    }, []);
    const summary = checkout?.summary || offer;
    return <div className="wallet-topup-checkout checkout-container">
        <header className="wallet-payment-heading"><div><p>FastBoost Wallet</p><h1 ref={heading} tabIndex={-1}>Top up your wallet</h1></div><button type="button" className="wallet-payment-back" disabled={busy} onClick={onClose}>← Back to wallet</button></header>
        <div className="checkout-grid">
            <section className="checkout-card checkout-payment" aria-label="Top up payment method"><h2>Payment Method</h2>
                {error ? <div role="alert" className="wallet-payment-error"><p>{error}</p><button type="button" className="wallet-primary" disabled={busy} onClick={onRetry}>Try again</button></div> : checkout && stripePromise ? <CheckoutPaymentForm key={checkout.sessionId} email={email} onEmailChange={setEmail} sessionId={checkout.sessionId} clientSecret={checkout.clientSecret} appearance={appearance} stripePromise={stripePromise} paymentBlocked={busy} onBusyChange={onBusyChange} onSuccess={onSuccess} onBeforeConfirm={onBeforeConfirm} onDefinitiveFailure={onDefinitiveFailure} allowAdaptivePricing={false} contactHelp="We’ll use this email for your wallet top up." agreementAction="topping up your wallet" /> : busy ? <PaymentFormSkeleton /> : <p role="alert" className="checkout-error">Secure payment is unavailable. Please try again in a moment.</p>}
            </section>
            <aside className="checkout-card checkout-summary wallet-package-summary" aria-label="Top up package summary"><h2>Package Summary</h2>
                <div className="wallet-payment-package"><span>Wallet credit</span><strong>{money(summary.creditCents)}</strong><p>{summary.bonusPercent}% bonus included</p></div>
                <dl><div><dt>Top up amount</dt><dd>{money(summary.amountCents)}</dd></div><div><dt>Bonus credit · {summary.bonusPercent}%</dt><dd className="wallet-payment-bonus">+{money(summary.bonusCents)}</dd></div><div className="wallet-payment-credit"><dt>You get</dt><dd>{money(summary.creditCents)}</dd></div></dl>
                <div className="wallet-payment-total"><strong>Total</strong><strong>{money(summary.amountCents)}</strong></div>
                <CheckoutSecurity />
            </aside>
        </div>
    </div>;
}
