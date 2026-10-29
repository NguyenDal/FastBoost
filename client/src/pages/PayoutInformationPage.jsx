import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import Navbar from '../components/Navbar';
import { API_BASE_URL } from '../api/config';
import { authStorage } from '../utils/authStorage';
import { createPayoutRequest, PAYOUT_CORRECTIONS, PAYOUT_COUNTRIES, payoutStatus, payoutSubmission } from '../utils/payoutInformation';
import { formatLocalSignatureTime } from '../utils/nativeSigning';
import '../styles/Operations.css';
import '../styles/PayoutInformation.css';

const request = createPayoutRequest({ baseUrl: API_BASE_URL, getToken: () => authStorage.getItem('token') });
const emptyDetails = { legalName: '', accountNumber: '', routingNumber: '', bankName: '', currency: '' };

function BankIcon() {
    return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m3 8 9-5 9 5v2H3zM5 10v8m5-8v8m4-8v8m5-8v8M3 21h18M4 18h16" /></svg>;
}

function PayoutForm({ country, initialDetails, busy, onSubmit, onCancel }) {
    const [values, setValues] = useState(() => ({ ...emptyDetails, ...initialDetails, currency: country === 'US' ? 'USD' : initialDetails?.currency || '' }));
    const [confirmed, setConfirmed] = useState(false);
    const [error, setError] = useState('');
    const update = event => setValues(previous => ({ ...previous, [event.target.name]: event.target.value }));
    async function submit(event) {
        event.preventDefault();
        if (busy || !confirmed) return;
        setError('');
        try { await onSubmit(payoutSubmission(values, country)); }
        catch (failure) { setError(failure.message); }
    }
    return <form className="payout-form" onSubmit={submit} autoComplete="off">
        <fieldset disabled={busy}>
            <legend className="ops-sr-only">Bank details for {PAYOUT_COUNTRIES[country]}</legend>
            <label className="payout-wide">Account holder’s full name<input name="legalName" value={values.legalName} onChange={update} required minLength={2} maxLength={100} autoComplete="off" spellCheck="false" placeholder="Name shown on your bank account" /></label>
            {country === 'US' ? <label>Routing number<input name="routingNumber" inputMode="numeric" value={values.routingNumber} onChange={update} required pattern="[0-9]{9}" minLength={9} maxLength={9} autoComplete="off" spellCheck="false" placeholder="9 digits" /></label>
                : <label>Bank name<input name="bankName" value={values.bankName} onChange={update} required minLength={2} maxLength={120} autoComplete="off" spellCheck="false" placeholder="Your receiving bank" /></label>}
            <label>Account number<input name="accountNumber" inputMode="numeric" value={values.accountNumber} onChange={update} required pattern={country === 'US' ? '[0-9]{4,17}' : '[0-9]{4,30}'} minLength={4} maxLength={country === 'US' ? 17 : 30} autoComplete="off" spellCheck="false" /></label>
            {country === 'VN' && <label className="payout-wide">Account currency<select name="currency" value={values.currency} onChange={update} required>
                <option value="" disabled>Select currency</option><option value="USD">USD — US dollar</option><option value="VND">VND — Vietnamese đồng</option>
            </select><small>This is your receiving preference. Any VND conversion quote is agreed separately before payment.</small></label>}
            <label className="payout-check payout-wide"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} required /><span>I confirm these details belong to my bank account and are correct for receiving payouts.</span></label>
            {error && <p className="ops-error payout-wide" role="alert">{error}</p>}
            <div className="payout-form-actions payout-wide"><button className="ops-primary" disabled={!confirmed || busy}>{busy ? 'Saving…' : 'Submit bank details'}</button>{onCancel && <button type="button" onClick={onCancel}>Cancel</button>}</div>
        </fieldset>
    </form>;
}

function PayoutWorkspace({ id }) {
    const [context, setContext] = useState(null);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const [details, setDetails] = useState(null);
    const [editing, setEditing] = useState(false);
    const [reason, setReason] = useState('ACCOUNT_DETAILS');
    const [country, setCountry] = useState('');
    const [notice, setNotice] = useState('');
    const [expired, setExpired] = useState(false);
    const [loadVersion, setLoadVersion] = useState(0);
    const session = useRef(authStorage.getItem('token'));
    const lifecycle = useRef(null);
    const inFlight = useRef(false);
    const path = `/payout-information/${encodeURIComponent(id)}`;

    useEffect(() => {
        const controller = new AbortController();
        lifecycle.current = controller;
        const clear = () => {
            if (authStorage.getItem('token') === session.current && authStorage.getItem('token')) return;
            controller.abort();
            setDetails(null); setEditing(false); setContext(null); setExpired(true);
        };
        const conceal = () => { if (document.visibilityState === 'hidden') { setDetails(null); setEditing(false); } };
        for (const event of ['auth:changed', 'auth:refreshed', 'session:expired', 'storage', 'focus']) window.addEventListener(event, clear);
        document.addEventListener('visibilitychange', conceal);
        request(path, undefined, { signal: controller.signal, expectedToken: session.current })
            .then(result => { if (!controller.signal.aborted) { setContext(result); setCountry(result.request.country); setError(''); } })
            .catch(failure => { if (!controller.signal.aborted) { if (failure.name === 'AbortError') setExpired(true); else setError(failure.message); } });
        return () => {
            controller.abort();
            document.removeEventListener('visibilitychange', conceal);
            for (const event of ['auth:changed', 'auth:refreshed', 'session:expired', 'storage', 'focus']) window.removeEventListener(event, clear);
        };
    }, [path, loadVersion]);

    async function action(kind, body, after) {
        if (inFlight.current || !lifecycle.current || lifecycle.current.signal.aborted) return;
        inFlight.current = true; setBusy(true); setError(''); setNotice('');
        const signal = lifecycle.current.signal;
        try {
            const result = await request(`${path}/${kind}`, body, { signal, expectedToken: session.current });
            if (!signal.aborted) after(result);
        } catch (failure) {
            if (!signal.aborted) {
                if (failure.name === 'AbortError') { setDetails(null); setEditing(false); setContext(null); setExpired(true); }
                else {
                    setError(failure.message);
                    if (failure.status === 401 || failure.status === 403) { setDetails(null); setEditing(false); setContext(null); }
                    if (failure.status === 409) { setDetails(null); setEditing(false); setContext(null); setNotice('This request changed. Review the latest details before continuing.'); setLoadVersion(value => value + 1); }
                }
            }
        } finally {
            inFlight.current = false;
            if (!signal.aborted) setBusy(false);
        }
    }
    const entry = context?.request;
    const showForm = context?.canSubmit && (entry.status === 'REQUESTED' || editing);
    function reveal(edit = false) {
        action('details', {}, result => {
            if (document.visibilityState === 'hidden') return;
            if (result.revision !== entry.revision) {
                setDetails(null); setContext(null); setLoadVersion(value => value + 1);
                setNotice('The bank details changed. Open the latest details to continue.');
                return;
            }
            setDetails(result.details); setEditing(edit);
        });
    }
    function acceptUpdate(result) {
        setDetails(null); setEditing(false); setContext(previous => ({ ...previous, request: result.request,
            canReview: previous.canReview && result.request.status === 'SUBMITTED' }));
    }
    const date = value => formatLocalSignatureTime(value) || '—';
    return <div className="page-shell"><Navbar /><main className="page-container ops-page payout-page">
        <Link className="payout-back" to={context?.own ? '/provider/documents' : '/admin/boosters'}>← Back to documents</Link>
        <section className="ops-card payout-card" aria-busy={busy} aria-labelledby="payout-title">
        <header className="payout-card-heading"><div className="payout-identity"><div className="payout-icon"><BankIcon /></div><div><h1 id="payout-title">Payout information</h1>{context?.boosterName && <p>{context.boosterName}</p>}</div></div>{context && !expired && <span className={`ops-badge ${entry.status === 'VERIFIED' ? 'approved' : ''}`} role="status" aria-live="polite" aria-atomic="true">{payoutStatus(entry.status)}</span>}</header>
        {context && !expired && <p className="payout-method"><span>{PAYOUT_COUNTRIES[entry.country]}</span><span>Remitly bank deposit</span></p>}
        {expired ? <p className="ops-error" role="alert">Your session changed. Reload this page to continue.</p> : error && <p className="ops-error" role="alert">{error}{!context && <button type="button" onClick={() => setLoadVersion(value => value + 1)}>Try again</button>}</p>}
        {!context && !error && !expired && <p role="status">Loading payout information…</p>}
        {notice && <p className="payout-notice" role="status">{notice}</p>}
        {context && !expired && <>
            {entry.correctionReason && entry.status === 'CHANGES_REQUESTED' && <p className="payout-correction">{PAYOUT_CORRECTIONS[entry.correctionReason] || PAYOUT_CORRECTIONS.OTHER}</p>}
            {showForm ? <PayoutForm key={`${entry.id}-${entry.revision}`} country={entry.country} initialDetails={details} busy={busy}
                onCancel={editing ? () => { setDetails(null); setEditing(false); } : undefined}
                onSubmit={values => action('submit', { revision: entry.revision, details: values, confirmed: true }, acceptUpdate)} />
                : <>
                    {entry.status === 'REQUESTED' ? <p className="payout-waiting">The booster can complete this request from their Documents.</p>
                        : <>
                            <dl className="payout-details"><div><dt>Account holder</dt><dd>{details?.legalName || 'Hidden'}</dd></div>
                                {entry.country === 'US' ? <div><dt>Routing number</dt><dd className="payout-number">{details?.routingNumber || '•••••••••'}</dd></div> : <div><dt>Bank name</dt><dd>{details?.bankName || 'Hidden'}</dd></div>}
                                <div><dt>Account number</dt><dd className="payout-number">{details?.accountNumber || `•••• ${entry.accountLast4 || ''}`}</dd></div><div><dt>Receiving currency</dt><dd>{entry.currency || '—'}</dd></div>
                            </dl>
                            <div className="payout-actions">
                                <button type="button" disabled={busy} onClick={() => details ? setDetails(null) : reveal()}>{details ? 'Hide bank details' : 'Show bank details'}</button>
                                {context.canSubmit && <button type="button" disabled={busy} onClick={() => details ? setEditing(true) : reveal(true)}>Edit details</button>}
                            </div>
                            {context.canSubmit && entry.status === 'VERIFIED' && <p className="payout-help">Changes will be reviewed again before the account is used for payouts.</p>}
                        </>}

                    {context.canReview && details && <div className="payout-review"><div className="payout-review-actions"><button className="ops-primary" type="button" disabled={busy} onClick={() => action('review', { revision: entry.revision, decision: 'verify' }, acceptUpdate)}>Mark as verified</button><label>Correction reason<select value={reason} onChange={event => setReason(event.target.value)} disabled={busy}><option value="ACCOUNT_DETAILS">Bank details need correction</option><option value="NAME_MISMATCH">Account holder name differs</option><option value="OTHER">Discuss with FastBoost</option></select></label><button type="button" disabled={busy} onClick={() => action('review', { revision: entry.revision, decision: 'return', reason }, acceptUpdate)}>Request correction</button></div></div>}
                </>}
            {context.canChangeCountry && entry.status === 'REQUESTED' && <div className="payout-country-change"><label>Bank country<select value={country} onChange={event => setCountry(event.target.value)} disabled={busy}><option value="US">United States</option><option value="VN">Vietnam</option></select></label><button type="button" disabled={busy || country === entry.country} onClick={() => action('country', { revision: entry.revision, country }, acceptUpdate)}>Update country</button></div>}
            {(entry.submittedAt || entry.reviewedAt) && <footer className="payout-footer">{entry.submittedAt && <span>Submitted {date(entry.submittedAt)}</span>}{entry.reviewedAt && <span>Reviewed {date(entry.reviewedAt)}</span>}</footer>}
        </>}
        </section>
    </main></div>;
}

export default function PayoutInformationPage() {
    const { id } = useParams();
    return <PayoutWorkspace key={id} id={id} />;
}
