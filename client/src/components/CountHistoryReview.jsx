import { useState } from 'react';
import { operations, money } from '../api/operations';
import { ContributionRow } from '../pages/OperationsPages';
import '../styles/Operations.css';

export default function CountHistoryReview({ data, reload }) {
    const [boosterId, setBoosterId] = useState('');
    const [matches, setMatches] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const review = data.countReview;
    const records = new Map(review.assignments.map(record => [record.boosterId, record]));
    for (const record of review.records) records.set(record.boosterId, record);
    const available = data.boosters.filter(person => {
        const record = records.get(person.id);
        return record?.submittedMatches == null || (record.reviewedAt && record.approvedMatches == null);
    });
    async function approve(event) {
        event.preventDefault(); setBusy(true); setError('');
        try {
            await operations(`/match-history/${data.order.id}/manual-count`, {
                boosterId, matches: Number(matches), revision: records.get(boosterId)?.revision || 0,
            });
            setBoosterId(''); setMatches('');
            await reload();
        } catch (e) { setError(e.message); } finally { setBusy(false); }
    }
    return <div className="ops-page mh-count-review">
        <h3>Match approval</h3>
        {[...records.values()].map(record => <ContributionRow key={`${record.boosterId}-${record.revision || 0}-${record.reviewedAt || ''}`} order={data.order} record={record} admin readOnly={!review.canEdit} reload={reload} />)}
        {review.canEdit && <form className="mh-manual-count" onSubmit={approve}>
            <p>Enter a match count on behalf of a booster who hasn’t submitted.</p>
            <div className="ops-actions"><label>Booster<select required value={boosterId} disabled={busy} onChange={event => setBoosterId(event.target.value)}><option value="">Select booster</option>{available.map(person => <option key={person.id} value={person.id}>{person.username}</option>)}</select></label>
                <label>Matches played<input required type="number" min="0" max="10000" step="1" value={matches} disabled={busy} onChange={event => setMatches(event.target.value)} /></label>
                <button className="ops-primary" disabled={busy || !boosterId || matches === ''}>{busy ? 'Saving…' : 'Approve manual count'}</button></div>
            {!available.length && <p>All available boosters already have a count submitted or approved.</p>}
            {error && <p className="ops-error" role="alert">{error}</p>}
        </form>}
        {data.earnings && <div className="mh-earnings"><h3>Booster earnings pool <span>{money(data.earnings.boosterCents, data.earnings.currency)}</span></h3>{data.earnings.shares.map(share => <div className="mh-share" key={share.boosterId}><span>{records.get(share.boosterId)?.booster?.username || 'Booster'} · {share.matches} matches</span><strong>{money(share.cents, data.earnings.currency)}</strong></div>)}</div>}
    </div>;
}
