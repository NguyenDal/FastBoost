import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { operations, downloadContract, money, date, tenure } from '../api/operations';
import Navbar from '../components/Navbar';
import { getStoredUser } from '../utils/authSession';
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
function Heading({ title, children }) { return <header className="ops-heading"><p>FASTBOOST · OPERATIONS</p><h1>{title}</h1><div>{children}</div></header>; }
function Feedback({ error, loading }) { return error ? <p className="ops-error" role="alert">{error}</p> : loading ? <p role="status">Loading…</p> : null; }
function Amounts({ values }) { return Object.keys(values || {}).length ? Object.entries(values).map(([currency, cents]) => <strong key={currency}>{money(cents, currency)} <small>{currency}</small></strong>) : <span>No confirmed earnings yet</span>; }

export function EarningsPage() {
    const { data, error } = useData('/earnings');
    const [currency, setCurrency] = useState('');
    const [page, setPage] = useState(0);
    const selected = currency || data?.totals[0]?.currency;
    const total = data?.totals.find(t => t.currency === selected);
    const rows = data?.rows.filter(r => r.currency === selected) || [];
    return <div className="ops-page"><Heading title="Earnings">Completed orders, clear shares, and contribution approvals.</Heading>
        <Feedback error={error} loading={!data} />
        {data && <><div className="ops-toolbar"><span>All time · Completed and paid orders</span><label>Currency <select value={selected || ''} onChange={e => { setCurrency(e.target.value); setPage(0); }}>{data.totals.map(t => <option key={t.currency}>{t.currency}</option>)}</select></label></div>
            <div className="ops-stats">{[['Service revenue', total?.revenueCents], ['FastBoost share · 30%', total?.platformCents], ['Booster pool · 70%', total?.boosterCents]].map(([label, value]) => <section className="ops-card" key={label}><span>{label}</span><h2>{money(value || 0, selected)}</h2><small>After discounts and redemption · Before sales tax</small></section>)}</div>
            <div className="ops-callout"><strong>{money(total?.unallocatedCents || 0, selected)} awaiting allocation</strong><span>Booster shares are confirmed when every participant’s match count is approved. FastBoost’s share is before fees and operating costs.</span><Link to="/admin/boosters">Review contributions →</Link></div>
            {data.missingAmounts > 0 && <p role="status">{data.missingAmounts} older orders have no verified subtotal and are excluded.</p>}
            <section className="ops-card"><h2>Completed orders <small>{rows.length}</small></h2>{!rows.length ? <div className="ops-empty">Completed paid orders will appear here.</div> : <div className="ops-table-wrap"><table><thead><tr><th>Order</th><th>Revenue</th><th>FastBoost</th><th>Booster pool</th><th>Allocation</th></tr></thead><tbody>{rows.slice(page * 10, page * 10 + 10).map(row => <tr key={row.id}><td><Link to={`/admin/orders/${row.id}`}>#{row.orderNumber}</Link><small>{row.boostType}</small></td><td>{money(row.revenueCents, selected)}</td><td>{money(row.platformCents, selected)}</td><td>{money(row.boosterCents, selected)}</td><td><span className={`ops-badge ${row.shares.length ? 'approved' : ''}`}>{row.shares.length ? 'Confirmed' : 'Awaiting approval'}</span></td></tr>)}</tbody></table></div>}
                {rows.length > 10 && <div className="ops-toolbar"><button disabled={!page} onClick={() => setPage(p => p - 1)}>Previous</button><span>{page + 1} / {Math.ceil(rows.length / 10)}</span><button disabled={(page + 1) * 10 >= rows.length} onClick={() => setPage(p => p + 1)}>Next</button></div>}</section></>}
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
    return <section className="ops-card"><h2>{admin ? 'Contribution approvals' : 'Your match contributions'}</h2><p>Submit all matches played on the order. Approved match counts determine each booster’s share of the 70% pool.</p><input className="ops-search" aria-label="Find order" placeholder="Find order number…" value={filter} onChange={e => setFilter(e.target.value)} /><Feedback error={error} loading={!data} />
        {data?.orders.filter(o => (o.orderNumber || '').toLowerCase().includes(filter.toLowerCase())).map(order => {
            const records = new Map(order.assignments.map(a => [a.boosterId, a]));
            for (const record of order.contributions) records.set(record.boosterId, record);
            return [...records.values()].map(record => <ContributionRow key={`${order.id}-${record.boosterId}-${record.revision || 0}-${record.reviewedAt || ''}`} order={order} record={record} admin={admin} reload={() => { reload(); onChange?.(); }} />);
        })}
        {data?.orders.length === 0 && <div className="ops-empty">No assigned orders to review yet.</div>}</section>;
}

function BoosterDetails({ booster, reload, configured }) {
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');
    const [requestId, setRequestId] = useState(() => crypto.randomUUID());
    async function submit(event, contract) {
        event.preventDefault(); const form = event.currentTarget;
        setBusy(true); setError(''); setMessage('');
        try {
            const body = new FormData(form);
            await operations(`/boosters/${booster.id}${contract ? '/contracts' : ''}`, contract ? { requestId, title: body.get('title'), startsAt: body.get('startsAt'), signerName: body.get('signerName') } : { startedAt: body.get('startedAt') }, contract ? 'POST' : 'PATCH');
            if (contract) { form.reset(); setRequestId(crypto.randomUUID()); }
            setMessage(contract ? 'Contract sent to the booster’s account for signature.' : 'Start date updated.'); reload();
        } catch (e) { setError(e.message); reload(); } finally { setBusy(false); }
    }
    return <details className="ops-card"><summary><span className="ops-avatar">{(booster.profile?.displayName || booster.username || 'B')[0]}</span><span><strong>{booster.profile?.displayName || booster.username}</strong><small>{tenure(booster.boosterProfile?.startedAt)}</small></span><span className="ops-amounts"><Amounts values={booster.earnings} /></span><span className="ops-badge">{booster.suspendedAt ? 'Suspended' : `${booster.providedAssignments.length} active orders`}</span></summary>
        <div className="ops-detail"><form onSubmit={e => submit(e, false)} className="ops-actions"><label>Joined FastBoost<input type="date" name="startedAt" required defaultValue={booster.boosterProfile?.startedAt?.slice(0, 10)} /></label><button disabled={busy}>Save date</button></form>
            <h3>Send a DocuSign contract</h3><p>Uses your configured Booster agreement template. Recipient: {booster.email}</p><form className="ops-form" onSubmit={e => submit(e, true)}><label>Contract title<input name="title" placeholder="Booster service agreement" required maxLength={100} /></label><label>Start date<input type="date" name="startsAt" required /></label><label>Signer’s full legal name<input name="signerName" required minLength={2} maxLength={100} /></label><button className="ops-primary" disabled={!configured || busy || booster.suspendedAt}>{busy ? 'Sending…' : 'Send with DocuSign'}</button></form>
            <Feedback error={error} />{message && <p role="status">{message}</p>}<h3>Contracts</h3>{booster.boosterContracts.length ? booster.boosterContracts.map(c => <Link className="ops-contract-link" to={`/provider/contracts/${c.id}`} key={c.id}><span>{c.title}<small>{date(c.createdAt)}</small></span><span className={`ops-badge ${c.signedAt ? 'approved' : ''}`}>{c.signedAt ? `Signed ${date(c.signedAt)}` : 'Awaiting signature'} →</span></Link>) : <p>No contracts sent yet.</p>}</div>
    </details>;
}
export function BoosterManagementPage() {
    const { data, error, reload } = useData('/boosters');
    const { data: signing } = useData('/docusign/configuration');
    const [query, setQuery] = useState('');
    return <div className="ops-page"><Heading title="Booster Management">Your team, their contributions, and agreements in one place.</Heading><Feedback error={error} loading={!data} />
        <div className="ops-toolbar"><h2>Your team <small>{data?.boosters.length || 0}</small></h2><input aria-label="Search boosters" placeholder="Search boosters…" value={query} onChange={e => setQuery(e.target.value)} /></div>
        {signing && <div className="ops-callout"><strong>DocuSign · {signing.configured ? signing.environment === 'demo' ? 'Sandbox ready' : 'Production ready' : 'Setup required'}</strong><span>{signing.configured ? 'Agreement signatures are collected through DocuSign.' : 'Complete the DocuSign account setup before sending contracts.'}</span></div>}
        {data?.boosters.filter(b => `${b.username} ${b.email} ${b.profile?.displayName || ''}`.toLowerCase().includes(query.toLowerCase())).map(b => <BoosterDetails key={b.id} booster={b} reload={reload} configured={signing?.configured} />)}
        {data?.boosters.length === 0 && <section className="ops-card ops-empty">Add booster access in <Link to="/admin/accounts">Account Management</Link> to grow your team.</section>}<Contributions admin onChange={reload} /></div>;
}
export function BoosterWorkspacePage() {
    const { data, error } = useData('/me');
    return <div className="page-shell"><Navbar /><main className="page-container ops-page"><Heading title="My booster workspace">Contributions, earnings, and contracts.</Heading><Link to="/provider/orders">← Assigned orders</Link><Feedback error={error} loading={!data} />{data && <><section className="ops-card"><span>Confirmed earnings · Completed orders</span><div className="ops-amounts"><Amounts values={data.earnings} /></div><p>{tenure(data.profile?.startedAt)}</p></section><section className="ops-card"><h2>Your contracts</h2>{data.contracts.length ? data.contracts.map(c => <Link className="ops-contract-link" key={c.id} to={`/provider/contracts/${c.id}`}>{c.title}<span className="ops-badge">{c.signedAt ? 'Signed' : 'Review & sign'} →</span></Link>) : <p>No contracts yet.</p>}</section></>}<Contributions /></main></div>;
}
export function BoosterContractPage() {
    const { id } = useParams();
    const { data, error, reload } = useData(`/contracts/${id}`);
    const [signingUrl, setSigningUrl] = useState('');
    const [actionError, setActionError] = useState('');
    const [notice, setNotice] = useState('');
    const [busy, setBusy] = useState(false);
    const contract = data?.contract;
    const own = contract?.boosterId === getStoredUser()?.id;
    const admin = getStoredUser()?.role === 'ADMIN';
    const returning = window.self !== window.top && new URLSearchParams(window.location.search).get('signingReturn') === '1';
    async function action(kind) {
        setBusy(true); setActionError(''); setNotice('');
        try {
            if (kind === 'document') await downloadContract(id);
            else {
                const result = await operations(`/contracts/${id}/${kind}`, {});
                if (kind === 'signing-view') setSigningUrl(result.url);
                else { reload(); if (result.pending) setNotice('Waiting for DocuSign’s confirmation. Status updates arrive automatically; a manual check is available every 15 minutes.'); }
            }
        } catch (e) { setActionError(e.message); } finally { setBusy(false); }
    }
    // Refresh local status after the signer returns, without trusting the URL's event value.
    useEffect(() => {
        const refresh = () => reload();
        const receive = event => {
            if (event.origin === window.location.origin && event.data?.type === 'fastboost:docusign-return' && event.data?.id === id) {
                setSigningUrl(''); reload(); setNotice('Signing session closed. Waiting for DocuSign to confirm the result.');
            }
        };
        if (returning) window.parent.postMessage({ type: 'fastboost:docusign-return', id }, window.location.origin);
        window.addEventListener('focus', refresh);
        window.addEventListener('message', receive);
        return () => { window.removeEventListener('focus', refresh); window.removeEventListener('message', receive); };
    }, [reload, id, returning]);
    if (returning) return <p>Returning to your agreement…</p>;
    return <div className="page-shell"><Navbar /><main className="page-container ops-page"><Heading title={contract?.title || 'Contract'}>FastBoost · Signed with DocuSign</Heading><Link to={own ? '/provider/workspace' : '/admin/boosters'}>← Back</Link><Feedback error={error || actionError} loading={!data} />
        {contract && <section className="ops-card"><div className="ops-toolbar"><div><strong>{contract.signerName}</strong><small>{contract.signerEmail} · Starts {date(contract.startsAt)}</small></div><span className={`ops-badge ${contract.signedAt ? 'approved' : ''}`}>{contract.signedAt ? 'Signed' : contract.status.replace(/_/g, ' ')}</span></div>
            {contract.environment === 'demo' && <p>Sandbox contract · For testing only.</p>}
            {contract.sendError && <p role="alert">{contract.sendError}</p>}
            <div className="ops-actions">
                {own && contract.envelopeId && !contract.signedAt && !['voided', 'declined', 'completed'].includes(contract.status) && <button className="ops-primary" disabled={busy} onClick={() => action('signing-view')}>Review & sign with DocuSign</button>}
                {contract.envelopeId && <><button disabled={busy} onClick={() => action('document')}>{contract.signedAt ? 'Download signed PDF & certificate' : 'Download agreement PDF'}</button><button disabled={busy} onClick={() => action('sync')}>Check signature status</button></>}
                {admin && !contract.envelopeId && <button disabled={busy} onClick={() => action('retry')}>Retry delivery</button>}
            </div>
            {notice && <p role="status">{notice}</p>}
            {signingUrl && !contract.signedAt && <><iframe className="ops-pdf" title="DocuSign contract signing" src={signingUrl} allow="geolocation" /><a href={signingUrl}>Open signing full screen</a></>}
            {contract.signedAt && <div className="ops-callout"><strong>Signed by {contract.signedName}</strong><span>{new Date(contract.signedAt).toLocaleString()}</span><span>Completion verified with DocuSign.</span></div>}
        </section>}
    </main></div>;
}
