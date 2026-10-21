import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { cancelWalletTopUp, createWalletTopUp, getWallet, verifyWalletTopUp } from '../api/wallet';
import { pollWalletTopUp, walletReturnPath } from '../utils/wallet';
import { getStoredUser } from '../utils/authSession';
import LegalAgreement from '../components/LegalAgreement';
import { Skeleton } from '../components/Skeleton';
import WalletTopUpCheckout from '../components/WalletTopUpCheckout';
import WalletActivity from '../components/WalletActivity';
import WalletTopUpResult from '../components/WalletTopUpResult';
import '../styles/Wallet.css';

const returnStorageKey = 'fastboost:wallet-checkout-return';
const moneyFormat = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const walletMoney = cents => moneyFormat.format(cents / 100);

function WalletIcon() {
    return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M20 8V6a2 2 0 0 0-2-2H6a3 3 0 0 0 0 6h14v10H6a3 3 0 0 1-3-3V7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /><path d="M20 12h-4a2 2 0 0 0 0 4h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /><circle cx="16.5" cy="14" r=".7" fill="currentColor" /></svg>;
}

function WalletActivitySkeleton() {
    return <div className="wallet-history-skeleton" role="status" aria-label="Loading wallet activity">{Array.from({ length: 3 }, (_, index) => <div className="wallet-history-skeleton-row" key={index}>
        <Skeleton width={36} height={36} radius={11} />
        <div><Skeleton width="70%" height={14} /><Skeleton width="42%" height={11} /></div>
        <Skeleton width={72} height={18} />
    </div>)}</div>;
}

function WalletSkeleton() {
    return <div className="wallet-page wallet-loading" role="status" aria-label="Loading wallet" aria-busy="true">
        <div className="wallet-page-heading" aria-hidden="true"><div className="wallet-heading-skeleton"><Skeleton width={110} height={11} /><Skeleton width={150} height={42} radius={8} /><Skeleton width="min(360px, 100%)" height={16} /></div><Skeleton width={166} height={43} radius={10} /></div>
        <section className="wallet-balance-card" aria-hidden="true"><div className="wallet-balance-skeleton"><Skeleton width={150} height={11} /><Skeleton width={195} height={55} radius={10} /></div><Skeleton width={66} height={66} radius={18} className="wallet-icon-skeleton" /></section>
        <section className="wallet-section" aria-hidden="true">
            <div className="wallet-section-heading"><Skeleton width="min(290px, 100%)" height={25} radius={6} /></div>
            <div className="wallet-package-grid">{Array.from({ length: 5 }, (_, index) => <div className="wallet-package wallet-package-skeleton" key={index}><Skeleton width="55%" height={12} /><Skeleton width="85%" height={36} radius={6} /><Skeleton width="95%" height={24} radius={6} /></div>)}</div>
            <div className="wallet-topup-footer"><Skeleton width={175} height={46} radius={10} /></div>
            <Skeleton width="90%" height={10} className="wallet-agreement" />
        </section>
        <section className="wallet-section" aria-hidden="true"><div className="wallet-section-heading"><Skeleton width={175} height={25} radius={6} /><Skeleton width={38} height={38} radius={9} /></div><WalletActivitySkeleton /></section>
    </div>;
}

export default function WalletPage() {
    const [params, setParams] = useSearchParams();
    const [wallet, setWallet] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [selectedId, setSelectedId] = useState(() => params.get('top_up') || 'usd-25');
    const [busy, setBusy] = useState(false);
    const requestedPackageId = params.get('top_up') || '';
    const checkoutOpen = Boolean(requestedPackageId);
    const autoPrepared = useRef('');
    const [checkout, setCheckout] = useState(null);
    const [checkoutOffer, setCheckoutOffer] = useState(null);
    const [checkoutError, setCheckoutError] = useState('');
    const [topUpResult, setTopUpResult] = useState(null);
    const cancellingSession = useRef('');
    const previousPackage = useRef(requestedPackageId);
    const abandonedPreparation = useRef(false);
    const submitting = useRef(false);
    const active = useRef(true);
    const walletReadVersion = useRef(0);
    const [reload, setReload] = useState(0);
    const [verification, setVerification] = useState({ status: '', message: '' });
    const [verifyAttempt, setVerifyAttempt] = useState(0);
    const [pendingStorageKey] = useState(() => `fastboost:wallet-topup-pending:${getStoredUser()?.id || 'account'}`);
    const [recoveredSessionId, setRecoveredSessionId] = useState(() => {
        try { const value = sessionStorage.getItem(pendingStorageKey); return /^cs_[A-Za-z0-9_]+$/.test(value || '') ? value : ''; }
        catch { return ''; }
    });
    const sessionId = params.get('wallet_session_id') || recoveredSessionId;
    const hasWallet = Boolean(wallet);
    const reservedBalanceCents = wallet?.reservedBalanceCents || 0;
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
        const version = ++walletReadVersion.current;
        setLoading(true);
        getWallet({ signal: controller.signal }).then(data => {
            if (!cancelled && version === walletReadVersion.current) { setWallet(data); setError(''); }
        }).catch(() => {
            if (!cancelled && version === walletReadVersion.current) setError('We couldn’t load your wallet. Try again in a moment.');
        }).finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; controller.abort(); };
    }, [reload, sessionId]);
    useEffect(() => {
        if (loading || busy || sessionId || checkoutOpen || ['checking', 'pending'].includes(verification.status)) return;
        let cancelled = false;
        let inFlight = false;
        let refreshPending = false;
        let controller;
        const refresh = async event => {
            if (document.hidden || submitting.current) return;
            if (inFlight) { if (event) refreshPending = true; return; }
            if (!hasWallet) { setReload(value => value + 1); return; }
            inFlight = true;
            controller = new AbortController();
            const version = ++walletReadVersion.current;
            try {
                const data = await getWallet({ signal: controller.signal });
                if (!cancelled && !submitting.current && version === walletReadVersion.current) { setWallet(data); setError(''); }
            } catch { /* Keep the last snapshot; focus or the next pending-hold poll retries quietly. */ }
            finally {
                inFlight = false;
                if (!cancelled && refreshPending) { refreshPending = false; void refresh(); }
            }
        };
        window.addEventListener('focus', refresh);
        window.addEventListener('wallet:updated', refresh);
        window.addEventListener('online', refresh);
        // A departure release can finish after the first wallet read, or its
        // keepalive response can disappear with the closed tab. Refresh only
        // while the server still reports reserved funds, without loading UI.
        const timer = reservedBalanceCents > 0 ? setInterval(refresh, 2000) : null;
        return () => {
            cancelled = true;
            controller?.abort();
            if (timer !== null) clearInterval(timer);
            window.removeEventListener('focus', refresh);
            window.removeEventListener('wallet:updated', refresh);
            window.removeEventListener('online', refresh);
        };
    }, [loading, busy, sessionId, checkoutOpen, verification.status, hasWallet, reservedBalanceCents]);
    useEffect(() => {
        if (!sessionId) return;
        let cancelled = false;
        const controller = new AbortController();
        setVerification({ status: 'checking', message: 'Confirming your top up. Your balance updates after payment is verified.' });
        pollWalletTopUp({ sessionId, verify: query => verifyWalletTopUp({ ...query, signal: controller.signal }), isCancelled: () => cancelled }).then(result => {
            if (!result || cancelled) return;
            if (Array.isArray(result.packages) && Number.isSafeInteger(result.balanceCents)) { walletReadVersion.current++; setWallet(result); }
            if (result.paid === true && result.status === 'paid') {
                try { if (sessionStorage.getItem(pendingStorageKey) === sessionId) sessionStorage.removeItem(pendingStorageKey); } catch { /* URL recovery remains available. */ }
                setRecoveredSessionId('');
                setCheckout(null);
                setTopUpResult({ status: 'paid', creditCents: checkoutOffer?.creditCents });
                cancellingSession.current = '';
                setVerification({ status: 'paid', message: '' });
                setParams(previous => { const next = new URLSearchParams(previous); next.delete('wallet_session_id'); next.delete('wallet_cancelled'); next.delete('top_up'); return next; }, { replace: true });
                window.dispatchEvent(new Event('wallet:updated'));
            } else if (['expired', 'reversed'].includes(result.status)) {
                try { if (sessionStorage.getItem(pendingStorageKey) === sessionId) sessionStorage.removeItem(pendingStorageKey); } catch { /* URL recovery remains available. */ }
                setRecoveredSessionId('');
                setCheckout(null);
                const wasCancelled = result.status === 'expired' && cancellingSession.current === sessionId;
                if (wasCancelled) setTopUpResult({ status: 'cancelled' });
                cancellingSession.current = '';
                setParams(previous => { const next = new URLSearchParams(previous); next.delete('wallet_session_id'); next.delete('top_up'); return next; }, { replace: true });
                setVerification({ status: result.status, message: wasCancelled ? '' : result.status === 'expired' ? 'This top up expired. No credit was added. Choose a package to try again.' : 'This top up was reversed. Your wallet shows the latest balance.' });
            }
            else setVerification({ status: 'pending', message: 'Your top up is still awaiting confirmation. Check this payment again before starting another top up.' });
        }).catch(() => {
            if (!cancelled) setVerification({ status: 'pending', message: 'We couldn’t confirm this top up yet. Check this payment again before starting another top up.' });
        });
        return () => { cancelled = true; controller.abort(); };
    }, [sessionId, verifyAttempt, setParams, pendingStorageKey, checkoutOffer]);

    const selected = wallet?.packages?.find(item => item.id === selectedId);
    const confirming = ['checking', 'pending'].includes(verification.status);
    const rememberSession = useCallback(id => { try { sessionStorage.setItem(pendingStorageKey, id); } catch { /* Stripe returns with the same session in the URL. */ } }, [pendingStorageKey]);
    const verifyPayment = useCallback(id => {
        rememberSession(id);
        setCheckout(null);
        setVerification({ status: 'checking', message: 'Confirming your top up. Your balance updates after payment is verified.' });
        setParams(previous => { const next = new URLSearchParams(previous); next.set('wallet_session_id', id); next.delete('wallet_cancelled'); next.delete('top_up'); return next; }, { replace: true });
        setVerifyAttempt(value => value + 1);
    }, [rememberSession, setParams]);
    const cancelTopUp = useCallback(async () => {
        if (submitting.current) return;
        let id = checkout?.sessionId;
        if (!id && !checkoutOffer) {
            setParams(previous => { const next = new URLSearchParams(previous); next.delete('top_up'); return next; });
            setTopUpResult({ status: 'cancelled' });
            return;
        }
        submitting.current = true;
        setBusy(true);
        try {
            // A timed-out preparation may already exist at Stripe. Recover the
            // same durable intent before claiming its payment was cancelled.
            if (!id) {
                const recovered = await createWalletTopUp(checkoutOffer.id, { uiMode: 'elements' });
                if (!active.current) return;
                id = recovered.sessionId;
                if (!/^cs_[A-Za-z0-9_]+$/.test(id || '')) throw new Error('Unable to locate the top up.');
                if (recovered.paid === true || recovered.status === 'reversed' || recovered.status === 'complete') { verifyPayment(id); return; }
            }
            cancellingSession.current = id;
            const result = await cancelWalletTopUp(id);
            if (!active.current) return;
            if (result.cancelled === true && result.status === 'cancelled') {
                try { if (sessionStorage.getItem(pendingStorageKey) === id) sessionStorage.removeItem(pendingStorageKey); } catch { /* Confirmed expiration cannot be paid. */ }
                setCheckout(null);
                setRecoveredSessionId('');
                setVerification({ status: '', message: '' });
                setTopUpResult({ status: 'cancelled' });
                cancellingSession.current = '';
                setParams(previous => { const next = new URLSearchParams(previous); next.delete('top_up'); next.delete('wallet_session_id'); return next; }, { replace: true });
            } else verifyPayment(id);
        } catch {
            if (active.current) {
                if (id) verifyPayment(id);
                else {
                    setError('We couldn’t confirm the cancellation. Retry the same package to check its existing top up before paying again.');
                    setParams(previous => { const next = new URLSearchParams(previous); next.delete('top_up'); return next; }, { replace: true });
                    setCheckoutOffer(null);
                }
            }
        } finally {
            submitting.current = false;
            if (active.current) setBusy(false);
        }
    }, [checkout, checkoutOffer, pendingStorageKey, setParams, verifyPayment]);
    const topUp = useCallback(async requestedOffer => {
        const offer = requestedOffer?.id ? requestedOffer : selected;
        if (!offer || submitting.current || wallet?.frozen || confirming) return;
        autoPrepared.current = offer.id;
        setTopUpResult(null);
        setCheckoutOffer({ ...offer });
        setCheckoutError('');
        if (requestedPackageId !== offer.id) setParams(previous => { const next = new URLSearchParams(previous); next.set('top_up', offer.id); return next; });
        if (checkout?.summary.packageId === offer.id) return;
        submitting.current = true;
        setBusy(true);
        setCheckout(null);
        setError('');
        try {
            const result = await createWalletTopUp(offer.id, { uiMode: 'elements' });
            if (!active.current) return;
            // Retrying can recover a previously paid checkout. Verify its saved
            // session before showing success, including a reversed payment.
            if (result.paid === true || result.status === 'reversed' || result.status === 'complete') {
                if (typeof result.sessionId !== 'string' || !/^cs_[A-Za-z0-9_]+$/.test(result.sessionId)) throw new Error('Payment status needs review.');
                verifyPayment(result.sessionId);
                return;
            }
            const summary = result.summary;
            if (result.uiMode !== 'elements' || !/^cs_[A-Za-z0-9_]+$/.test(result.sessionId || '') ||
                typeof result.clientSecret !== 'string' || !result.clientSecret.startsWith(`${result.sessionId}_secret_`) ||
                summary?.packageId !== offer.id || summary.currency !== 'usd' ||
                ![summary.amountCents, summary.bonusCents, summary.creditCents, summary.bonusPercent].every(Number.isSafeInteger) ||
                summary.amountCents <= 0 || summary.bonusCents < 0 || summary.bonusPercent < 0 || summary.creditCents !== summary.amountCents + summary.bonusCents) throw new Error('Invalid top up checkout.');
            setCheckout(result);
        } catch {
            if (active.current) setCheckoutError('We couldn’t load secure payment. Try this package again to recover the same top up.');
        } finally {
            submitting.current = false;
            if (active.current) setBusy(false);
        }
    }, [selected, wallet?.frozen, confirming, checkout, requestedPackageId, setParams, verifyPayment]);
    useEffect(() => {
        const wasOpen = Boolean(previousPackage.current);
        previousPackage.current = requestedPackageId;
        if (!requestedPackageId) {
            autoPrepared.current = '';
            // Browser Back can leave during confirmation. Keep the same payment
            // blocked and verified instead of exposing a second top-up attempt.
            try {
                const pending = sessionStorage.getItem(pendingStorageKey);
                if (/^cs_[A-Za-z0-9_]+$/.test(pending || '') && pending !== sessionId) setRecoveredSessionId(pending);
                else if (!pending && wasOpen) {
                    if (checkout && !submitting.current) void cancelTopUp();
                    else if (submitting.current) abandonedPreparation.current = true;
                }
            } catch { /* Redirect recovery still uses the URL. */ }
            if (abandonedPreparation.current && checkout && !submitting.current) {
                abandonedPreparation.current = false;
                void cancelTopUp();
            }
            return;
        }
        if (!wallet || sessionId || autoPrepared.current === requestedPackageId) return;
        const offer = wallet.packages?.find(item => item.id === requestedPackageId);
        if (offer) void topUp(offer);
        else setCheckoutError('This top up package is unavailable. Return to your wallet to choose a current package.');
    }, [requestedPackageId, wallet, sessionId, pendingStorageKey, topUp, checkout, cancelTopUp]);
    const transactions = wallet?.transactions || [];
    const availableBalanceCents = Number.isSafeInteger(wallet?.availableBalanceCents) ? wallet.availableBalanceCents : wallet?.balanceCents;

    if (loading && !wallet) return <WalletSkeleton />;

    if (checkoutOpen && !sessionId && !confirming) return checkoutOffer ? <WalletTopUpCheckout offer={checkoutOffer} checkout={checkout} busy={busy} error={checkoutError}
            onClose={cancelTopUp} onRetry={topUp}
            onBusyChange={value => { submitting.current = value; setBusy(value); }}
            onBeforeConfirm={() => { if (checkout) rememberSession(checkout.sessionId); }}
            onDefinitiveFailure={id => { try { if (sessionStorage.getItem(pendingStorageKey) === id) sessionStorage.removeItem(pendingStorageKey); } catch { /* A declined payment remains editable. */ } }}
            onSuccess={result => { if (checkout && result.session_id === checkout.sessionId) verifyPayment(checkout.sessionId); }} /> : <div className="wallet-page"><h1>Top up your wallet</h1>{checkoutError ? <p role="alert">{checkoutError}</p> : <p role="status">Loading top up…</p>}<button type="button" className="wallet-primary" onClick={() => setParams(previous => { const next = new URLSearchParams(previous); next.delete('top_up'); return next; })}>Back to wallet</button></div>;

    return <div className="wallet-page">
        {topUpResult && <WalletTopUpResult {...topUpResult} onClose={() => setTopUpResult(null)} />}
        <div className="wallet-page-heading"><div><p className="wallet-eyebrow">Your account</p><h1>Wallet</h1><p>Top up once. Pay for your next boost in seconds.</p></div><Link to={returnTo || '/account/dashboard'} className="wallet-secondary-link">{returnTo ? 'Back to checkout' : 'Back to dashboard'} <span aria-hidden="true">↗</span></Link></div>
        <section className="wallet-balance-card" aria-label="Wallet balance" aria-busy={loading}>
            <div><p className="wallet-eyebrow">Available balance</p><strong className="wallet-total" aria-live="polite">{wallet ? walletMoney(availableBalanceCents) : 'Unavailable'}</strong></div><span className="wallet-balance-icon" aria-hidden="true"><WalletIcon /></span>
        </section>
        {wallet?.frozen && <div className="wallet-notice wallet-notice-error" role="alert">Your wallet is temporarily restricted. Please contact support before topping up or paying.</div>}
        {verification.message && <div className="wallet-notice" role="status"><p>{verification.message}</p>{verification.status === 'pending' && <button type="button" onClick={() => setVerifyAttempt(value => value + 1)}>Check payment again</button>}</div>}
        {params.get('wallet_cancelled') && !sessionId && <div className="wallet-notice" role="status">You returned from checkout. No credit is added until payment is confirmed.</div>}
        {error && <div className="wallet-notice wallet-notice-error" role="alert"><p>{error}</p>{!wallet && <button type="button" disabled={loading} onClick={() => setReload(value => value + 1)}>Retry loading wallet</button>}</div>}
        <section className="wallet-section" aria-labelledby="wallet-packages-title">
            <div className="wallet-section-heading"><h2 id="wallet-packages-title">Give your balance a boost</h2></div>
            <fieldset className="wallet-package-grid" disabled={loading || busy || confirming || wallet?.frozen}><legend className="wallet-sr-only">Choose a top up package</legend>{wallet?.packages?.map(item => <label key={item.id} className={`wallet-package${selectedId === item.id ? ' is-selected' : ''}`}>
                <input className="wallet-sr-only" type="radio" name="wallet-package" value={item.id} checked={selectedId === item.id} onChange={() => setSelectedId(item.id)} />
                <span className="wallet-package-bonus">+{item.bonusPercent}% bonus</span><strong className="wallet-package-price">{walletMoney(item.amountCents)}</strong><span className="wallet-package-credit">Get <b>{walletMoney(item.creditCents)}</b></span>
            </label>)}</fieldset>
            <div className="wallet-topup-footer"><button className="wallet-primary" type="button" disabled={!selected || busy || loading || confirming || wallet?.frozen} onClick={topUp}>{busy ? 'Opening secure checkout…' : selected ? `Top up ${walletMoney(selected.amountCents)}` : 'Choose a package'} <span aria-hidden="true">→</span></button></div>
            <p className="wallet-agreement"><LegalAgreement action="topping up your wallet" /> Payments are securely processed by Stripe.</p>
        </section>
        <WalletActivity transactions={transactions} loading={loading} busy={busy} onRefresh={() => setReload(value => value + 1)} />
    </div>;
}
