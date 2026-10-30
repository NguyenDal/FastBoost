import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import Navbar from './Navbar';
import ContractSignaturePad from './ContractSignaturePad';
import NativeSigningProgress from './NativeSigningProgress';
import { nativeContractRequest } from '../api/nativeContracts';
import { downloadContract } from '../api/operations';
import { authStorage } from '../utils/authStorage';
import { clearExpiredSession, getStoredUser, hasValidSession } from '../utils/authSession';
import { agreementSigningPath, formatLocalSignatureTime, signatureMissingRequirements, signatureSubmission, signingValuesMatch } from '../utils/nativeSigning';
import { translateAgreementHtml } from '../utils/translateAgreementHtml';
import { nativeSigningText, nativeSigningFieldLabel, nativeSigningFieldHelp } from '../utils/nativeSigningI18n';
import { CONTRACT_SIGNING_CHANNEL } from '../utils/contractSigning';
import '../styles/NativeContractSigning.css';

const companySigned = context => Boolean(context?.contract?.companySignedAt || context?.signatures?.some(signature => signature.role === 'COMPANY'));
const FIXED_DRAFT_FIELDS = new Set(['ReferenceLanguage']);

export default function NativeContractSigning({ id }) {
    const navigate = useNavigate();
    const [context, setContext] = useState(null);
    const [values, setValues] = useState({});
    const [editing, setEditing] = useState(false);
    const [legalName, setLegalName] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [uncertain, setUncertain] = useState(false);
    const [message, setMessage] = useState('');
    const [frameDocument, setFrameDocument] = useState(null);
    const [loadedFrameKey, setLoadedFrameKey] = useState('');
    const [language, setLanguage] = useState('en');
    const [signature, setSignature] = useState({ type: 'typed', style: 1, width: 600, height: 180, strokes: [] });
    const iframeRef = useRef(null);
    const pendingJumpRef = useRef(false);
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
                contextRef.current = next; setContext(next);
                setValues({ ...next.values, ...(!next.prepared ? { ReferenceLanguage: 'English/Vietnamese' } : {}) });
                setEditing(next.role === 'company' && !next.prepared && next.canPrepare === true);
                dirtyRef.current = false;
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
                controllerRef.current?.abort(); pendingRef.current = null; pendingJumpRef.current = false; contextRef.current = null;
                dirtyRef.current = false; busyRef.current = false;
                setContext(null); setValues({}); setFrameDocument(null); setLoadedFrameKey('');
                setLegalName('');
                setSignature({ type: 'typed', style: 1, width: 600, height: 180, strokes: [] });
                setBusy(false); setUncertain(false); setMessage(''); setError('');
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
    const editable = company && context?.canPrepare === true && !archived && !context?.legacy && !completed && !companySigned(context) && !contract?.revokedAt
        && !['voided', 'declined', 'replaced'].includes(contract?.status);
    const reviewed = context?.prepared && !editing && signingValuesMatch(values, context.values);
    const ownSignature = context?.signatures?.find(item => item.role === (company ? 'COMPANY' : 'BOOSTER'));
    const directSigning = editable && editing && context?.signingOrder === 'COMPANY_FIRST';
    const showSignatureForm = (directSigning || (reviewed && context?.canSign)) && !ownSignature && !archived;
    const assignedLegalName = (company ? contract?.companySignerName : contract?.signerName) || '';
    const locked = busy || uncertain;
    const t = key => nativeSigningText(language, key);
    const missingSignatureRequirements = signatureMissingRequirements({ legalName, signature });
    const iframeHtml = useMemo(() => context?.html ? translateAgreementHtml(context.html, language) : '', [context?.html, language]);
    const currentFrameKey = `${context?.documentHash || 'draft'}-${language}`;
    const frameReady = frameDocument && loadedFrameKey === currentFrameKey && iframeRef.current?.contentDocument === frameDocument;
    const fieldMarkers = frameReady ? [...frameDocument.querySelectorAll('[data-native-field]')] : [];
    const embeddedFields = frameReady ? (context?.fields || []).map(field => ({
        field,
        targets: fieldMarkers.filter(node => node.getAttribute('data-native-field') === field.key),
    })) : [];
    const editableFields = (context?.fields || []).filter(field => !FIXED_DRAFT_FIELDS.has(field.key));
    const allFieldsEmbedded = embeddedFields.length === (context?.fields || []).length && embeddedFields.every(item => item.targets.length);

    useEffect(() => {
        if (!frameReady) return;
        const body = frameDocument.body;
        body.classList.add('fb-signing');
        body.classList.toggle('native-is-editing', Boolean(editable && editing));
        const signerCard = frameDocument.querySelector(`[data-native-signature-role="${company ? 'COMPANY' : 'BOOSTER'}"]`);
        signerCard?.classList.toggle('native-is-signing', Boolean(showSignatureForm));
        let active = true, frame = 0;
        const resize = () => {
            if (!active || iframeRef.current?.contentDocument !== frameDocument) return;
            const height = Math.max(frameDocument.documentElement.scrollHeight, body.scrollHeight);
            if (iframeRef.current && Number.parseFloat(iframeRef.current.style.height || '0') !== height) iframeRef.current.style.height = `${height}px`;
        };
        const scheduleResize = () => { if (active && !frame) frame = requestAnimationFrame(() => { frame = 0; resize(); }); };
        scheduleResize();
        frameDocument.fonts?.ready?.then(scheduleResize);
        window.addEventListener('resize', scheduleResize);
        frameDocument.addEventListener('input', scheduleResize);
        frameDocument.addEventListener('pointerup', scheduleResize);
        return () => {
            active = false;
            window.removeEventListener('resize', scheduleResize);
            frameDocument.removeEventListener('input', scheduleResize);
            frameDocument.removeEventListener('pointerup', scheduleResize);
            if (frame) cancelAnimationFrame(frame);
        };
    }, [frameDocument, frameReady, editable, editing, company, showSignatureForm, uncertain, error, signature.type, missingSignatureRequirements.length]);

    useEffect(() => {
        if (!frameReady || !reviewed || !context?.canSign || !pendingJumpRef.current) return;
        const timer = window.setTimeout(() => {
            const target = frameDocument.querySelector('[data-native-signature-mount] input[name="legalName"], [data-native-signature-mount] [data-native-signature-drawing]');
            if (target) { scrollToFrameElement(target, true); pendingJumpRef.current = false; }
        }, 80);
        return () => window.clearTimeout(timer);
    // The jump is intentionally tied to the new iframe after preparation.
    }, [frameDocument, frameReady, reviewed, context?.canSign]);

    function frameLoaded(event) {
        const doc = event.currentTarget.contentDocument;
        if (!doc) { setError(t('fieldsUnavailable')); return; }
        doc.body.classList.add('fb-signing');
        for (const time of doc.querySelectorAll('time[data-native-date-time]')) {
            const localTime = formatLocalSignatureTime(time.getAttribute('data-native-date-time'), language);
            if (localTime) time.textContent = localTime;
        }
        const schedule = doc.getElementById('schedule-a');
        const signatures = doc.getElementById('signatures');
        if (!schedule || !signatures) { setError(t('fieldsUnavailable')); return; }
        if (editable && editing) {
            const visibleKeys = new Set([...doc.querySelectorAll('[data-native-field]')].map(node => node.getAttribute('data-native-field')));
            if ((context.fields || []).some(field => !visibleKeys.has(field.key))) setError(t('fieldsUnavailable'));
        }
        const reviewMount = doc.createElement('div'); reviewMount.dataset.nativeReviewMount = '';
        schedule.append(reviewMount);
        const noticeMount = doc.createElement('div'); noticeMount.dataset.nativeSigningNoticeMount = '';
        signatures.querySelector('.fb-signatures')?.before(noticeMount);
        if (!noticeMount.parentNode) signatures.append(noticeMount);
        const signerCard = doc.querySelector(`[data-native-signature-role="${company ? 'COMPANY' : 'BOOSTER'}"]`);
        if (signerCard) {
            const signatureMount = doc.createElement('div'); signatureMount.dataset.nativeSignatureMount = '';
            signerCard.append(signatureMount);
        } else if (context?.canSign || directSigning) setError(t('fieldsUnavailable'));
        setLoadedFrameKey(event.currentTarget.dataset.frameKey);
        setFrameDocument(doc);
    }

    function scrollToFrameElement(target, focus = false) {
        if (!target || !iframeRef.current) return;
        const frameRect = iframeRef.current.getBoundingClientRect();
        const targetRect = target.getBoundingClientRect();
        const offset = Math.min(210, window.innerHeight * .28);
        const top = Math.max(0, window.scrollY + frameRect.top + targetRect.top - offset);
        const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (focus) target.focus({ preventScroll: true });
        window.scrollTo({ top, behavior: reducedMotion ? 'auto' : 'smooth' });
    }

    function fieldControl(key) {
        const marker = embeddedFields.find(item => item.field.key === key)?.targets[0];
        return marker?.querySelector('input, textarea');
    }

    function jumpToField(index) {
        const field = editableFields[index];
        if (!field) return;
        const target = fieldControl(field.key);
        if (target) scrollToFrameElement(target, true);
    }

    async function prepare(event) {
        event?.preventDefault?.();
        if (!editable || locked || busyRef.current) return;
        if (!allFieldsEmbedded) { setError(t('fieldsUnavailable')); return; }
        const missingIndex = (context.fields || []).findIndex(field => field.required !== false && !String(values[field.key] || '').trim());
        if (missingIndex >= 0) {
            setError(`${t('completeFieldBeforeReview')} ${nativeSigningFieldLabel(language, context.fields[missingIndex])}`);
            jumpToField(editableFields.findIndex(field => field.key === context.fields[missingIndex].key));
            return;
        }
        const epoch = epochRef.current;
        busyRef.current = true; setBusy(true); setError(''); setMessage('');
        try {
            const commercialValues = Object.fromEntries((context.fields || []).map(field => [field.key, values[field.key] || '']));
            const next = await nativeContractRequest(id, 'prepare', { values: commercialValues });
            if (epoch !== epochRef.current) return;
            contextRef.current = next; setContext(next); setValues(next.values || {}); setEditing(false);
            pendingJumpRef.current = Boolean(next.canSign);
            dirtyRef.current = false; pendingRef.current = null;
            setMessage(t(next.signingOrder === 'BOOSTER_FIRST' ? 'ownerDetailsSaved' : 'completedAgreementReady'));
        } catch (failure) {
            if (epoch !== epochRef.current || failure.name === 'AbortError') return;
            if ([401, 403, 409].includes(failure.status)) await reloadRef.current?.(true);
            if (epoch === epochRef.current) setError(failure.message);
        } finally { if (epoch === epochRef.current) { busyRef.current = false; setBusy(false); } }
    }

    async function sign(event) {
        event.preventDefault();
        if (archived || ownSignature || (!directSigning && (!context?.canSign || !reviewed)) || busy || busyRef.current) return;
        if (directSigning) {
            if (!frameReady || !allFieldsEmbedded) { setError(t('fieldsUnavailable')); return; }
            const missingField = (context.fields || []).find(field => field.required !== false && !String(values[field.key] || '').trim());
            if (missingField) {
                setError(`${t('completeFieldBeforeReview')} ${nativeSigningFieldLabel(language, missingField)}`);
                jumpToField(editableFields.findIndex(field => field.key === missingField.key));
                return;
            }
            if (missingSignatureRequirements.length) { setError(t('signatureRequired')); return; }
        }
        const epoch = epochRef.current;
        const sessionToken = authStorage.getItem('token');
        const accountId = getStoredUser()?.id;
        let signingContext = context, signAttempted = false;
        controllerRef.current?.abort();
        busyRef.current = true; setBusy(true); setError(''); setMessage('');
        try {
            if (directSigning) {
                const commercialValues = Object.fromEntries((context.fields || []).map(field => [field.key, String(values[field.key] ?? '').normalize('NFC').trim()]));
                const expectedValues = { ...values, ...commercialValues };
                dirtyRef.current = true;
                const prepared = await nativeContractRequest(id, 'prepare', { values: commercialValues });
                if (epoch !== epochRef.current || authStorage.getItem('token') !== sessionToken || getStoredUser()?.id !== accountId || !hasValidSession()) return;
                contextRef.current = prepared; setContext(prepared); setValues(prepared.values || {}); setEditing(false);
                pendingRef.current = null;
                pendingJumpRef.current = true;
                if (!prepared.prepared || !prepared.canSign || prepared.role !== 'company' || prepared.signingOrder !== 'COMPANY_FIRST'
                    || prepared.contract?.id !== contract.id || prepared.documentVersion !== context.documentVersion
                    || !signingValuesMatch(expectedValues, prepared.values)) {
                    dirtyRef.current = false;
                    setError(t('agreementChangedBeforeSigning'));
                    return;
                }
                signingContext = prepared;
            }
            // Only this explicit click authorizes saving the displayed details and
            // signing that exact saved version, using its fresh hash/challenge.
            const intent = uncertain && pendingRef.current ? pendingRef.current
                : signatureSubmission({ context: signingContext, legalName, signature, consent: true }, pendingRef.current);
            pendingRef.current = intent;
            signAttempted = true;
            await nativeContractRequest(id, 'sign', intent.body);
            if (epoch !== epochRef.current) return;
            pendingRef.current = null; setUncertain(false); dirtyRef.current = false;
            const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel(CONTRACT_SIGNING_CHANNEL) : null;
            channel?.postMessage({ id }); channel?.close();
            await reloadRef.current?.(true);
        } catch (failure) {
            if (epoch !== epochRef.current || failure.name === 'AbortError') return;
            setError(failure.message);
            if (signAttempted && (!failure.status || failure.status >= 500)) {
                setUncertain(true);
            } else if (signAttempted || [401, 403, 409].includes(failure.status)) {
                pendingRef.current = null; setUncertain(false);
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

    const companyAction = context?.signingOrder === 'COMPANY_FIRST' ? t('signForFastBoost') : t('countersignForFastBoost');
    const step = archived ? t('archivedAgreement') : completed ? t('agreementCompleted') : ownSignature ? t('signatureRecorded')
        : !context?.prepared ? (company ? t('ownerEnterDetails') : t('waitingForFastBoostDetails'))
            : context?.canSign ? (company ? companyAction : t('reviewAndSign'))
                : company ? t('waitingForBoosterSignature') : t('waitingForFastBoostSignature');
    const showEditor = editable && editing;
    const waitingForOwnerDetails = !archived && !completed && !context?.prepared && !company;
    const waitingForBooster = !archived && !completed && context?.prepared && company && !ownSignature && !context.canSign;
    const waitingForCompany = !archived && !completed && context?.prepared && !company && !ownSignature && !context.canSign && context.signingOrder === 'COMPANY_FIRST';
    const nextMissingIndex = editableFields.findIndex(field => field.required !== false && !String(values[field.key] || '').trim());
    const reviewMount = frameReady && frameDocument.querySelector('[data-native-review-mount]');
    const signatureMount = frameReady && frameDocument.querySelector('[data-native-signature-mount]');
    const signingNoticeMount = frameReady && frameDocument.querySelector('[data-native-signing-notice-mount]');
    const progressComplete = Boolean(ownSignature || completed);
    const showProgress = !archived && !contract?.revokedAt && !['voided', 'declined', 'replaced'].includes(contract?.status)
        && (showEditor || showSignatureForm || progressComplete);
    const progressSteps = [
        ...(company ? editableFields : []).filter(field => field.required !== false).map(field => ({
            id: field.key, label: nativeSigningFieldLabel(language, field), hint: t('requiredField'),
            complete: Boolean(String(values[field.key] || '').trim()),
            onSelect: () => {
                const target = showEditor && fieldControl(field.key);
                scrollToFrameElement(target || embeddedFields.find(item => item.field.key === field.key)?.targets[0], Boolean(target));
            },
        })),
        { id: 'signature', label: t('reviewAndSign'), complete: progressComplete,
            hint: t(uncertain ? 'confirmationInterrupted' : showEditor && nextMissingIndex >= 0 ? 'completeFieldsFirst'
                : showEditor && !directSigning ? 'saveBeforeSigning' : missingSignatureRequirements.length ? 'signatureRequired' : 'confirmSignature'),
            onSelect: () => scrollToFrameElement(progressComplete ? frameDocument?.querySelector(`[data-native-signature-role="${company ? 'COMPANY' : 'BOOSTER'}"]`)
                : showEditor && !directSigning ? reviewMount?.querySelector('button')
                    : signatureMount?.querySelector(missingSignatureRequirements.length && !uncertain
                        ? 'input[name="legalName"], [data-native-signature-drawing]' : 'button[type="submit"]'), !progressComplete),
        },
    ];
    return <div className="native-signing-page">
        <Navbar />
        <header className="native-signing-toolbar">
            <Link to={`/provider/contracts/${encodeURIComponent(id)}`}>{t('backToAgreement')}</Link>
            <div className="native-signing-toolbar-controls">
                {context && !context.legacy && <div className="native-language-toggle" role="group" aria-label={t('readingLanguage')}>
                    <button type="button" aria-pressed={language === 'en'} onClick={() => setLanguage('en')}>EN</button>
                    <button type="button" aria-pressed={language === 'vi'} onClick={() => setLanguage('vi')}>VN</button>
                </div>}
                {context && !context.legacy && <span className={completed ? 'native-signing-status is-complete' : 'native-signing-status'}>{step}</span>}
            </div>
        </header>
        {!context && <div className="native-signing-loading" role={error ? 'alert' : 'status'}>{error || t('loadingAgreement')}</div>}
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
            {error && !(showSignatureForm && signatureMount) && <p className="native-signing-error" role="alert">{error}</p>}
            {message && <p className="native-signing-message" role="status">{message}</p>}
            {archived ? <div className="native-signing-outcome"><h2>{t('archivedAgreement')}</h2><p>{t('archivedDescription')}</p>{contract?.documentAvailable && <button className="native-primary" disabled={busy} onClick={download}>{completed ? t('downloadSignedPdf') : t('downloadPdf')}</button>}</div>
                : completed ? <div className="native-signing-outcome"><h2>{t('allSigned')}</h2><p>{t('bothSignedDescription')}</p><button className="native-primary" disabled={busy} onClick={download}>{t('downloadSignedPdf')}</button></div>
                    : !ownSignature && !waitingForOwnerDetails && !waitingForBooster && !waitingForCompany && !editing && !editable && !context.canSign && <p className="native-signing-unavailable">{t('signUnavailable')}</p>}
            <section className="native-signing-document" aria-label={t('agreementDocument')}>
                {/* The React form portal needs form submission enabled; document scripts stay sandboxed. */}
                {iframeHtml && <iframe ref={iframeRef} key={currentFrameKey} data-frame-key={currentFrameKey} title={t('agreementDocument')} srcDoc={iframeHtml} sandbox="allow-same-origin allow-forms" onLoad={frameLoaded} />}
            </section>
            {showEditor && frameReady && embeddedFields.filter(item => !FIXED_DRAFT_FIELDS.has(item.field.key)).flatMap(({ field, targets }, index) => targets.map((target, targetIndex) => createPortal(targetIndex === 0
                ? <label className="native-inline-field">
                    <span className="fb-sr-only">{nativeSigningFieldLabel(language, field)}</span>
                    {field.maxLength > 150 ? <textarea aria-label={nativeSigningFieldLabel(language, field)} required={field.required !== false} maxLength={field.maxLength || 250} rows={3} disabled={locked} value={values[field.key] || ''} onChange={event => { dirtyRef.current = true; setValues(previous => ({ ...previous, [field.key]: event.target.value })); }} />
                        : <input aria-label={nativeSigningFieldLabel(language, field)} required={field.required !== false} maxLength={field.maxLength || 100} disabled={locked} value={values[field.key] || ''} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); jumpToField(index + 1); } }} onChange={event => { dirtyRef.current = true; setValues(previous => ({ ...previous, [field.key]: event.target.value })); }} />}
                    {nativeSigningFieldHelp(language, field.key) && <small>{nativeSigningFieldHelp(language, field.key)}</small>}
                </label>
                : <span className="native-inline-mirror">{values[field.key] || '—'}</span>, target, `${field.key}-${targetIndex}`)))}
            {showEditor && frameReady && embeddedFields.filter(item => FIXED_DRAFT_FIELDS.has(item.field.key)).flatMap(({ field, targets }) => targets.map((target, index) => createPortal(<span className="native-fixed-value">{field.key === 'ReferenceLanguage' && language === 'vi' && values[field.key] === 'English/Vietnamese' ? 'Tiếng Anh/Tiếng Việt' : values[field.key] || field.defaultValue || '—'}</span>, target, `${field.key}-${index}`)))}
            {showEditor && !directSigning && reviewMount && createPortal(<div className="native-inline-actions"><button type="button" className="native-primary" disabled={locked || !allFieldsEmbedded} onClick={prepare}>{busy ? t('savingAgreement') : t('saveForBoosterReview')}</button></div>, reviewMount)}
            {waitingForOwnerDetails && reviewMount && createPortal(<div className="native-inline-notice"><strong>{t('waitingForFastBoostDetails')}</strong><p>{t('ownerDetailsDescription')}</p></div>, reviewMount)}
            {waitingForBooster && !editing && signingNoticeMount && createPortal(<div className="native-inline-notice"><strong>{t('waitingForBoosterSignature')}</strong><p>{t('companyCountersignsSecond')}</p>{editable && <button type="button" className="native-text-button" disabled={locked} onClick={() => { dirtyRef.current = true; setEditing(true); setMessage(''); }}>{t('editAgreementDetails')}</button>}</div>, signingNoticeMount)}
            {waitingForCompany && !editing && signingNoticeMount && createPortal(<div className="native-inline-notice"><strong>{t('waitingForFastBoostSignature')}</strong><p>{t('boosterSignsAfterFastBoost')}</p>{editable && <button type="button" className="native-text-button" disabled={locked} onClick={() => { dirtyRef.current = true; setEditing(true); setMessage(''); }}>{t('editAgreementDetails')}</button>}</div>, signingNoticeMount)}
            {showSignatureForm && signatureMount && createPortal(<form className="native-signature-form" aria-label={t('yourSignature')} onSubmit={sign}>
                <div className="native-signature-box">
                    <div className="native-signature-options" data-method={signature.type} role="group" aria-label={t('signatureMethod')}>
                        {['typed', 'drawn'].map(type => <button key={type} type="button" disabled={locked} aria-pressed={signature.type === type} onClick={() => {
                            if (locked) return;
                            setSignature(previous => ({ ...previous, type }));
                            if (type === 'drawn' || !legalName.trim()) setLegalName(assignedLegalName);
                            pendingRef.current = null;
                        }}>{t(type === 'typed' ? 'autoSignature' : 'drawSignature')}</button>)}
                    </div>
                    {signature.type === 'typed' && <div className="native-signature-styles" data-style={signature.style || 1} role="group" aria-label={t('signatureTextStyle')}>
                        {[t('originalSignature'), 'Dancing Script', 'Great Vibes'].map((font, index) => <button key={font} type="button" title={font} aria-label={`${t('signatureStyle')} ${index + 1}`} aria-pressed={(signature.style || 1) === index + 1} disabled={locked} onClick={() => {
                            if (locked) return;
                            setSignature(previous => ({ ...previous, style: index + 1 }));
                            if (!legalName.trim()) setLegalName(assignedLegalName);
                            pendingRef.current = null;
                        }}>{index + 1}</button>)}
                    </div>}
                    {signature.type === 'typed' ? <label className="native-signature-name"><span className="fb-sr-only">{t('fullLegalName')}</span><input name="legalName" data-signature-style={signature.style || 1} autoComplete="name" placeholder={t('typeFullName')} required minLength={2} maxLength={100} disabled={locked} value={legalName} onFocus={() => { if (!locked && !legalName.trim()) { setLegalName(assignedLegalName); pendingRef.current = null; } }} onChange={event => { setLegalName(event.target.value); pendingRef.current = null; }} /></label>
                        : <ContractSignaturePad signature={signature} disabled={locked} label={t('drawYourSignature')} clearLabel={t('clearSignature')} onChange={next => { setSignature(previous => ({ ...next, style: previous.style || 1 })); pendingRef.current = null; }} />}
                </div>
                {error && <p className="native-signing-error" role="alert">{error}</p>}
                {uncertain && <div className="native-signing-pending" role="status"><p>{t('confirmationInterrupted')}</p><button type="button" disabled={busy} onClick={() => reloadRef.current?.(true)}>{t('checkSigningStatus')}</button></div>}
                <button type="submit" className="native-primary" disabled={busy || (!uncertain && missingSignatureRequirements.length > 0)}>{busy ? t('recordingSignature') : uncertain ? t('retrySignature') : t('signAgreement')}</button>
                {editable && !editing && <button type="button" className="native-text-button" disabled={locked} onClick={() => { dirtyRef.current = true; setEditing(true); setMessage(''); }}>{t('editAgreementDetails')}</button>}
            </form>, signatureMount)}
            {showProgress && <NativeSigningProgress key={id} language={language} steps={progressSteps} complete={progressComplete}
                completeDescription={t(completed ? 'bothSignedDescription' : 'signatureSaved')}
                disabled={busy || !frameReady || (showEditor && !allFieldsEmbedded)} frameDocument={frameDocument} />}
        </main>}
    </div>;
}
