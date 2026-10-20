import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { createWalletTopUp, getWallet, verifyWalletTopUp } from '../api/wallet';
import { pollWalletTopUp, walletCheckoutUrl, walletMoney, walletReturnPath } from '../utils/wallet';
import LegalAgreement from '../components/LegalAgreement';
import '../styles/Wallet.css';

const returnStorageKey = 'fastboost:wallet-checkout-return';

export default function WalletPage() {
    const [params, setParams] = useSearchParams();
    const [wallet, setWallet] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [selectedId, setSelectedId] = useState('usd-25');
    const [busy, setBusy] = useState(false);
    const submitting = useRef(false);
    const active = useRef(true);
    const [reload, setReload] = useState(0);
    const [verification, setVerification] = useState({ status: '', message: '' });
    const [verifyAttempt, setVerifyAttempt] = useState(0);
    const sessionId = params.get('wallet_session_id');
    const [returnTo] = useState(() => {
        const fromQuery = walletReturnPath(params.get('returnTo'));
        try { return fromQuery || walletReturnPath(sessionStorage.getItem(returnStorageKey)); }
        catch { return fromQuery; }
    });
    useEffect(() => {
        active.current = true;
        return () => { active.current = false; };
    }, []);
    useEffect(() => {
        if (!returnTo) return;
        try { sessionStorage.setItem(returnStorageKey, returnTo); } catch { /* Checkout navigation remains available for this visit. */ }
    }, [returnTo]);
    useEffect(() => {
        let cancelled = false;
        const controller = new AbortController();
        setLoading(true);
        getWallet({ signal: controller.signal }).then(data => {
            if (!cancelled) { setWallet(data); setError(''); }
        }).catch(() => {
            if (!cancelled) setError('We couldn’t load your wallet. Try again in a moment.');
        }).finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; controller.abort(); };
    }, [reload, sessionId]);
    useEffect(() => {
        const refresh = () => { if (!document.hidden && !submitting.current) setReload(value => value + 1); };
        window.addEventListener('focus', refresh);
        return () => window.removeEventListener('focus', refresh);
    }, []);
    useEffect(() => {
        if (!sessionId) return;
        let cancelled = false;
        const controller = new AbortController();
        setVerification({ status: 'checking', message: 'Confirming your top up. Your balance updates after payment is verified.' });
        pollWalletTopUp({ sessionId, verify: query => verifyWalletTopUp({ ...query, signal: controller.signal }), isCancelled: () => cancelled }).then(result => {
            if (!result || cancelled) return;
            if (Array.isArray(result.packages) && Number.isSafeInteger(result.balanceCents)) setWallet(result);
            if (result.paid === true && result.status === 'paid') {
                setVerification({ status: 'paid', message: 'Top up complete. Your wallet is ready to use.' });
                setParams(previous => { const next = new URLSearchParams(previous); next.delete('wallet_session_id'); next.delete('wallet_cancelled'); return next; }, { replace: true });
                window.dispatchEvent(new Event('wallet:updated'));
            } else if (result.status === 'expired') setVerification({ status: 'expired', message: 'This top up expired. No credit was added. Choose a package to try again.' });
            else if (result.status === 'reversed') setVerification({ status: 'reversed', message: 'This top up was reversed. Your wallet shows the latest balance.' });
            else setVerification({ status: 'pending', message: 'Your top up is still awaiting confirmation. Check this payment again before starting another top up.' });
        }).catch(() => {
            if (!cancelled) setVerification({ status: 'pending', message: 'We couldn’t confirm this top up yet. Check this payment again before starting another top up.' });
        });
        return () => { cancelled = true; controller.abort(); };
    }, [sessionId, verifyAttempt, setParams]);

    const selected = wallet?.packages?.find(item => item.id === selectedId);
    const confirming = ['checking', 'pending'].includes(verification.status);
    const topUp = async () => {
        if (!selected || submitting.current || wallet?.frozen || confirming) return;
        submitting.current = true;
        setBusy(true);
        setError('');
        try {
            const result = await createWalletTopUp(selected.id);
            if (!active.current) return;
            // Retrying can recover a previously paid checkout. Verify its saved
            // session before showing success, including a reversed payment.
            if (result.paid === true || result.status === 'reversed' || !result.url) {
                if (typeof result.sessionId !== 'string' || !/^cs_[A-Za-z0-9_]+$/.test(result.sessionId)) throw new Error('Payment status needs review.');
                setVerification({ status: 'checking', message: 'Checking the existing top up before continuing.' });
                setParams(previous => { const next = new URLSearchParams(previous); next.set('wallet_session_id', result.sessionId); next.delete('wallet_cancelled'); return next; }, { replace: true });
                setVerifyAttempt(value => value + 1);
                setBusy(false);
                submitting.current = false;
                return;
            }
            const url = walletCheckoutUrl(result.url);
            if (!url) throw new Error('Unable to open secure checkout.');
            window.location.assign(url);
        } catch {
            if (active.current) { setError('We couldn’t open secure checkout. Refresh your wallet or retry this package to check the existing top up before paying again.'); setBusy(false); }
            submitting.current = false;
        }
    };
    const transactions = wallet?.transactions || [];

    return <div className="wallet-page">
        <div className="wallet-page-heading"><div><p className="wallet-eyebrow">Your account</p><h1>Wallet</h1><p>Top up once. Pay for your next boost in seconds.</p></div><Link to={returnTo || '/account/dashboard'} className="wallet-secondary-link">{returnTo ? 'Back to checkout' : 'Back to dashboard'} <span aria-hidden="true">↗</span></Link></div>
        <section className="wallet-balance-card" aria-label="Wallet balance">
            <div><p className="wallet-eyebrow">Available balance · USD</p><strong className="wallet-total" aria-live="polite">{wallet ? walletMoney(wallet.balanceCents) : loading ? '…' : 'Unavailable'}</strong><p>Use your balance at checkout to pay for an order in full.</p></div><span className="wallet-balance-icon" aria-hidden="true">▣</span>
            {wallet && <div className="wallet-balance-breakdown"><span>Purchased credit <strong>{walletMoney(wallet.purchasedBalanceCents)}</strong></span><span>Bonus credit <strong>{walletMoney(wallet.promotionalBalanceCents)}</strong></span></div>}
        </section>
        {wallet?.frozen && <div className="wallet-notice wallet-notice-error" role="alert">Your wallet is temporarily restricted. Please contact support before topping up or paying.</div>}
        {verification.message && <div className={`wallet-notice${verification.status === 'paid' ? ' wallet-notice-success' : ''}`} role="status"><p>{verification.message}</p>{verification.status === 'pending' && <button type="button" onClick={() => setVerifyAttempt(value => value + 1)}>Check payment again</button>}</div>}
        {params.get('wallet_cancelled') && !sessionId && <div className="wallet-notice" role="status">You returned from checkout. No credit is added until payment is confirmed.</div>}
        {error && <div className="wallet-notice wallet-notice-error" role="alert"><p>{error}</p>{!wallet && <button type="button" disabled={loading} onClick={() => setReload(value => value + 1)}>Retry loading wallet</button>}</div>}
        <section className="wallet-section" aria-labelledby="wallet-packages-title">
            <div className="wallet-section-heading"><div><h2 id="wallet-packages-title">Give your balance a boost</h2><p>Every package includes extra wallet credit.</p></div><span className="wallet-usd-note">All amounts in USD</span></div>
            <fieldset className="wallet-package-grid" disabled={loading || busy || confirming || wallet?.frozen}><legend className="wallet-sr-only">Choose a top up package</legend>{wallet?.packages?.map(item => <label key={item.id} className={`wallet-package${selectedId === item.id ? ' is-selected' : ''}`}>
                <input type="radio" name="wallet-package" value={item.id} checked={selectedId === item.id} onChange={() => setSelectedId(item.id)} />
                <span className="wallet-package-bonus">+{item.bonusPercent}% bonus</span><strong className="wallet-package-price">{walletMoney(item.amountCents)}</strong><span className="wallet-package-credit">Receive <b>{walletMoney(item.creditCents)}</b></span><small>Includes {walletMoney(item.bonusCents)} extra</small>
            </label>)}</fieldset>
            {loading && !wallet && <p role="status">Loading your top up options…</p>}
            <div className="wallet-topup-footer"><div>{selected && <p>Pay <strong>{walletMoney(selected.amountCents)}</strong> · Receive <strong>{walletMoney(selected.creditCents)}</strong></p>}<small>Use purchased and bonus credit to pay for FastBoost orders.</small></div><button className="wallet-primary" type="button" disabled={!selected || busy || loading || confirming || wallet?.frozen} onClick={topUp}>{busy ? 'Opening secure checkout…' : selected ? `Top up ${walletMoney(selected.amountCents)}` : 'Choose a package'} <span aria-hidden="true">→</span></button></div>
            <p className="wallet-agreement"><LegalAgreement action="topping up your wallet" /> Payments are securely processed by Stripe.</p>
        </section>
        <section className="wallet-section" aria-labelledby="wallet-history-title"><div className="wallet-section-heading"><div><h2 id="wallet-history-title">Recent activity</h2><p>Your top ups, bonuses and order payments.</p></div><button className="wallet-refresh" type="button" disabled={loading || busy} onClick={() => setReload(value => value + 1)}>{loading ? 'Refreshing…' : 'Refresh'}</button></div>
            {transactions.length ? <ol className="wallet-history">{transactions.map(item => <li key={item.id}><span className={`wallet-history-icon${item.amountCents < 0 ? ' is-payment' : ''}`} aria-hidden="true">{item.amountCents < 0 ? '↗' : '+'}</span><div><strong>{item.description || (item.amountCents < 0 ? 'Order payment' : 'Wallet top up')}</strong><span>{new Date(item.createdAt).toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' })}{item.orderId && <> · <Link to={`/match/${encodeURIComponent(item.orderId)}`}>View order</Link></>}</span></div><strong className={item.amountCents > 0 ? 'wallet-history-credit' : ''}>{item.amountCents > 0 ? '+' : ''}{walletMoney(item.amountCents)}</strong></li>)}</ol> : <div className="wallet-empty"><span aria-hidden="true">↗</span><strong>{loading ? 'Loading activity…' : 'Your wallet starts here'}</strong><p>Completed top ups and wallet payments will appear here.</p></div>}
        </section>
    </div>;
}
