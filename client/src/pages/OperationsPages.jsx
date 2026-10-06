import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { operations, downloadContract, money, date, tenure } from '../api/operations';
import Navbar from '../components/Navbar';
import { getStoredUser } from '../utils/authSession';
import { CONTRACT_SIGNING_CHANNEL, openContractSigning } from '../utils/contractSigning';
import '../styles/Operations.css';

function useData(path) {
    const [state, setState] = useState({ data: null, error: '' });
    const [version, setVersion] = useState(0);
    useEffect(() => {
        let cancelled = false;
        operations(path).then(data => { if (!cancelled) setState({ data, error: '' }); })
            .catch(error => { if (!cancelled) setState(previous => ({ ...previous, error: error.message })); });
        return () => { cancelled = true; };
    }, [path, version]);
    const reload = useCallback(() => setVersion(v => v + 1), []);
    return { ...state, reload };
}
function Heading({ title, children }) { return <header className="ops-heading"><h1>{title}</h1><div>{children}</div></header>; }
function Feedback({ error, loading }) { return error ? <p className="ops-error" role="alert">{error}</p> : loading ? <p role="status">Loading…</p> : null; }
function Amounts({ values }) { return Object.keys(values || {}).length ? Object.entries(values).map(([currency, cents]) => <strong key={currency}>{money(cents, currency)} <small>{currency}</small></strong>) : <span>No confirmed earnings yet</span>; }

export function EarningsPage() {
    const { data, error, reload } = useData('/earnings');
    const [currency, setCurrency] = useState('');
    const [page, setPage] = useState(0);
    const selected = currency || data?.totals[0]?.currency;
    const total = data?.totals.find(t => t.currency === selected);
    const rows = data?.rows.filter(r => r.currency === selected) || [];
    return <div className="ops-page"><Heading title="Earnings">Completed orders, clear shares, and contribution approvals.</Heading>
        <Feedback error={error} loading={!data} />
        {data && <><div className="ops-toolbar"><span>All time · Completed and paid orders</span><label>Currency <select value={selected || ''} onChange={e => { setCurrency(e.target.value); setPage(0); }}>{data.totals.map(t => <option key={t.currency}>{t.currency}</option>)}</select></label></div>
            <div className="ops-stats">{[['Service revenue', total?.revenueCents], ['FastBoost share · 30%', total?.platformCents], ['Booster pool · 70%', total?.boosterCents]].map(([label, value]) => <section className="ops-card" key={label}><span>{label}</span><h2>{money(value || 0, selected)}</h2><small>After discounts and redemption · Before sales tax</small></section>)}</div>
            <div className="ops-callout"><strong>{money(total?.unallocatedCents || 0, selected)} awaiting allocation</strong><span>Confirm the completed order’s match history to allocate booster shares. FastBoost’s share is before fees and operating costs.</span></div>
            {data.missingAmounts > 0 && <p role="status">{data.missingAmounts} older orders have no verified subtotal and are excluded.</p>}
            <section className="ops-card"><h2>Completed orders <small>{rows.length}</small></h2>{!rows.length ? <div className="ops-empty">Completed paid orders will appear here.</div> : <div className="ops-table-wrap"><table><thead><tr><th>Order</th><th>Revenue</th><th>FastBoost</th><th>Booster pool</th><th>Allocation</th></tr></thead><tbody>{rows.slice(page * 10, page * 10 + 10).map(row => <tr key={row.id}><td><Link to={`/admin/orders/${row.id}`}>#{row.orderNumber}</Link><small>{row.boostType}</small></td><td>{money(row.revenueCents, selected)}</td><td>{money(row.platformCents, selected)}</td><td>{money(row.boosterCents, selected)}</td><td><span className={`ops-badge ${row.shares.length ? 'approved' : ''}`}>{row.shares.length ? 'Confirmed' : 'Awaiting approval'}</span></td></tr>)}</tbody></table></div>}
                {rows.length > 10 && <div className="ops-toolbar"><button disabled={!page} onClick={() => setPage(p => p - 1)}>Previous</button><span>{page + 1} / {Math.ceil(rows.length / 10)}</span><button disabled={(page + 1) * 10 >= rows.length} onClick={() => setPage(p => p + 1)}>Next</button></div>}</section></>}
        <Contributions admin onChange={reload} />
    </div>;
}

function ContributionRow({ order, record, admin, reload }) {
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
        {admin ? record.submittedMatches != null && !record.reviewedAt && <div className="ops-actions"><button disabled={busy} onClick={() => submit('approve')}>Approve {record.submittedMatches} matches</button><input aria-label="Correction note" placeholder="Reason for correction" maxLength={500} value={note} onChange={e => setNote(e.target.value)} /><button disabled={busy || !note.trim()} onClick={() => submit('return')}>Request correction</button></div> : <form className="ops-actions" onSubmit={e => { e.preventDefault(); submit(); }}><label>Matches played<input type="number" min="0" max="10000" step="1" required value={matches} onChange={e => setMatches(e.target.value)} /></label><button disabled={busy || matches === ''}>{busy ? 'Submitting…' : 'Submit for approval'}</button></form>}
        <Feedback error={error} /></div>;
}
function Contributions({ admin = false, onChange }) {
    const { data, error, reload } = useData('/contributions');
    const [filter, setFilter] = useState('');
    return <section className="ops-card"><h2>{admin ? 'Match reviews' : 'Your match contributions'}</h2><p>Admin-approved matches determine each booster’s share of the 70% pool.</p><input className="ops-search" aria-label="Find order" placeholder="Find order number…" value={filter} onChange={e => setFilter(e.target.value)} /><Feedback error={error} loading={!data} />
        {data?.orders.filter(o => (o.orderNumber || '').toLowerCase().includes(filter.toLowerCase())).map(order => {
            if (order.matchHistoryEnabled) return <Link className="ops-contract-link" key={order.id} to={`/match/${order.id}?tab=history`}><span>#{order.orderNumber}<small>{order.boostType}</small></span><span className={`ops-badge ${order.matchHistoryConfirmedAt ? 'approved' : ''}`}>{order.matchHistoryConfirmedAt ? 'Confirmed' : 'Review matches'} →</span></Link>;
            const records = new Map(order.assignments.map(a => [a.boosterId, a]));
            for (const record of order.contributions) records.set(record.boosterId, record);
            return [...records.values()].map(record => <ContributionRow key={`${order.id}-${record.boosterId}-${record.revision || 0}-${record.reviewedAt || ''}`} order={order} record={record} admin={admin} reload={() => { reload(); onChange?.(); }} />);
        })}
        {data?.orders.length === 0 && <div className="ops-empty">No assigned orders to review yet.</div>}</section>;
}

function BoosterDetails({ booster, reload, configured, onError }) {
    const [busy, setBusy] = useState(false);
    const [requestId, setRequestId] = useState(() => crypto.randomUUID());
    async function submit(event) {
        event.preventDefault(); const form = event.currentTarget;
        setBusy(true); onError('');
        try {
            const body = new FormData(form);
            await operations(`/boosters/${booster.id}/contracts`, { requestId, title: body.get('title'), startsAt: body.get('startsAt'), signerName: body.get('signerName') });
            form.reset(); setRequestId(crypto.randomUUID());
            reload();
        } catch (e) { onError(e.message); reload(); } finally { setBusy(false); }
    }
    return <details className="ops-card ops-booster"><summary><span className="ops-avatar">{(booster.profile?.displayName || booster.username || 'B')[0]}</span><span><strong>{booster.profile?.displayName || booster.username}</strong><small>{tenure(booster.boosterProfile?.startedAt)}</small></span>{booster.suspendedAt && <span className="ops-badge">Suspended</span>}<svg className="ops-booster-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg></summary>
        <div className="ops-detail">
            <h3>Send a DocuSign contract</h3><form className="ops-form" onSubmit={submit}><label>Contract title<input name="title" placeholder="Booster service agreement" required maxLength={100} /></label><label>Start date<input type="date" name="startsAt" required /></label><label>Signer’s full legal name<input name="signerName" required minLength={2} maxLength={100} /></label><button className="ops-primary" disabled={!configured || busy || booster.suspendedAt}>{busy ? 'Sending…' : 'Send with DocuSign'}</button></form>
            <h3>Contracts</h3>{booster.boosterContracts.length ? booster.boosterContracts.map(c => <Link className="ops-contract-link" to={`/provider/contracts/${c.id}`} key={c.id}><span>{c.title}<small>{date(c.createdAt)}</small></span><span className={`ops-badge ${c.signedAt ? 'approved' : ''}`}>{c.signedAt ? `Signed ${date(c.signedAt)}` : 'Awaiting signature'} →</span></Link>) : <p>No contracts sent yet.</p>}</div>
    </details>;
}
export function BoosterManagementPage() {
    const { data, error, reload } = useData('/boosters');
    const { data: signing } = useData('/docusign/configuration');
    const [query, setQuery] = useState('');
    const [actionError, setActionError] = useState('');
    return <div className="ops-page"><Heading title="Booster Management">Your team and agreements in one place.</Heading><Feedback error={error || actionError} loading={!data} />
        <div className="ops-toolbar"><h2 className="ops-team-heading">Your team {data && <span className="ops-team-count" aria-label={`${data.boosters.length} ${data.boosters.length === 1 ? 'booster' : 'boosters'}`}>{data.boosters.length}</span>}</h2><input aria-label="Search boosters" placeholder="Search boosters…" value={query} onChange={e => setQuery(e.target.value)} /></div>
        {data?.boosters.filter(b => `${b.username} ${b.email} ${b.profile?.displayName || ''}`.toLowerCase().includes(query.toLowerCase())).map(b => <BoosterDetails key={b.id} booster={b} reload={reload} configured={signing?.configured} onError={setActionError} />)}
        {data?.boosters.length === 0 && <section className="ops-card ops-empty">Add booster access in <Link to="/admin/accounts">Account Management</Link> to grow your team.</section>}</div>;
}
export function BoosterWorkspacePage() {
    const { data, error } = useData('/me');
    return <div className="page-shell"><Navbar /><main className="page-container ops-page"><Heading title="My booster workspace">Contributions, earnings, and contracts.</Heading><Link to="/provider/orders">← Assigned orders</Link><Feedback error={error} loading={!data} />{data && <><section className="ops-card"><span>Confirmed earnings · Completed orders</span><div className="ops-amounts"><Amounts values={data.earnings} /></div><p>{tenure(data.profile?.startedAt)}</p></section><section className="ops-card"><h2>Your contracts</h2>{data.contracts.length ? data.contracts.map(c => <Link className="ops-contract-link" key={c.id} to={`/provider/contracts/${c.id}`}>{c.title}<span className="ops-badge">{c.signedAt ? 'Signed' : 'Review & sign'} →</span></Link>) : <p>No contracts yet.</p>}</section></>}<Contributions /></main></div>;
}
export function BoosterContractPage() {
    const { id } = useParams();
    const { data, error, reload } = useData(`/contracts/${id}`);
    const [signingAttempt, setSigningAttempt] = useState(0);
    const [actionError, setActionError] = useState('');
    const [busy, setBusy] = useState(false);
    const contract = data?.contract;
    const viewer = getStoredUser();
    const own = contract?.boosterId === viewer?.id;
    const admin = viewer?.role === 'ADMIN';
    const company = admin && contract?.companySignerEmail && viewer?.email?.toLowerCase() === contract.companySignerEmail.toLowerCase();
    const canSign = company ? !contract?.companySignedAt : own && !contract?.boosterSignedAt && (!contract?.companySignerEmail || contract?.companySignedAt);
    const canDownload = Boolean(contract?.envelopeId && (admin || !contract.companySignerEmail || contract.companySignedAt));
    async function action(kind) {
        setBusy(true); setActionError('');
        try {
            if (kind === 'document') await downloadContract(id);
            else if (kind === 'signing-view') {
                await openContractSigning(() => operations(`/contracts/${id}/signing-view`, {}));
                setSigningAttempt(attempt => attempt + 1);
            }
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
        if (!contract?.envelopeId || contract.signedAt || ['completed', 'voided', 'declined'].includes(contract.status)) return;
        const timer = window.setInterval(() => { if (document.visibilityState === 'visible') reload(); }, 5000);
        const deadline = window.setTimeout(() => window.clearInterval(timer), 10 * 60000);
        return () => { window.clearInterval(timer); window.clearTimeout(deadline); };
    }, [contract?.envelopeId, contract?.signedAt, contract?.status, signingAttempt, reload]);
    const awaitingSignature = contract?.envelopeId && !contract.signedAt && !['voided', 'declined', 'completed'].includes(contract.status);
    const status = contract?.signedAt ? 'Signed' : awaitingSignature
        ? contract.companySignerEmail ? !contract.companySignedAt ? 'Awaiting FastBoost' : !contract.boosterSignedAt ? 'Awaiting booster' : 'Confirming signatures' : 'Awaiting signature'
        : ({ pending: 'Pending', sending: 'Sending', send_error: 'Delivery failed', completed: 'Confirming signatures', voided: 'Voided', declined: 'Declined' }[contract?.status] || contract?.status?.replace(/_/g, ' '));
    const signers = contract ? [
        ...(contract.companySignerEmail ? [{ role: 'FastBoost', name: contract.companySignerName, signedAt: contract.companySignedAt }] : []),
        { role: 'Booster', name: contract.signedName || contract.signerName, signedAt: contract.boosterSignedAt || (!contract.companySignerEmail && contract.signedAt) },
    ] : [];
    return <div className="page-shell"><Navbar /><main className="page-container ops-page"><Heading title={contract?.title || 'Contract'}>FastBoost · DocuSign agreement</Heading><Link to={own ? '/provider/workspace' : '/admin/boosters'}>← Back</Link><Feedback error={error || actionError} loading={!data} />
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
            {(canDownload || admin) && <footer className="ops-contract-footer">
                {canDownload && <div className="ops-contract-document"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z" /><path d="M14 3v5h5M9 13h6M9 17h6" /></svg><div><strong>{contract.signedAt ? 'Signed agreement' : 'Agreement'}</strong><small>{contract.signedAt ? 'PDF · Includes completion certificate' : 'PDF document'}</small></div></div>}
                <div className="ops-actions">
                    {canSign && awaitingSignature && <button className="ops-primary" disabled={busy} onClick={() => action('signing-view')} title="Opens DocuSign in a new tab">{company ? 'Review & sign for FastBoost' : 'Review & sign'} <span aria-hidden="true">↗</span><span className="ops-sr-only"> (opens in a new tab)</span></button>}
                    {canDownload && <button className={contract.signedAt ? 'ops-primary' : ''} disabled={busy} onClick={() => action('document')}>Download PDF</button>}
                    {admin && !contract.envelopeId && <button disabled={busy} onClick={() => action('retry')}>Retry delivery</button>}
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
