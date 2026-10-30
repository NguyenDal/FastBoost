import { useEffect, useRef, useState } from 'react';
import { nativeSigningText } from '../utils/nativeSigningI18n';

function Checkmark() {
    return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12 4 4L19 6" /></svg>;
}

export default function NativeSigningProgress({ language, steps, complete, completeDescription, disabled, frameDocument }) {
    const [open, setOpen] = useState(false);
    const rootRef = useRef(null);
    const triggerRef = useRef(null);
    const panelRef = useRef(null);
    const t = key => nativeSigningText(language, key);
    const remaining = steps.filter(step => !step.complete).length;
    const status = complete ? t('yourStepsComplete') : t(remaining === 1 ? 'stepRemaining' : 'stepsRemaining').replace('{count}', remaining);

    useEffect(() => {
        if (!open) return;
        panelRef.current?.querySelector('button')?.focus({ preventScroll: true });
        const dismissOutside = event => {
            if (!rootRef.current?.contains(event.target)) setOpen(false);
        };
        const dismissOnEscape = event => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            setOpen(false);
            triggerRef.current?.focus({ preventScroll: true });
        };
        // Inputs live in the document iframe, whose DOM events do not bubble
        // into the surrounding page.
        const documents = [document, frameDocument].filter(Boolean);
        for (const doc of documents) {
            doc.addEventListener('pointerdown', dismissOutside);
            doc.addEventListener('keydown', dismissOnEscape);
        }
        return () => {
            for (const doc of documents) {
                doc.removeEventListener('pointerdown', dismissOutside);
                doc.removeEventListener('keydown', dismissOnEscape);
            }
        };
    }, [open, frameDocument]);

    return <div ref={rootRef} className={`native-mobile-progress${complete ? ' is-complete' : ''}`}>
        {open && <section ref={panelRef} id="native-progress-checklist" className="native-progress-popover" role="dialog" aria-labelledby="native-progress-title">
            <div className="native-progress-heading">
                <h2 id="native-progress-title">{complete ? t('yourStepsComplete') : t('agreementChecklist')}</h2>
                <button type="button" className="native-progress-close" aria-label={t('closeChecklist')} onClick={() => { setOpen(false); triggerRef.current?.focus({ preventScroll: true }); }}>×</button>
            </div>
            {complete && <p className="native-progress-finished"><Checkmark />{completeDescription}</p>}
            {steps.length > 0 && <ul>{steps.map(step => <li key={step.id}>
                    <button type="button" className={`native-progress-step${step.complete ? ' is-complete' : ''}`} disabled={disabled || step.disabled} onClick={() => { setOpen(false); step.onSelect(); }}>
                        <span className="native-progress-dot" aria-hidden="true" />
                        <span><strong>{step.label}</strong><small>{step.complete ? t('stepCompleted') : step.hint}</small></span>
                        <span className="native-progress-arrow" aria-hidden="true">↗</span>
                    </button>
                </li>)}</ul>}
        </section>}
        <button ref={triggerRef} type="button" className="native-progress-toggle" aria-label={status} aria-expanded={open} aria-controls="native-progress-checklist" aria-haspopup="dialog" onClick={() => setOpen(value => !value)}>
            {complete ? <Checkmark /> : <span aria-hidden="true">{remaining}</span>}
        </button>
        <span className="native-progress-live" role="status">{status}</span>
    </div>;
}
