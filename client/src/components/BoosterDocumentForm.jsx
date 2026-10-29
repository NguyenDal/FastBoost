import { useRef, useState } from 'react';
import { operations } from '../api/operations';

const AGREEMENT = 'BOOSTER_SERVICE_AGREEMENT';
const PAYOUT_INFORMATION = 'PAYOUT_INFORMATION';

export default function BoosterDocumentForm({ boosterId, configured, payoutConfigured, suspended, reload, onError }) {
    const [documentType, setDocumentType] = useState(AGREEMENT);
    const [busy, setBusy] = useState(false);
    const [requestId, setRequestId] = useState(() => crypto.randomUUID());
    const [notice, setNotice] = useState('');
    const inFlight = useRef(false);
    const agreement = documentType === AGREEMENT;
    const locked = busy || Boolean(suspended);

    function selectDocument(event) {
        setDocumentType(event.target.value);
        setRequestId(crypto.randomUUID());
        setNotice('');
        onError('');
    }

    async function submit(event) {
        event.preventDefault();
        if (!(agreement ? configured : payoutConfigured) || locked || inFlight.current) return;
        const form = event.currentTarget;
        const body = new FormData(form);
        setBusy(true);
        inFlight.current = true;
        setNotice('');
        onError('');
        try {
            if (agreement) await operations(`/boosters/${boosterId}/contracts`, {
                requestId,
                documentType,
                title: 'Booster Service Agreement',
                startsAt: body.get('startsAt'),
                signerName: body.get('signerName'),
            });
            else await operations(`/boosters/${boosterId}/payout-information`, { requestId, country: body.get('country') });
            form.reset();
            setRequestId(crypto.randomUUID());
            setNotice(agreement ? 'Agreement sent.' : 'Payout information is available in the booster’s Documents.');
            reload();
        } catch (error) {
            onError(error.message);
            reload();
        } finally {
            inFlight.current = false;
            setBusy(false);
        }
    }

    return <form className="ops-form" onSubmit={submit} aria-busy={busy}>
        <label>Document type<select name="documentType" value={documentType} onChange={selectDocument} disabled={locked}>
            <option value={AGREEMENT}>Booster Service Agreement</option>
            <option value={PAYOUT_INFORMATION}>Payout Information</option>
        </select></label>
        {agreement ? <>
            <label>Start date<input key="startsAt" type="date" name="startsAt" required disabled={locked} /></label>
            <label>Signer’s full legal name<input name="signerName" required minLength={2} maxLength={100} disabled={locked} /></label>
        </> : <>
            <label>Bank country<select name="country" required defaultValue="" disabled={locked}>
                <option value="" disabled>Select country</option><option value="US">United States</option><option value="VN">Vietnam</option>
            </select></label>
            <p style={{ gridColumn: '1 / -1', margin: 0, color: '#aeb9ce', lineHeight: 1.6 }}>Request private bank details for Remitly deposits.</p>
            {payoutConfigured === false && <p role="status" style={{ gridColumn: '1 / -1', margin: 0 }}>Payout information is temporarily unavailable.</p>}
        </>}
        <button className="ops-primary" disabled={!(agreement ? configured : payoutConfigured) || locked}>{busy ? 'Sending…' : agreement ? 'Send agreement' : 'Request payout details'}</button>
        {notice && <p role="status" style={{ gridColumn: '1 / -1', margin: 0 }}>{notice}</p>}
    </form>;
}
