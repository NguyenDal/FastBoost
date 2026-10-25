import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { operations, downloadContract, date, tenure } from '../api/operations';
import { loadChampions } from '../api/champions';
import BoosterPreferenceSummary from '../components/BoosterPreferenceSummary';
import BoosterDocumentForm from '../components/BoosterDocumentForm';
import OrderPagination from '../components/OrderPagination';
import Navbar from '../components/Navbar';
import { getStoredUser } from '../utils/authSession';
import { CONTRACT_SIGNING_CHANNEL } from '../utils/contractSigning';
import { agreementSigningPath } from '../utils/nativeSigning';
import '../styles/Operations.css';

function useData(path) {
    const [state, setState] = useState({ data: null, error: '' });
    const [version, setVersion] = useState(0);
    useEffect(() => {
        let cancelled = false;
        operations(path).then(data => { if (!cancelled) setState({ path, data, error: '' }); })
            .catch(error => { if (!cancelled) setState(previous => ({ path, data: previous.path === path ? previous.data : null, error: error.message })); });
        return () => { cancelled = true; };
    }, [path, version]);
    const reload = useCallback(() => setVersion(v => v + 1), []);
    return { data: state.path === path ? state.data : null, error: state.path === path ? state.error : '', reload };
}
function Heading({ title, children }) { return <header className="ops-heading"><h1>{title}</h1><div>{children}</div></header>; }
function Feedback({ error, loading }) { return error ? <p className="ops-error" role="alert">{error}</p> : loading ? <p role="status">Loading…</p> : null; }

export function ContributionRow({ order, record, admin, readOnly = false, reload }) {
    const [matches, setMatches] = useState(record.submittedMatches ?? '');
    const [note, setNote] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    async function submit(decision) {
        setBusy(true); setError('');
        try {
            if (admin) await operations(`/contributions/${order.id}/${record.boosterId}/review`, { revision: record.revision, decision, note });
            else await operations(`/contributions/${order.id}`, { matches: Number(matches) });
            reload();
        } catch (e) { setError(e.message); } finally { setBusy(false); }
    }
    const approved = record.approvedMatches != null;
    return <div className="ops-contribution"><div><strong>{admin ? record.booster?.username || 'Booster' : `#${order.orderNumber}`}</strong><small>{admin ? `#${order.orderNumber}` : order.boostType}</small></div>
        <span className={`ops-badge ${approved ? 'approved' : ''}`}>{approved ? `${record.approvedMatches} matches approved` : record.reviewedAt ? 'Changes requested' : record.submittedMatches != null ? `${record.submittedMatches} matches · Pending` : 'Not submitted'}</span>
        {record.reviewNote && <p>{record.reviewNote}</p>}
        {admin ? !readOnly && record.submittedMatches != null && !record.reviewedAt && <div className="ops-actions"><button disabled={busy} onClick={() => submit('approve')}>Approve {record.submittedMatches} matches</button><input aria-label="Correction note" placeholder="Reason for correction" maxLength={500} value={note} onChange={e => setNote(e.target.value)} /><button disabled={busy || !note.trim()} onClick={() => submit('return')}>Request correction</button></div> : <form className="ops-actions" onSubmit={e => { e.preventDefault(); submit(); }}><label>Matches played<input type="number" min="0" max="10000" step="1" required value={matches} onChange={e => setMatches(e.target.value)} /></label><button disabled={busy || matches === ''}>{busy ? 'Submitting…' : 'Submit for approval'}</button></form>}
        <Feedback error={error} /></div>;
}
export function Contributions({ admin = false, onChange }) {
    const [filter, setFilter] = useState('');
    const [page, setPage] = useState(1);
    const { data, error, reload } = useData(`/contributions?scope=${admin ? 'all' : 'mine'}&page=${page}&q=${encodeURIComponent(filter.trim())}`);
    return <section className="ops-card ops-contributions"><h2>{admin ? 'Match reviews' : 'Your match contributions'}</h2><p>Admin-approved matches determine each booster’s share of the 70% pool.</p><input className="ops-search" aria-label="Find order" placeholder="Find order number…" maxLength={100} value={filter} onChange={e => { setFilter(e.target.value); setPage(1); }} /><Feedback error={error} loading={!data} />
        <div id={admin ? 'team-contributions-list' : 'personal-contributions-list'} aria-busy={!data && !error}>
        {data?.orders.map(order => {
            if (order.matchHistoryEnabled) return <Link className="ops-contract-link" key={order.id} to={`/match/${order.id}?tab=history`}><span>#{order.orderNumber}<small>{order.boostType}</small></span><span className={`ops-badge ${order.matchHistoryConfirmedAt ? 'approved' : ''}`}>{order.matchHistoryConfirmedAt ? 'Confirmed' : 'Review matches'} →</span></Link>;
            const records = new Map(order.assignments.map(a => [a.boosterId, a]));
            for (const record of order.contributions) records.set(record.boosterId, record);
            return [...records.values()].map(record => <ContributionRow key={`${order.id}-${record.boosterId}-${record.revision || 0}-${record.reviewedAt || ''}`} order={order} record={record} admin={admin} reload={() => { reload(); onChange?.(); }} />);
        })}
        {data?.orders.length === 0 && <div className="ops-empty">{filter.trim() ? 'No orders match your search.' : admin ? 'No orders to review yet.' : 'No assigned orders to review yet.'}</div>}
        </div>
        {data?.total > 0 && <div className="ops-contributions-pagination"><p role="status">Showing {(data.page - 1) * data.pageSize + 1}–{Math.min(data.page * data.pageSize, data.total)} of {data.total} orders · {data.pageSize} per page</p><OrderPagination currentPage={data.page} totalPages={data.totalPages} onPageChange={setPage} tableId={admin ? 'team-contributions-list' : 'personal-contributions-list'} label={admin ? 'Match review pages' : 'Your match contribution pages'} /></div>}
        </section>;
}

function BoosterRating({ rating }) {
    const available = rating?.available === true && Number.isInteger(rating.count) && rating.count >= 0
        && (rating.count === 0 || (Number.isFinite(rating.average) && rating.average >= 0 && rating.average <= 5));
    const average = available && rating.count > 0 ? rating.average : 0;
    return <span className="ops-booster-rating"><span className="ops-booster-rating-divider" aria-hidden="true">|</span>{available ? <>
        <span className="ops-booster-rating-stars" aria-hidden="true">★★★★★<span style={{ width: `${average / 5 * 100}%` }}>★★★★★</span></span>
        <span>{average.toFixed(1)}/5</span><span className="ops-booster-rating-count">({rating.count} {rating.count === 1 ? 'review' : 'reviews'})</span>
    </> : <span className="ops-booster-rating-count">Rating unavailable</span>}</span>;
}
function BoosterDetails({ booster, champions, preferencesAvailable, reload, configured, onError }) {
    return <details className="ops-card ops-booster"><summary><span className="ops-avatar">{(booster.profile?.displayName || booster.username || 'B')[0]}</span><span className="ops-booster-identity"><span className="ops-booster-title"><strong>{booster.profile?.displayName || booster.username}</strong><BoosterRating rating={booster.rating} /></span><small>{tenure(booster.boosterProfile?.startedAt)}</small></span>{booster.suspendedAt && <span className="ops-badge">Suspended</span>}<BoosterPreferenceSummary preferences={booster.preferences} champions={champions} available={preferencesAvailable} /><svg className="ops-booster-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg></summary>
        <div className="ops-detail">
            <h3>Send a document</h3><BoosterDocumentForm boosterId={booster.id} configured={configured} suspended={booster.suspendedAt} reload={reload} onError={onError} />
            <h3>Documents</h3>{booster.boosterContracts.length ? booster.boosterContracts.map(c => <Link className="ops-contract-link" to={`/provider/contracts/${c.id}`} key={c.id}><span>{c.title}<small>{date(c.createdAt)}</small></span><span className={`ops-badge ${c.signedAt ? 'approved' : ''}`}>{c.archivedAt ? 'Archived' : c.signedAt ? `Signed ${date(c.signedAt)}` : c.signingProvider === 'FASTBOOST' ? !c.documentAvailable ? 'Complete agreement' : !c.boosterSignedAt ? 'Awaiting booster' : 'Awaiting FastBoost' : 'Awaiting signature'} →</span></Link>) : <p>No documents sent yet.</p>}</div>
    </details>;
}
export function BoosterManagementPage() {
    const { data, error, reload } = useData('/boosters');
    const { data: signing } = useData('/contracts/configuration');
    const [query, setQuery] = useState('');
    const [actionError, setActionError] = useState('');
    const [champions, setChampions] = useState([]);
    const needsChampions = data?.boosters.some(booster => booster.preferences?.championIds?.length > 0) || false;
    useEffect(() => {
        if (!needsChampions) return;
        let active = true;
        loadChampions().then(catalog => { if (active) setChampions(catalog); }).catch(() => {
            // Keep saved champion names visible as initials if the catalog is unavailable.
        });
        return () => { active = false; };
    }, [needsChampions]);
    const championsById = new Map(champions.map(champion => [champion.id, champion]));
    return <div className="ops-page"><Heading title="Booster Management">Your team and documents in one place.</Heading><Feedback error={error || actionError} loading={!data} />
        <div className="ops-toolbar"><h2 className="ops-team-heading">Your team {data && <span className="ops-team-count" aria-label={`${data.boosters.length} ${data.boosters.length === 1 ? 'booster' : 'boosters'}`}>{data.boosters.length}</span>}</h2><input aria-label="Search boosters" placeholder="Search boosters…" value={query} onChange={e => setQuery(e.target.value)} /></div>
        {data?.boosters.filter(b => `${b.username} ${b.email} ${b.profile?.displayName || ''}`.toLowerCase().includes(query.toLowerCase())).map(b => <BoosterDetails key={b.id} booster={b} champions={championsById} preferencesAvailable={data.preferencesAvailable} reload={reload} configured={signing?.configured} onError={setActionError} />)}
        {data?.boosters.length === 0 && <section className="ops-card ops-empty">Add booster access in <Link to="/admin/accounts">Account Management</Link> to grow your team.</section>}</div>;
}
export function BoosterContractPage() {
    const { id } = useParams();
    const navigate = useNavigate();
    const { data, error, reload } = useData(`/contracts/${id}`);
    const [actionError, setActionError] = useState('');
    const [busy, setBusy] = useState(false);
    const contract = data?.contract;
    const native = contract?.signingProvider === 'FASTBOOST';
    const viewer = getStoredUser();
    const own = contract?.boosterId === viewer?.id;
    const admin = viewer?.role === 'ADMIN';
    const company = admin && contract?.companySignerEmail && viewer?.email?.toLowerCase() === contract.companySignerEmail.toLowerCase();
    const canSign = !contract?.archivedAt && (company ? !contract?.companySignedAt : own && !contract?.boosterSignedAt && (!contract?.companySignerEmail || contract?.companySignedAt));
    const detailsReady = Boolean(native && contract?.documentAvailable);
    const providerFirst = native && !(contract?.templateId === 'FB-BSA-2.1' && contract?.companySignedAt);
    const canDownload = Boolean((native ? contract.documentAvailable : contract?.envelopeId) && (admin || !contract.companySignerEmail || contract.companySignedAt));
    async function action(kind) {
        setBusy(true); setActionError('');
        try {
            if (kind === 'document') await downloadContract(id);
            else {
                await operations(`/contracts/${id}/${kind}`, {});
                reload();
            }
        } catch (e) { setActionError(e.message); } finally { setBusy(false); }
    }
    // A signing return only requests a refresh; verified backend state decides completion.
    useEffect(() => {
        const refresh = () => reload();
        const visible = () => { if (document.visibilityState === 'visible') reload(); };
        const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel(CONTRACT_SIGNING_CHANNEL) : null;
        const receive = event => {
            if (event.data?.id === id) reload();
        };
        if (channel) channel.onmessage = receive;
        window.addEventListener('focus', refresh);
        document.addEventListener('visibilitychange', visible);
        return () => { window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', visible); channel?.close(); };
    }, [reload, id]);
    // Keep the badge current while either party signs, including in another tab.
    // Refresh only our stored status; this never polls DocuSign or trusts return parameters.
    useEffect(() => {
        if ((!native && !contract?.envelopeId) || contract.signedAt || ['completed', 'voided', 'declined'].includes(contract.status)) return;
        const timer = window.setInterval(() => { if (document.visibilityState === 'visible') reload(); }, 5000);
        const deadline = window.setTimeout(() => window.clearInterval(timer), 10 * 60000);
        return () => { window.clearInterval(timer); window.clearTimeout(deadline); };
    }, [native, contract?.envelopeId, contract?.signedAt, contract?.status, reload]);
    const awaitingSignature = (native || contract?.envelopeId) && !contract.signedAt && !contract.revokedAt && !contract.archivedAt && !['voided', 'declined', 'completed', 'replaced'].includes(contract.status);
    const status = contract?.archivedAt ? 'Archived' : contract?.signedAt ? 'Signed' : awaitingSignature
        ? contract.companySignerEmail
            ? providerFirst ? !detailsReady ? 'Complete agreement' : !contract.boosterSignedAt ? 'Awaiting booster' : !contract.companySignedAt ? 'Awaiting FastBoost' : 'Confirming signatures'
                : !contract.companySignedAt ? 'Awaiting FastBoost' : !contract.boosterSignedAt ? 'Awaiting booster' : 'Confirming signatures'
            : 'Awaiting signature'
        : ({ pending: 'Pending', sending: 'Sending', send_error: 'Delivery failed', completed: 'Confirming signatures', voided: 'Voided', declined: 'Declined' }[contract?.status] || contract?.status?.replace(/_/g, ' '));
    const companySigner = contract?.companySignerEmail && { role: 'FastBoost', name: contract.companySignerName, signedAt: contract.companySignedAt };
    const boosterSigner = contract && { role: 'Booster', name: contract.signedName || contract.signerName, signedAt: contract.boosterSignedAt || (!contract.companySignerEmail && contract.signedAt) };
    const signers = contract ? providerFirst ? [boosterSigner, companySigner].filter(Boolean) : [companySigner, boosterSigner].filter(Boolean) : [];
    const nativeAction = native && awaitingSignature && (company || own)
        ? providerFirst
            ? company && !detailsReady ? 'Complete agreement details' : own && detailsReady && !contract.boosterSignedAt ? 'Review & sign' : company && contract.boosterSignedAt && !contract.companySignedAt ? 'Review & sign for FastBoost' : company && !contract.boosterSignedAt ? 'Review agreement' : own && !detailsReady ? 'View agreement' : null
            : company && !contract.companySignedAt ? 'Review & sign for FastBoost' : own && !contract.boosterSignedAt ? 'Review & sign' : null
        : null;
    return <div className="page-shell"><Navbar /><main className="page-container ops-page"><Heading title={contract?.title || 'Contract'}>FastBoost · Agreement</Heading><Link to={own ? '/provider/documents' : '/admin/boosters'}>← Back</Link><Feedback error={error || actionError} loading={!data} />
        {contract && <section className="ops-card ops-contract">
            <header className="ops-contract-header">
                <div className="ops-contract-identity"><p className="ops-contract-label">Booster</p><h2>{contract.signerName}</h2><p>{contract.signerEmail}</p></div>
                <span className={`ops-badge ops-contract-status ${contract.signedAt ? 'approved' : ''}`} role="status" aria-label={`Contract status: ${status}`}>{contract.signedAt && <span aria-hidden="true">✓ </span>}{status}</span>
            </header>
            <div className="ops-contract-signatures" role="group" aria-label="Signatures">
                {signers.map((signer, index) => <div className="ops-contract-signer" key={signer.role}>
                    <span className={`ops-contract-signature-icon ${signer.signedAt ? 'is-signed' : ''}`} aria-hidden="true">{signer.signedAt ? '✓' : index + 1}</span>
                    <div><h3>{signer.role}</h3><p>{signer.name}</p><span className={signer.signedAt ? 'ops-contract-signed' : ''}>{signer.signedAt ? `Signed ${date(signer.signedAt)}` : awaitingSignature ? 'Awaiting signature' : 'Not signed'}</span></div>
                </div>)}
            </div>
            {contract.sendError && <p className="ops-error" role="alert">{contract.sendError}</p>}
            {(canDownload || admin || native && own) && <footer className="ops-contract-footer">
                {(native || canDownload) && <div className="ops-contract-document"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z" /><path d="M14 3v5h5M9 13h6M9 17h6" /></svg><div><strong>{contract.signedAt ? 'Signed agreement' : 'Agreement'}</strong><small>{contract.signedAt ? native ? 'PDF · Includes signing record' : 'PDF · Includes completion certificate' : detailsReady || !native ? 'PDF document' : 'PDF available after FastBoost completes the terms'}</small></div></div>}
                <div className="ops-actions">
                    {nativeAction && <button className="ops-primary" disabled={busy} onClick={() => navigate(agreementSigningPath(id))}>{nativeAction}</button>}
                    {!native && canSign && awaitingSignature && <button className="ops-primary" disabled={busy} onClick={() => navigate(agreementSigningPath(id))}>{company ? 'Review & sign for FastBoost' : 'Review & sign'}</button>}
                    {canDownload && <button className={contract.signedAt ? 'ops-primary' : ''} disabled={busy} onClick={() => action('document')}>Download PDF</button>}
                    {admin && !native && !contract.envelopeId && <button disabled={busy} onClick={() => action('retry')}>Retry delivery</button>}
                </div>
            </footer>}
        </section>}
    </main></div>;
}

export function ContractSigningReturnPage() {
    const { id } = useParams();
    useEffect(() => {
        const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel(CONTRACT_SIGNING_CHANNEL) : null;
        channel?.postMessage({ id });
        const timer = window.setTimeout(() => window.close(), 300);
        return () => { window.clearTimeout(timer); channel?.close(); };
    }, [id]);
    return <main className="page-container ops-page"><section className="ops-card">
        <h1>Signing session closed</h1>
        <p>You can return to your agreement. Its status updates after confirmation from DocuSign.</p>
        <Link to={`/provider/contracts/${encodeURIComponent(id)}`}>Return to agreement</Link>
    </section></main>;
}
