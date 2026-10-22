import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Navbar from './Navbar';
import ContractSignaturePad from './ContractSignaturePad';
import { nativeContractRequest } from '../api/nativeContracts';
import { downloadContract, date } from '../api/operations';
import { authStorage } from '../utils/authStorage';
import { clearExpiredSession, getStoredUser, hasValidSession } from '../utils/authSession';
import { agreementSigningPath, hasDrawnSignature, signatureSubmission, signingValuesMatch } from '../utils/nativeSigning';
import { CONTRACT_SIGNING_CHANNEL } from '../utils/contractSigning';
import '../styles/NativeContractSigning.css';

const emptyDrawing = () => ({ type: 'drawn', width: 600, height: 180, strokes: [] });
const companySigned = context => Boolean(context?.contract?.companySignedAt || context?.signatures?.some(signature => signature.role === 'COMPANY'));

export default function NativeContractSigning({ id }) {
    const navigate = useNavigate();
    const [context, setContext] = useState(null);
    const [values, setValues] = useState({});
    const [editing, setEditing] = useState(false);
    const [legalName, setLegalName] = useState('');
    const [initials, setInitials] = useState('');
    const [signature, setSignature] = useState({ type: 'typed' });
    const [consent, setConsent] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [uncertain, setUncertain] = useState(false);
    const [message, setMessage] = useState('');
    const epochRef = useRef(0);
    const controllerRef = useRef(null);
    const reloadRef = useRef(null);
    const pendingRef = useRef(null);
    const dirtyRef = useRef(false);
    const busyRef = useRef(false);
    const contextRef = useRef(null);

    useEffect(() => {
        let active = true, sequence = 0;
        let account = getStoredUser()?.id;
        const invalidate = () => { epochRef.current++; };
        const signIn = () => navigate('/', { replace: true, state: { from: agreementSigningPath(id), openAuthModal: true, authMode: 'login' } });
        const load = async (force = false) => {
            if (!force && (busyRef.current || dirtyRef.current)) return;
            controllerRef.current?.abort();
            const controller = new AbortController(); controllerRef.current = controller;
            const ticket = ++sequence;
            const epoch = epochRef.current;
            if (!hasValidSession()) return signIn();
            try {
                const next = await nativeContractRequest(id, 'signing', undefined, controller.signal);
                if (!active || ticket !== sequence || controller.signal.aborted || epoch !== epochRef.current) return;
                const changed = next.documentHash !== contextRef.current?.documentHash;
                contextRef.current = next; setContext(next); setValues(next.values || {});
                setEditing(next.role === 'company' && !next.prepared && !companySigned(next));
                dirtyRef.current = false;
                if (changed) setConsent(false);
                if (!next.canSign) { pendingRef.current = null; setUncertain(false); }
                setError('');
                return next;
            } catch (failure) {
                if (!active || controller.signal.aborted || ticket !== sequence || epoch !== epochRef.current || failure.name === 'AbortError') return;
                if (failure.status === 401) {
                    clearExpiredSession({ showExpiredModal: false }); signIn();
                } else {
                    if ([403, 404].includes(failure.status)) { contextRef.current = null; setContext(null); setValues({}); }
                    setError(failure.message);
                }
            }
        };
        reloadRef.current = load;
        const refresh = () => load();
        const changed = event => {
            if (event?.type === 'storage' && event.key && !['token', 'user'].includes(event.key)) return;
            const nextAccount = getStoredUser()?.id;
            if (nextAccount !== account || !authStorage.getItem('token')) {
                account = nextAccount; invalidate();
                controllerRef.current?.abort(); pendingRef.current = null; contextRef.current = null;
                dirtyRef.current = false; busyRef.current = false;
                setContext(null); setValues({}); setLegalName(''); setInitials(''); setSignature({ type: 'typed' });
                setConsent(false); setBusy(false); setUncertain(false); setMessage(''); setError('');
                load(true);
            }
        };
        const visible = () => { if (document.visibilityState === 'visible') refresh(); };
        load(true);
        window.addEventListener('focus', refresh);
        window.addEventListener('pageshow', refresh);
        window.addEventListener('auth:changed', changed);
        window.addEventListener('session:expired', changed);
        window.addEventListener('storage', changed);
        document.addEventListener('visibilitychange', visible);
        return () => {
            active = false; sequence++; invalidate(); controllerRef.current?.abort(); reloadRef.current = null;
            window.removeEventListener('focus', refresh); window.removeEventListener('pageshow', refresh);
            window.removeEventListener('auth:changed', changed); window.removeEventListener('session:expired', changed);
            window.removeEventListener('storage', changed); document.removeEventListener('visibilitychange', visible);
        };
    }, [id, navigate]);

    const contract = context?.contract;
    const completed = Boolean(contract?.signedAt);
    const archived = Boolean(context?.archived || contract?.archivedAt);
    const company = context?.role === 'company';
    const editable = company && !archived && !context?.legacy && !completed && !companySigned(context) && !contract?.revokedAt
        && !['voided', 'declined', 'replaced'].includes(contract?.status);
    const reviewed = context?.prepared && !editing && signingValuesMatch(values, context.values);
    const ownSignature = context?.signatures?.find(item => item.role === (company ? 'COMPANY' : 'BOOSTER'));
    const locked = busy || uncertain;

    async function prepare(event) {
        event.preventDefault();
        if (!editable || locked || busyRef.current) return;
        const epoch = epochRef.current;
        busyRef.current = true; setBusy(true); setError(''); setMessage('');
        try {
            const commercialValues = Object.fromEntries((context.fields || []).map(field => [field.key, values[field.key] || '']));
            const next = await nativeContractRequest(id, 'prepare', { values: commercialValues });
            if (epoch !== epochRef.current) return;
            contextRef.current = next; setContext(next); setValues(next.values || {}); setEditing(false); setConsent(false);
            dirtyRef.current = false; pendingRef.current = null;
            setMessage('Your completed agreement is ready to review.');
        } catch (failure) {
            if (epoch !== epochRef.current || failure.name === 'AbortError') return;
            if ([401, 403, 409].includes(failure.status)) await reloadRef.current?.(true);
            if (epoch === epochRef.current) setError(failure.message);
        } finally { if (epoch === epochRef.current) { busyRef.current = false; setBusy(false); } }
    }

    async function sign(event) {
        event.preventDefault();
        if (archived || !context?.canSign || !reviewed || busy || busyRef.current) return;
        const epoch = epochRef.current;
        let intent;
        try {
            intent = uncertain && pendingRef.current ? pendingRef.current : signatureSubmission({ context, legalName, initials, signature, consent }, pendingRef.current);
        } catch (failure) { setError(failure.message); return; }
        pendingRef.current = intent;
        busyRef.current = true; setBusy(true); setError(''); setMessage('');
        try {
            await nativeContractRequest(id, 'sign', intent.body);
            if (epoch !== epochRef.current) return;
            pendingRef.current = null; setUncertain(false); setConsent(false); dirtyRef.current = false;
            setMessage('Your signature has been recorded.');
            const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel(CONTRACT_SIGNING_CHANNEL) : null;
            channel?.postMessage({ id }); channel?.close();
            await reloadRef.current?.(true);
        } catch (failure) {
            if (epoch !== epochRef.current || failure.name === 'AbortError') return;
            setError(failure.message);
            if (!failure.status || failure.status >= 500) {
                setUncertain(true);
            } else {
                pendingRef.current = null; setUncertain(false); setConsent(false);
                const refreshed = await reloadRef.current?.(true);
                if (epoch === epochRef.current && refreshed?.canSign !== false) setError(failure.message);
            }
        } finally { if (epoch === epochRef.current) { busyRef.current = false; setBusy(false); } }
    }

    async function replaceLegacy() {
        if (archived || !context?.canReplace || busy || busyRef.current) return;
        const epoch = epochRef.current;
        busyRef.current = true; setBusy(true); setError('');
        pendingRef.current ||= { replacementId: crypto.randomUUID() };
        try {
            const result = await nativeContractRequest(id, 'native-replacement', { requestId: pendingRef.current.replacementId });
            if (epoch === epochRef.current) navigate(agreementSigningPath(result.id), { replace: true });
        } catch (failure) {
            if (epoch === epochRef.current && failure.name !== 'AbortError') setError(failure.message);
        } finally { if (epoch === epochRef.current) { busyRef.current = false; setBusy(false); } }
    }

    async function download() {
        if (busyRef.current) return;
        const epoch = epochRef.current;
        setError(''); busyRef.current = true; setBusy(true);
        try { await downloadContract(id); }
        catch (failure) { if (epoch === epochRef.current) setError(failure.message); }
        finally { if (epoch === epochRef.current) { busyRef.current = false; setBusy(false); } }
    }

    const step = archived ? 'Archived agreement' : completed ? 'Agreement completed' : ownSignature ? 'Your signature is recorded' : company ? 'FastBoost signs first' : 'Review and sign';
    return <div className="native-signing-page">
        <Navbar />
        <header className="native-signing-toolbar">
            <div><Link to={`/provider/contracts/${encodeURIComponent(id)}`}>← Back to agreement</Link><h1>Booster Service Agreement</h1></div>
            {context && !context.legacy && <span className={completed ? 'native-signing-status is-complete' : 'native-signing-status'}>{step}</span>}
        </header>
        {!context && <div className="native-signing-loading" role={error ? 'alert' : 'status'}>{error || 'Loading agreement…'}</div>}
        {context?.legacy ? <main className="native-signing-legacy native-signing-panel">
            <h2>{archived ? 'Archived agreement' : contract?.signedAt ? 'Signed DocuSign agreement' : 'This agreement was issued with DocuSign'}</h2>
            {archived && <p>This agreement is retained for your records and is no longer available for signing.</p>}
            <p>{contract?.signedAt ? 'The original signed document remains available from its agreement page.' : 'Website signing uses a new agreement with its own document and signature record.'}</p>
            {!archived && context.canReplace && <><p>Create a new website agreement to review and sign here. The existing DocuSign agreement will remain in your records.</p>
                <button className="native-primary" disabled={busy} onClick={replaceLegacy}>{busy ? 'Preparing…' : 'Create website agreement'}</button></>}
            {!archived && !context.canReplace && !contract?.signedAt && <p>The FastBoost signer must reconcile this agreement before replacing it.</p>}
            {archived && contract?.documentAvailable && <button className="native-primary" disabled={busy} onClick={download}>Download PDF</button>}
            {error && <p className="native-signing-error" role="alert">{error}</p>}
        </main> : context && <main className="native-signing-layout">
            <section className="native-signing-document" aria-label="Agreement document">
                {context.html && <iframe key={context.documentHash || 'draft'} title="Booster Service Agreement" srcDoc={context.html} sandbox="allow-same-origin" />}
            </section>
            <aside className="native-signing-panel" aria-label="Agreement signing">
                <div className="native-signing-parties">
                    <h2>{completed ? 'Completed signatures' : 'Signatures'}</h2>
                    {[{ role: 'COMPANY', label: 'FastBoost', name: contract?.companySignerName }, { role: 'BOOSTER', label: 'Booster', name: contract?.signerName }].map(party => {
                        const saved = context.signatures?.find(item => item.role === party.role);
                        return <div key={party.role}><span aria-hidden="true" className={saved ? 'is-signed' : ''}>{saved ? '✓' : party.role === 'COMPANY' ? '1' : '2'}</span><p><strong>{party.label}</strong>{party.name}<small>{saved ? `Signed ${date(saved.signedAt)}` : archived ? 'Not signed' : 'Awaiting signature'}</small></p></div>;
                    })}
                </div>
                {error && <p className="native-signing-error" role="alert">{error}</p>}
                {message && <p className="native-signing-message" role="status">{message}</p>}
                {archived ? <div className="native-signing-finished"><h2>Archived agreement</h2><p>This agreement is retained for your records and is no longer available for signing.</p>{contract?.documentAvailable && <button className="native-primary" disabled={busy} onClick={download}>{completed ? 'Download signed PDF' : 'Download PDF'}</button>}</div> : completed ? <div className="native-signing-finished"><h2>All signed</h2><p>Both parties have signed this agreement. Download the completed PDF and its signing record.</p><button className="native-primary" disabled={busy} onClick={download}>Download signed PDF</button></div> : ownSignature ? <div className="native-signing-finished"><h2>Thank you</h2><p>{company ? 'The booster can now review and sign the completed agreement.' : 'Your signature is saved.'}</p><Link to={`/provider/contracts/${encodeURIComponent(id)}`}>Return to agreement</Link></div> : <>
                    {editable && editing && <form onSubmit={prepare} className="native-commercial-form">
                        <h2>Complete the agreement</h2><p>Fill in the commercial details before reviewing and signing.</p>
                        {context.fields?.map(field => <label key={field.key}>{field.label}{field.maxLength > 150 ? <textarea required={field.required !== false} maxLength={field.maxLength || 250} rows={3} disabled={locked} value={values[field.key] || ''} onChange={event => { dirtyRef.current = true; setConsent(false); setValues(previous => ({ ...previous, [field.key]: event.target.value })); }} /> : <input required={field.required !== false} maxLength={field.maxLength || 100} disabled={locked} value={values[field.key] || ''} onChange={event => { dirtyRef.current = true; setConsent(false); setValues(previous => ({ ...previous, [field.key]: event.target.value })); }} />}</label>)}
                        <button className="native-primary" disabled={locked}>{busy ? 'Preparing…' : 'Review completed agreement'}</button>
                    </form>}
                    {reviewed && context.canSign && <form className="native-signature-form" onSubmit={sign}>
                        <h2>{company ? 'Sign for FastBoost' : 'Your signature'}</h2>
                        <p>Review the completed agreement, including Schedule A, before signing.</p>
                        {editable && <button type="button" className="native-text-button" disabled={locked} onClick={() => { dirtyRef.current = true; setEditing(true); setConsent(false); setMessage(''); }}>Edit agreement details</button>}
                        <label>Your full legal name<input autoComplete="name" required minLength={2} maxLength={100} disabled={locked} value={legalName} onChange={event => { setLegalName(event.target.value); pendingRef.current = null; }} /></label>
                        <label>Schedule A initials<input required minLength={1} maxLength={12} disabled={locked} value={initials} onChange={event => { setInitials(event.target.value); pendingRef.current = null; }} /></label>
                        <fieldset className="native-signature-method" disabled={locked}><legend>Signature</legend><div>
                            <label><input type="radio" name="signature-method" checked={signature.type === 'typed'} onChange={() => setSignature({ type: 'typed' })} />Type</label>
                            <label><input type="radio" name="signature-method" checked={signature.type === 'drawn'} onChange={() => setSignature(emptyDrawing())} />Draw</label>
                        </div></fieldset>
                        {signature.type === 'typed' ? <div className="native-typed-signature" aria-label="Typed signature preview">{legalName || 'Your signature'}</div> : <ContractSignaturePad signature={signature} disabled={locked} onChange={next => { setSignature(next); pendingRef.current = null; }} />}
                        <label className="native-signing-consent"><input type="checkbox" checked={consent} required disabled={locked} onChange={event => setConsent(event.target.checked)} /><span>{context.consentText}</span></label>
                        <p className="native-signing-privacy">Your signature is saved with your account, the agreed document, signing time and security details. Both parties can retain the completed PDF.</p>
                        {uncertain && <div className="native-signing-pending" role="status"><p>Confirmation was interrupted. Check the saved status or retry this same signature.</p><button type="button" disabled={busy} onClick={() => reloadRef.current?.(true)}>Check signing status</button></div>}
                        <button className="native-primary" disabled={busy || (!uncertain && (!consent || !legalName.trim() || !initials.trim() || (signature.type === 'drawn' && !hasDrawnSignature(signature))))}>{busy ? 'Recording signature…' : uncertain ? 'Retry signature confirmation' : 'Sign agreement'}</button>
                    </form>}
                    {!editing && !editable && !context.canSign && !ownSignature && <p>Signing is not available for this account at this stage.</p>}
                </>}
            </aside>
        </main>}
    </div>;
}
