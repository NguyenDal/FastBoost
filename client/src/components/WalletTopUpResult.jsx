import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import '../styles/PaymentResultPage.css';

const money = cents => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);

export default function WalletTopUpResult({ status = 'paid', onClose, creditCents }) {
    const dialog = useRef(null);
    const id = useId();
    const titleId = `wallet-topup-result-title-${id}`;
    const descriptionId = `wallet-topup-result-description-${id}`;
    const paid = status === 'paid';
    const amountKnown = Number.isSafeInteger(creditCents) && creditCents > 0;

    useEffect(() => {
        const element = dialog.current;
        element.showModal();
        return () => element.close();
    }, []);

    return createPortal(<dialog ref={dialog} className={`payment-result-modal payment-error-dialog ${paid ? 'payment-result-success' : 'payment-result-cancelled'}`} aria-labelledby={titleId} aria-describedby={descriptionId} onCancel={event => { event.preventDefault(); onClose(); }}>
        <div className="payment-result-orb" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d={paid ? 'M5 12.5l4.2 4.2L19 7' : 'M7 7l10 10M17 7L7 17'} stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" /></svg></div>
        <p className="payment-result-eyebrow">{paid ? 'Payment Successful' : 'Payment Cancelled'}</p>
        <h2 id={titleId}>{paid ? 'Top up complete' : 'Top up cancelled'}</h2>
        <p id={descriptionId} className="payment-result-text" aria-live="polite">{paid ? amountKnown ? `${money(creditCents)} has been added to your wallet.` : 'Your top up is complete. Your wallet is ready to use.' : 'Choose a package anytime.'}</p>
        <div className="payment-result-actions"><button autoFocus type="button" className="payment-result-primary" onClick={onClose}>Back to wallet</button></div>
    </dialog>, document.body);
}
