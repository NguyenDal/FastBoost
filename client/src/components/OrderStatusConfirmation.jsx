import { useEffect, useRef } from 'react';
import '../styles/OrderStatusConfirmation.css';

export function OrderStatusIcon({ status }) {
    return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d={status === 'COMPLETED' ? 'm8 12 2.5 2.5L16 9' : 'm9 9 6 6m0-6-6 6'} />
    </svg>;
}

export default function OrderStatusConfirmation({ orderNumber, status, busy, error, returnFocus, onClose, onConfirm }) {
    const dialog = useRef(null);
    const errorMessage = useRef(null);
    const completing = status === 'COMPLETED';
    const tone = completing ? 'complete' : 'cancel';

    useEffect(() => {
        const element = dialog.current;
        const previouslyFocused = document.activeElement;
        element.showModal();
        return () => {
            element.close();
            // Success changes the return target to the heading because the opener is now disabled.
            // eslint-disable-next-line react-hooks/exhaustive-deps
            const target = returnFocus?.current || previouslyFocused;
            if (target?.isConnected) target.focus();
        };
    }, [returnFocus]);

    useEffect(() => {
        if (error) errorMessage.current?.focus();
    }, [error]);

    return <dialog
        ref={dialog}
        className={`order-status-confirmation order-status-confirmation--${tone}`}
        aria-labelledby="order-status-confirm-title"
        aria-describedby="order-status-confirm-description"
        aria-busy={busy}
        onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}
    >
        <span className="order-status-confirmation-icon"><OrderStatusIcon status={status} /></span>
        <p className="order-status-confirmation-reference">Order #{orderNumber}</p>
        <h2 id="order-status-confirm-title">{completing ? 'Complete this order?' : 'Cancel this order?'}</h2>
        <p id="order-status-confirm-description" className="order-status-confirmation-description">
            {completing
                ? 'Confirm that all work on this order is finished before marking it as completed.'
                : 'The customer will be notified that the order is cancelled. This does not issue a refund.'}
        </p>
        {error && <p ref={errorMessage} tabIndex={-1} className="order-status-confirmation-error" role="alert">{error}</p>}
        <div className="order-status-confirmation-actions">
            <button type="button" className="secondary-btn" disabled={busy} onClick={onClose}>Go back</button>
            <button type="button" className={`order-status-action order-status-action--${tone}`} disabled={busy} onClick={onConfirm}>
                <OrderStatusIcon status={status} />
                {busy ? 'Updating…' : completing ? 'Confirm completion' : 'Confirm cancellation'}
            </button>
        </div>
    </dialog>;
}
