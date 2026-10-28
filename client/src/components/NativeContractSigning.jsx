import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import Navbar from './Navbar';
import ContractSignaturePad from './ContractSignaturePad';
import { nativeContractRequest } from '../api/nativeContracts';
import { downloadContract } from '../api/operations';
import { authStorage } from '../utils/authStorage';
import { clearExpiredSession, getStoredUser, hasValidSession } from '../utils/authSession';
import { agreementSigningPath, signatureMissingRequirements, signatureSubmission, signingValuesMatch } from '../utils/nativeSigning';
import { translateAgreementHtml } from '../utils/translateAgreementHtml';
import { nativeSigningText, nativeSigningFieldLabel, nativeSigningFieldHelp } from '../utils/nativeSigningI18n';
import { CONTRACT_SIGNING_CHANNEL } from '../utils/contractSigning';
import '../styles/NativeContractSigning.css';

const emptyDrawing = () => ({ type: 'drawn', width: 600, height: 180, strokes: [] });
const companySigned = context => Boolean(context?.contract?.companySignedAt || context?.signatures?.some(signature => signature.role === 'COMPANY'));
const FIXED_DRAFT_FIELDS = new Set(['ReferenceLanguage']);

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
    const [frameDocument, setFrameDocument] = useState(null);
    const [loadedFrameKey, setLoadedFrameKey] = useState('');
    const [activeFieldIndex, setActiveFieldIndex] = useState(-1);
    const [language, setLanguage] = useState('en');
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
                const changed = next.documentHash !== contextRef.current?.documentHash;
                contextRef.current = next; setContext(next);
                setValues({ ...next.values, ...(!next.prepared ? { ReferenceLanguage: 'English/Vietnamese' } : {}) });
                setEditing(next.role === 'company' && !next.prepared && next.canPrepare === true);
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
                controllerRef.current?.abort(); pendingRef.current = null; pendingJumpRef.current = false; contextRef.current = null;
                dirtyRef.current = false; busyRef.current = false;
                setContext(null); setValues({}); setFrameDocument(null); setLoadedFrameKey(''); setActiveFieldIndex(-1);
                setLegalName(''); setInitials(''); setSignature({ type: 'typed' });
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
    const editable = company && context?.canPrepare === true && !archived && !context?.legacy && !completed && !companySigned(context) && !contract?.revokedAt
        && !['voided', 'declined', 'replaced'].includes(contract?.status);
    const reviewed = context?.prepared && !editing && signingValuesMatch(values, context.values);
    const ownSignature = context?.signatures?.find(item => item.role === (company ? 'COMPANY' : 'BOOSTER'));
    const locked = busy || uncertain;
    const t = key => nativeSigningText(language, key);
    const missingSignatureRequirements = signatureMissingRequirements({ legalName, initials, signature, consent });
    const signatureRequirementText = { legalName: 'signatureNameRequired', initials: 'signatureInitialsRequired', signature: 'signatureDrawingRequired', consent: 'signatureConsentRequired' };
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
    }, [frameDocument, frameReady, editable, editing, signature.type, uncertain, reviewed, context?.canSign, error, missingSignatureRequirements.length]);

    useEffect(() => {
        if (!frameReady || !reviewed || !context?.canSign || !pendingJumpRef.current) return;
        const timer = window.setTimeout(() => {
            const target = frameDocument.querySelector('[data-native-signature-mount] input[name="legalName"]');
            if (target) { scrollToFrameElement(target, true); pendingJumpRef.current = false; }
        }, 80);
        return () => window.clearTimeout(timer);
    // The jump is intentionally tied to the new iframe after preparation.
    }, [frameDocument, frameReady, reviewed, context?.canSign]);

    function frameLoaded(event) {
        const doc = event.currentTarget.contentDocument;
        if (!doc) { setError(t('fieldsUnavailable')); return; }
        doc.body.classList.add('fb-signing');
        const schedule = doc.getElementById('schedule-a');
        const signatures = doc.getElementById('signatures');
        if (!schedule || !signatures) { setError(t('fieldsUnavailable')); return; }
        if (editable && editing) {
            const visibleKeys = new Set([...doc.querySelectorAll('[data-native-field]')].map(node => node.getAttribute('data-native-field')));
            if ((context.fields || []).some(field => !visibleKeys.has(field.key))) setError(t('fieldsUnavailable'));
        }
        const reviewMount = doc.createElement('div'); reviewMount.dataset.nativeReviewMount = '';
        schedule.append(reviewMount);
        const signatureMount = doc.createElement('div'); signatureMount.dataset.nativeSignatureMount = '';
        signatures.querySelector('.fb-signatures')?.before(signatureMount);
        if (!signatureMount.parentNode) signatures.append(signatureMount);
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
        setActiveFieldIndex(index);
        const target = fieldControl(field.key);
        if (target) scrollToFrameElement(target, true);
    }

    function jumpToNextField() {
        const focusedKey = frameDocument?.activeElement?.closest?.('[data-native-field]')?.getAttribute('data-native-field');
        const focusedIndex = editableFields.findIndex(field => field.key === focusedKey);
        const currentIndex = focusedIndex >= 0 ? focusedIndex : activeFieldIndex;
        const nextIndex = currentIndex + 1;
        if (nextIndex < editableFields.length) jumpToField(nextIndex);
        else scrollToFrameElement(frameDocument?.querySelector('[data-native-review-mount] button'), true);
    }

    function jumpToNextBlank() {
        const fields = editableFields;
        const next = fields.findIndex(field => field.required !== false && !String(values[field.key] || '').trim());
        if (next >= 0) jumpToField(next);
        else scrollToFrameElement(frameDocument?.querySelector('[data-native-review-mount] button'), true);
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
            contextRef.current = next; setContext(next); setValues(next.values || {}); setEditing(false); setConsent(false);
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
            setMessage(t('signatureRecordedMessage'));
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

    const companyAction = context?.signingOrder === 'COMPANY_FIRST' ? t('signForFastBoost') : t('countersignForFastBoost');
    const step = archived ? t('archivedAgreement') : completed ? t('agreementCompleted') : ownSignature ? t('signatureRecorded')
        : !context?.prepared ? (company ? t('ownerEnterDetails') : t('waitingForFastBoostDetails'))
            : context?.canSign ? (company ? companyAction : t('reviewAndSign'))
                : company ? t('waitingForBoosterSignature') : t('waitingForFastBoostSignature');
    const showEditor = editable && editing;
    const showSignatureForm = reviewed && context?.canSign && !ownSignature && !archived;
    const waitingForOwnerDetails = !archived && !completed && !context?.prepared && !company;
    const waitingForBooster = !archived && !completed && context?.prepared && company && !ownSignature && !context.canSign;
    const waitingForCompany = !archived && !completed && context?.prepared && !company && !ownSignature && !context.canSign && context.signingOrder === 'COMPANY_FIRST';
    const nextMissingIndex = editableFields.findIndex(field => field.required !== false && !String(values[field.key] || '').trim());
    const reviewMount = frameReady && frameDocument.querySelector('[data-native-review-mount]');
    const signatureMount = frameReady && frameDocument.querySelector('[data-native-signature-mount]');
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
                    : ownSignature ? <div className="native-signing-outcome"><h2>{t('thankYou')}</h2><p>{company ? t('boosterCanReview') : t('companyCanCountersign')}</p><Link to={`/provider/contracts/${encodeURIComponent(id)}`}>{t('returnToAgreement')}</Link></div>
                        : !waitingForOwnerDetails && !waitingForBooster && !waitingForCompany && !editing && !editable && !context.canSign && <p className="native-signing-unavailable">{t('signUnavailable')}</p>}
            <section className="native-signing-document" aria-label={t('agreementDocument')}>
                {/* The React form portal needs form submission enabled; document scripts stay sandboxed. */}
                {iframeHtml && <iframe ref={iframeRef} key={currentFrameKey} data-frame-key={currentFrameKey} title={t('agreementDocument')} srcDoc={iframeHtml} sandbox="allow-same-origin allow-forms" onLoad={frameLoaded} />}
            </section>
            {showEditor && frameReady && embeddedFields.filter(item => !FIXED_DRAFT_FIELDS.has(item.field.key)).flatMap(({ field, targets }, index) => targets.map((target, targetIndex) => createPortal(targetIndex === 0
                ? <label className="native-inline-field">
                    <span className="fb-sr-only">{nativeSigningFieldLabel(language, field)}</span>
                    {field.maxLength > 150 ? <textarea aria-label={nativeSigningFieldLabel(language, field)} required={field.required !== false} maxLength={field.maxLength || 250} rows={3} disabled={locked} value={values[field.key] || ''} onFocus={() => setActiveFieldIndex(index)} onChange={event => { dirtyRef.current = true; setConsent(false); setValues(previous => ({ ...previous, [field.key]: event.target.value })); }} />
                        : <input aria-label={nativeSigningFieldLabel(language, field)} required={field.required !== false} maxLength={field.maxLength || 100} disabled={locked} value={values[field.key] || ''} onFocus={() => setActiveFieldIndex(index)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); jumpToField(index + 1); } }} onChange={event => { dirtyRef.current = true; setConsent(false); setValues(previous => ({ ...previous, [field.key]: event.target.value })); }} />}
                    {nativeSigningFieldHelp(language, field.key) && <small>{nativeSigningFieldHelp(language, field.key)}</small>}
                </label>
                : <span className="native-inline-mirror">{values[field.key] || '—'}</span>, target, `${field.key}-${targetIndex}`)))}
            {showEditor && frameReady && embeddedFields.filter(item => FIXED_DRAFT_FIELDS.has(item.field.key)).flatMap(({ field, targets }) => targets.map((target, index) => createPortal(<span className="native-fixed-value">{field.key === 'ReferenceLanguage' && language === 'vi' && values[field.key] === 'English/Vietnamese' ? 'Tiếng Anh/Tiếng Việt' : values[field.key] || field.defaultValue || '—'}</span>, target, `${field.key}-${index}`)))}
            {showEditor && reviewMount && createPortal(<div className="native-inline-actions"><button type="button" className="native-primary" disabled={locked || !allFieldsEmbedded} onClick={prepare}>{busy ? t('savingAgreement') : t('reviewCompletedAgreement')}</button></div>, reviewMount)}
            {waitingForOwnerDetails && reviewMount && createPortal(<div className="native-inline-notice"><strong>{t('waitingForFastBoostDetails')}</strong><p>{t('ownerDetailsDescription')}</p></div>, reviewMount)}
            {waitingForBooster && !editing && signatureMount && createPortal(<div className="native-inline-notice"><strong>{t('waitingForBoosterSignature')}</strong><p>{t('companyCountersignsSecond')}</p>{editable && <button type="button" className="native-text-button" disabled={locked} onClick={() => { dirtyRef.current = true; setEditing(true); setMessage(''); }}>{t('editAgreementDetails')}</button>}</div>, signatureMount)}
            {waitingForCompany && !editing && signatureMount && createPortal(<div className="native-inline-notice"><strong>{t('waitingForFastBoostSignature')}</strong><p>{t('boosterSignsAfterFastBoost')}</p>{editable && <button type="button" className="native-text-button" disabled={locked} onClick={() => { dirtyRef.current = true; setEditing(true); setMessage(''); }}>{t('editAgreementDetails')}</button>}</div>, signatureMount)}
            {showSignatureForm && signatureMount && createPortal(<form className="native-signature-form" onSubmit={sign}>
                <h3>{company ? companyAction : t('yourSignature')}</h3>
                <p>{t('reviewBeforeSigning')}</p>
                {editable && <button type="button" className="native-text-button" disabled={locked} onClick={() => { dirtyRef.current = true; setEditing(true); setConsent(false); setMessage(''); }}>{t('editAgreementDetails')}</button>}
                <label>{t('fullLegalName')}<input name="legalName" autoComplete="name" required minLength={2} maxLength={100} disabled={locked} value={legalName} onChange={event => { setLegalName(event.target.value); pendingRef.current = null; }} /></label>
                <label>{t('scheduleInitials')}<input name="initials" required minLength={1} maxLength={12} disabled={locked} value={initials} onChange={event => { setInitials(event.target.value); pendingRef.current = null; }} /></label>
                <fieldset className="native-signature-method" disabled={locked}><legend>{t('signature')}</legend><div>
                    <label><input type="radio" name="signature-method" checked={signature.type === 'typed'} onChange={() => setSignature({ type: 'typed' })} />{t('type')}</label>
                    <label><input type="radio" name="signature-method" checked={signature.type === 'drawn'} onChange={() => setSignature(emptyDrawing())} />{t('draw')}</label>
                </div></fieldset>
                {signature.type === 'typed' ? <div className="native-typed-signature" aria-label={t('typedSignaturePreview')}>{legalName || t('yourSignature')}</div> : <ContractSignaturePad signature={signature} disabled={locked} onChange={next => { setSignature(next); pendingRef.current = null; }} />}
                {language === 'vi' && <><p className="native-consent-label">{t('viewEnglishConsent')}</p><p className="native-consent-translation">{t('consentVietnameseExplanation')}</p></>}
                <label className="native-signing-consent"><input type="checkbox" checked={consent} required disabled={locked} onChange={event => setConsent(event.target.checked)} /><span>{context.consentText}</span></label>
                <p className="native-signing-privacy">{t('signaturePrivacy')}</p>
                {!uncertain && missingSignatureRequirements.length > 0 && <p id="native-signature-requirements" className="native-signing-requirements" role="status">{t('signingRequirements')} {missingSignatureRequirements.map(key => t(signatureRequirementText[key])).join('; ')}.</p>}
                {error && <p className="native-signing-error" role="alert">{error}</p>}
                {uncertain && <div className="native-signing-pending" role="status"><p>{t('confirmationInterrupted')}</p><button type="button" disabled={busy} onClick={() => reloadRef.current?.(true)}>{t('checkSigningStatus')}</button></div>}
                <button type="submit" className="native-primary" aria-describedby={!uncertain && missingSignatureRequirements.length ? 'native-signature-requirements' : undefined} disabled={busy || (!uncertain && missingSignatureRequirements.length > 0)}>{busy ? t('recordingSignature') : uncertain ? t('retrySignature') : t('signAgreement')}</button>
            </form>, signatureMount)}
            {showEditor && <div className="native-signing-guide" role="navigation" aria-label={t('formNavigation')}>
                <span>{activeFieldIndex >= 0 ? `${activeFieldIndex + 1} / ${editableFields.length}` : t('ownerEnterDetails')}</span>
                <button type="button" disabled={!frameReady || !allFieldsEmbedded} onClick={jumpToNextField}>{t('nextField')}</button>
                <button type="button" disabled={!frameReady || !allFieldsEmbedded || locked} onClick={nextMissingIndex >= 0 ? jumpToNextBlank : prepare}>{nextMissingIndex >= 0 ? t('nextBlankField') : t('reviewCompletedAgreement')}</button>
            </div>}
            {showSignatureForm && <div className="native-signing-guide" role="navigation" aria-label={t('formNavigation')}><span>{t('reviewAndSign')}</span><button type="button" onClick={() => scrollToFrameElement(frameDocument?.querySelector('[data-native-signature-mount] input[name="legalName"]'), true)}>{t('jumpToSignature')}</button></div>}
        </main>}
    </div>;
}
