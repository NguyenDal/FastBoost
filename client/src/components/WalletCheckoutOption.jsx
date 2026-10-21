import { useState } from 'react';
import { Link } from 'react-router-dom';
import { walletMoney } from '../utils/wallet';
import { walletCheckoutAmounts, walletInputCents } from '../utils/walletCheckout';

export default function WalletCheckoutOption({ wallet, loading, applying = false, summary, orderId, busy, onRetry, onApply, onMax }) {
    const { applied, unreservedAvailable, maximum, order, usable } = walletCheckoutAmounts(wallet, summary);
    const [value, setValue] = useState((applied / 100).toFixed(2));
    const amount = walletInputCents(value);
    const error = amount === null ? 'Enter an amount with up to two decimal places.'
        : amount > maximum ? `You can use up to ${walletMoney(maximum)}.`
        : order - amount > 0 && order - amount < 50 ? 'Leave at least US$0.50 for card payment, or use your wallet for the full total.' : '';
    const unavailable = !loading && !wallet;
    const help = wallet?.frozen ? 'Your wallet is temporarily restricted. Contact support.'
        : wallet && String(summary?.currency).toLowerCase() !== 'usd' ? 'Wallet payments are available for USD orders.'
        : unavailable ? 'We couldn’t load your wallet. You can still pay by card.' : '';
    return <div className="checkout-account-wallet">
        <div className="checkout-account-wallet-heading"><span className="checkout-account-wallet-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M20 7V5a2 2 0 0 0-2-2H6a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3h14a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1H6a1 1 0 0 1 0-2h12"/><path d="M21 12h-5a2 2 0 0 0 0 4h5"/><circle cx="16" cy="14" r=".5"/></svg></span><div><strong>FastBoost Wallet</strong><span className="checkout-wallet-available" aria-live="polite">{loading ? 'Loading balance…' : unreservedAvailable !== null ? `${walletMoney(unreservedAvailable)} available` : 'Balance unavailable'}</span></div><Link to={`/account/wallet?returnTo=${encodeURIComponent(`/checkout/${orderId}`)}`} aria-label="Top up your wallet and return to checkout" tabIndex={busy ? -1 : undefined} onClick={event => { if (busy) event.preventDefault(); }}>Top up <span aria-hidden="true">↗</span></Link></div>
        {help && <p role="status">{help}</p>}
        {usable && <form className="checkout-wallet-amount" onSubmit={event => { event.preventDefault(); if (!busy && !loading && !error && amount !== applied) onApply(amount); }}>
            <label className="checkout-field-label" htmlFor="checkout-wallet-amount">Amount to use</label>
            <div className="checkout-wallet-controls"><div className="checkout-input"><span aria-hidden="true">$</span><input id="checkout-wallet-amount" inputMode="decimal" autoComplete="off" value={value} disabled={busy || loading} onChange={event => setValue(event.target.value)} aria-invalid={Boolean(error)} aria-describedby={error ? 'checkout-wallet-error' : undefined} /></div><button type="button" disabled={busy || loading || maximum === 0} onClick={() => { setValue((maximum / 100).toFixed(2)); if (maximum === order) onMax?.(maximum); }}>Max</button><button type="submit" disabled={busy || loading || Boolean(error) || amount === applied} aria-busy={applying || undefined} aria-label={applying ? 'Applying wallet balance' : undefined}>{applying ? <svg className="checkout-wallet-spinner" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><circle cx="12" cy="12" r="9" opacity=".25"/><path d="M12 3a9 9 0 0 1 9 9" strokeLinecap="round"/></svg> : 'Apply'}</button></div>
            {error && <p id="checkout-wallet-error" className="checkout-wallet-error" role="alert">{error}</p>}
        </form>}
        {unavailable && <button type="button" className="checkout-wallet-retry" disabled={busy} onClick={onRetry}>Refresh balance</button>}
    </div>;
}
