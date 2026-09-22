import { useEffect, useRef } from "react";
import "../styles/PaymentResultPage.css";

export default function PaymentErrorDialog({ message, onClose, action = "Back to Payment" }) {
    const dialog = useRef(null);
    useEffect(() => {
        const element = dialog.current;
        element.showModal();
        return () => element.close();
    }, []);
    return <dialog ref={dialog} className="payment-result-modal payment-result-review payment-error-dialog" aria-labelledby="payment-error-title" aria-describedby="payment-error-description" onCancel={event => { event.preventDefault(); onClose(); }}>
        <div className="payment-result-orb" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="m7 7 10 10M17 7 7 17" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" /></svg></div>
        <p className="payment-result-eyebrow">Payment needs attention</p>
        <h2 id="payment-error-title">Let’s try that again</h2>
        <p id="payment-error-description" className="payment-result-text">{message}</p>
        <button autoFocus type="button" className="payment-result-primary" onClick={onClose}>{action}</button>
    </dialog>;
}
