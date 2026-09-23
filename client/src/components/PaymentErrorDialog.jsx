import { useEffect, useRef } from "react";
import "../styles/PaymentResultPage.css";

export default function PaymentErrorDialog({ message, onClose, action = "Back to Payment", title = "Let’s try that again", informational = false, eyebrow, warning = false }) {
    const dialog = useRef(null);
    const caption = eyebrow ?? (informational ? "Your checkout discount" : "Payment needs attention");
    useEffect(() => {
        const element = dialog.current;
        element.showModal();
        return () => element.close();
    }, []);
    return <dialog ref={dialog} className={`payment-result-modal payment-result-review payment-error-dialog${informational ? " checkout-notice-dialog" : ""}${warning ? " payment-warning-dialog" : ""}`} aria-labelledby={title ? "payment-error-title" : undefined} aria-label={title ? undefined : warning ? "Warning" : "Notice"} aria-describedby="payment-error-description" onCancel={event => { event.preventDefault(); onClose(); }}>
        <div className="payment-result-orb" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d={warning ? "M12 3 2 21h20L12 3ZM12 9v5M12 17h.01" : informational ? "M12 10v7M12 6v.1" : "m7 7 10 10M17 7 7 17"} stroke="currentColor" strokeWidth={warning ? "1.8" : "2.3"} strokeLinecap="round" strokeLinejoin="round" /></svg></div>
        {caption && <p className="payment-result-eyebrow">{caption}</p>}
        {title && <h2 id="payment-error-title">{title}</h2>}
        <p id="payment-error-description" className="payment-result-text">{message}</p>
        <button autoFocus type="button" className="payment-result-primary" onClick={onClose}>{action}</button>
    </dialog>;
}
