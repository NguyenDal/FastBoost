import { useState } from 'react';
import { operations } from '../api/operations';

const AGREEMENT = 'BOOSTER_SERVICE_AGREEMENT';
const PAYOUT_INFORMATION = 'PAYOUT_INFORMATION';

export default function BoosterDocumentForm({ boosterId, configured, suspended, reload, onError }) {
    const [documentType, setDocumentType] = useState(AGREEMENT);
    const [busy, setBusy] = useState(false);
    const [requestId, setRequestId] = useState(() => crypto.randomUUID());
    const agreement = documentType === AGREEMENT;
    const locked = busy || Boolean(suspended);

    function selectDocument(event) {
        setDocumentType(event.target.value);
        onError('');
    }

    async function submit(event) {
        event.preventDefault();
        if (!agreement || !configured || locked) return;
        const form = event.currentTarget;
        const body = new FormData(form);
        setBusy(true);
        onError('');
        try {
            await operations(`/boosters/${boosterId}/contracts`, {
                requestId,
                documentType,
                title: 'Booster Service Agreement',
                startsAt: body.get('startsAt'),
                signerName: body.get('signerName'),
            });
            form.reset();
            setRequestId(crypto.randomUUID());
            reload();
        } catch (error) {
            onError(error.message);
            reload();
        } finally {
            setBusy(false);
        }
    }

    return <form className="ops-form" onSubmit={submit} aria-busy={busy}>
        <label>Document type<select name="documentType" value={documentType} onChange={selectDocument} disabled={locked}>
            <option value={AGREEMENT}>Booster Service Agreement</option>
            <option value={PAYOUT_INFORMATION}>Payout Information (to be implemented)</option>
        </select></label>
        {agreement ? <>
            <label>Start date<input key="startsAt" type="date" name="startsAt" required disabled={locked} /></label>
            <label>Signer’s full legal name<input name="signerName" required minLength={2} maxLength={100} disabled={locked} /></label>
        </> : <>
            <label>Effective date<input key="effectiveAt" type="date" name="effectiveAt" disabled={locked} /></label>
            <p role="status" style={{ gridColumn: '1 / -1', margin: 0 }}>Payout Information is not implemented yet.</p>
        </>}
        <button className="ops-primary" disabled={!agreement || !configured || locked}>{busy ? 'Sending…' : 'Send agreement'}</button>
    </form>;
}
