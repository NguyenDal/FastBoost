import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CheckoutElementsProvider, CurrencySelectorElement, ExpressCheckoutElement, useCheckoutElements } from '@stripe/react-stripe-js/checkout';

const hasMethods = methods => Boolean(methods && Object.values(methods).some(value => value === true || value?.available === true));

function SessionControls({ sessionId, onStateChange, onReady, onConfirm, showExpressCheckout }) {
    const state = useCheckoutElements();
    const [currencyStatus, setCurrencyStatus] = useState('loading');
    const [availability, setAvailability] = useState(null);
    const [expressError, setExpressError] = useState(false);
    const hasCurrencies = state.type === 'success' && Boolean(state.checkout.currencyOptions?.length);
    const currencySelectorStatus = hasCurrencies ? currencyStatus : 'not-needed';
    useEffect(() => {
        onStateChange({ sessionId, state: expressError ? { type: 'error' } : state, currencySelectorStatus });
    }, [sessionId, state, expressError, currencySelectorStatus, onStateChange]);
    useEffect(() => {
        if (state.type === 'success' && state.checkout.id === sessionId && !expressError
            && (!hasCurrencies || currencyStatus === 'ready') && (!showExpressCheckout || availability !== null)) {
            onReady({ sessionId, wallets: showExpressCheckout && availability });
        }
    }, [sessionId, state, expressError, hasCurrencies, currencyStatus, showExpressCheckout, availability, onReady]);
    return state.type === 'success' && <>
        {hasCurrencies && <div className="checkout-currency-selector">
            <h3>Payment currency</h3>
            <CurrencySelectorElement onReady={() => setCurrencyStatus('ready')} onLoaderStart={() => setCurrencyStatus('loading')} onLoadError={() => setCurrencyStatus('error')} />
        </div>}
        {showExpressCheckout && <div className={`checkout-wallet-slot${availability === false ? ' is-empty' : ''}`} inert={hasCurrencies && currencyStatus !== 'ready'}>
            <ExpressCheckoutElement options={{ paymentMethods: { applePay: 'always' }, buttonTheme: { applePay: 'black' }, paymentMethodOrder: ['apple_pay', 'link'] }}
                onConfirm={event => onConfirm({ sessionId, event })}
                onReady={({ availablePaymentMethods }) => { if (!hasMethods(availablePaymentMethods)) setAvailability(false); }}
                onAvailablePaymentMethodsChange={({ paymentMethods }) => setAvailability(hasMethods(paymentMethods))}
                onLoadError={() => setExpressError(true)} />
        </div>}
    </>;
}

// Replacing a financial quote still replaces its Stripe session. Keep the last
// ready frame mounted until its replacement has actual payment buttons, without
// giving the retired session an opportunity to confirm or update current state.
export default function CheckoutSessionTransition({ sessionId, clientSecret, stripePromise, appearance, allowAdaptivePricing,
    blocked, showExpressCheckout, onStateChange, onWalletsChange, onConfirm }) {
    const [visible, setVisible] = useState(() => ({ sessionId, clientSecret, allowAdaptivePricing }));
    const [visibleWallets, setVisibleWallets] = useState(null);
    const target = useRef(null);
    const displayedId = useRef(null);
    useLayoutEffect(() => {
        target.current = { sessionId, clientSecret, allowAdaptivePricing, blocked };
        return () => { target.current = null; };
    }, [sessionId, clientSecret, allowAdaptivePricing, blocked]);
    const handleState = useCallback(next => {
        if (next.sessionId !== target.current?.sessionId || (next.state.type === 'success' && next.state.checkout.id !== next.sessionId)) return;
        onStateChange(next);
    }, [onStateChange]);
    const handleReady = useCallback(next => {
        const current = target.current;
        if (next.sessionId !== current?.sessionId) return;
        displayedId.current = next.sessionId;
        setVisible(previous => previous.sessionId === current.sessionId ? previous : {
            sessionId: current.sessionId, clientSecret: current.clientSecret, allowAdaptivePricing: current.allowAdaptivePricing,
        });
        setVisibleWallets(next.wallets);
        onWalletsChange(next.wallets);
    }, [onWalletsChange]);
    const handleConfirm = useCallback(({ sessionId: sourceId, event }) => {
        if (sourceId !== target.current?.sessionId || sourceId !== displayedId.current || target.current.blocked) return;
        onConfirm(event);
    }, [onConfirm]);
    const current = { sessionId, clientSecret, allowAdaptivePricing };
    const layers = visible.sessionId === sessionId ? [current] : [visible, current];
    return <div className={`checkout-session-transition${showExpressCheckout && visibleWallets !== false ? ' has-wallet-slot' : ''}`}>
        {layers.map(layer => {
            const shown = layer.sessionId === visible.sessionId;
            const retired = layer.sessionId !== sessionId;
            return <div key={layer.sessionId} className={`checkout-session-layer${shown ? '' : ' is-preparing'}`} inert={blocked || retired || !shown} aria-hidden={retired || !shown || undefined}>
                <CheckoutElementsProvider stripe={stripePromise} options={{ clientSecret: layer.clientSecret, adaptivePricing: { allowed: layer.allowAdaptivePricing }, elementsOptions: { appearance } }}>
                    <SessionControls sessionId={layer.sessionId} onStateChange={handleState} onReady={handleReady} onConfirm={handleConfirm} showExpressCheckout={showExpressCheckout} />
                </CheckoutElementsProvider>
            </div>;
        })}
    </div>;
}
