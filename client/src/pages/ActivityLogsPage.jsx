import { useEffect, useRef, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { activityLogs } from '../api/activityLogs';
import { ActivityIcon } from '../components/AdminIcons';
import { Skeleton } from '../components/Skeleton';
import OrderPagination from '../components/OrderPagination';
import { activityLogFields, isOpaqueIdentifier } from '../utils/activityLogDetails';
import '../styles/ActivityLogs.css';

const emptyFilters = { q: '', actor: '', category: '', from: '', to: '' };
const dateTime = value => value ? new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—';
const targetFallbacks = { user: 'Unknown user', booster: 'Unknown user', order: 'Order', contract: 'Agreement',
    priceRule: 'Pricing rule', sale: 'Sale or coupon', service: 'Service', assignment: 'Assignment', match: 'Match' };
const targetName = item => typeof item.targetLabel === 'string' && item.targetLabel.trim() && !isOpaqueIdentifier(item.targetLabel.trim())
    ? item.targetLabel : targetFallbacks[item.targetType] || 'Management change';
const actorRole = item => item.actorIsOwner ? 'Owner' : item.actorRole === 'ADMIN' ? 'Admin'
    : item.actorRole === 'PROVIDER' ? 'Booster' : 'User';
function DetailValues({ title, value }) {
    const entries = activityLogFields(value);
    return <section className="audit-values"><h4>{title}</h4>{entries.length ? <dl>{entries.map(([label, text]) => <div key={label}><dt>{label}</dt><dd>{text}</dd></div>)}</dl> : <p>Not recorded</p>}</section>;
}
function targetLink(item) {
    const id = encodeURIComponent(item.targetId || '');
    if (!item.targetId) return null;
    if (item.targetType === 'order') return `/match/${id}${item.category === 'earnings' ? '?tab=history' : ''}`;
    if (item.targetType === 'contract') return `/provider/contracts/${id}`;
    return null;
}
function LogEntry({ item, categories }) {
    const link = targetLink(item);
    return <details className="audit-entry">
        <summary>
            <span className="audit-entry-indicator" aria-hidden="true"><ActivityIcon /></span>
            <span className="audit-entry-main"><strong>{item.actionLabel}</strong><span>{item.actorName?.trim() || 'Unknown user'}<span className="audit-role">{actorRole(item)}</span><span className="audit-dot">·</span>{categories[item.category] || item.category}</span></span>
            <span className="audit-entry-target">{targetName(item)}<time dateTime={item.createdAt}>{dateTime(item.createdAt)}</time></span>
            <span className="audit-chevron" aria-hidden="true">⌄</span>
        </summary>
        <div className="audit-detail">
            <div className="audit-detail-meta"><span>Recorded {dateTime(item.createdAt)}{item.finishedAt ? ` · Finished ${dateTime(item.finishedAt)}` : ''}</span>{link && <Link to={link}>Open record →</Link>}</div>
            <div className="audit-detail-grid"><DetailValues title="Before" value={item.before} /><DetailValues title="Requested action" value={item.requested} /><DetailValues title="After" value={item.after} /></div>
        </div>
    </details>;
}

export default function ActivityLogsPage() {
    const [draft, setDraft] = useState(emptyFilters);
    const [filters, setFilters] = useState(emptyFilters);
    const [page, setPage] = useState(1);
    const [revision, setRevision] = useState(0);
    const [data, setData] = useState(null);
    const [settledKey, setSettledKey] = useState(null);
    const [error, setError] = useState('');
    const [denied, setDenied] = useState(false);
    const results = useRef(null);
    const requestKey = JSON.stringify({ filters, page, revision });
    const loading = settledKey !== requestKey;
    useEffect(() => {
        const controller = new AbortController();
        const request = JSON.parse(requestKey);
        const params = new URLSearchParams({ page: String(request.page), ...request.filters });
        activityLogs(`?${params}`, controller.signal).then(result => {
            if (!controller.signal.aborted) { setData(result); setError(''); setSettledKey(requestKey); }
        }).catch(e => {
            if (controller.signal.aborted) return;
            if ([401, 403].includes(e.status)) { setData(null); setDenied(true); }
            setError(e.message); setSettledKey(requestKey);
        });
        return () => controller.abort();
    }, [requestKey]);
    // Recheck on focus so a revoked admin session cannot retain a cached report.
    useEffect(() => {
        const refresh = () => { setData(null); setRevision(value => value + 1); };
        window.addEventListener('focus', refresh);
        return () => window.removeEventListener('focus', refresh);
    }, []);
    if (denied) return <Navigate to="/admin/management" replace />;
    const change = key => event => setDraft(value => ({ ...value, [key]: event.target.value }));
    const apply = event => { event.preventDefault(); setPage(1); setFilters({ ...draft }); };
    const reset = () => { setDraft(emptyFilters); setFilters(emptyFilters); setPage(1); };
    const totalPages = Math.max(1, Math.ceil((data?.total || 0) / (data?.pageSize || 10)));
    const currentPage = data?.page || 1;
    return <div className="audit-page">
        <header className="audit-heading"><div><p className="audit-eyebrow">Management activity</p><h1>Activity Logs</h1><p>Review important changes to services and operations.</p></div></header>
        <form className="audit-filters" onSubmit={apply}>
            <label className="audit-search">Search<input value={draft.q} onChange={change('q')} placeholder="Username or record name…" maxLength={100} /></label>
            <label>User<select value={draft.actor} onChange={change('actor')}><option value="">All users</option>{data?.actors.map(actor => <option key={actor.actorId} value={actor.actorId}>{actor.actorName?.trim() || 'Unknown user'}</option>)}</select></label>
            <label>Area<select value={draft.category} onChange={change('category')}><option value="">All areas</option>{Object.entries(data?.categories || {}).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label>
            <label>From (UTC)<input type="date" value={draft.from} onChange={change('from')} max={draft.to || undefined} /></label>
            <label>To (UTC)<input type="date" value={draft.to} onChange={change('to')} min={draft.from || undefined} /></label>
            <div className="audit-filter-actions"><button type="submit" className="audit-primary">Apply filters</button><button type="button" onClick={reset}>Reset</button></div>
        </form>
        <section className="audit-results" ref={results} tabIndex={-1} aria-labelledby="audit-results-heading" aria-busy={loading}>
            <header><div><h2 id="audit-results-heading">Critical changes <span>{data?.total ?? '—'}</span></h2><p>Newest first · Times shown in your local time.</p></div><button type="button" disabled={loading} onClick={() => setRevision(value => value + 1)}>Refresh logs</button></header>
            {!loading && error && <div className="audit-error" role="alert"><p>{error}</p><button type="button" onClick={() => setRevision(value => value + 1)}>Try again</button></div>}
            {loading ? <div role="status" aria-label="Loading activity logs">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} height={86} radius={12} className="audit-skeleton" />)}</div> : !error && <>
                <div id="activity-log-list">{data?.items.map(item => <LogEntry key={item.id} item={item} categories={data.categories} />)}</div>
                {!data?.items.length && <div className="audit-empty"><ActivityIcon /><h3>No critical changes found</h3><p>Try adjusting your filters.</p></div>}
                {!!data?.total && <><p className="audit-count" role="status">Showing {(currentPage - 1) * data.pageSize + 1}–{Math.min(currentPage * data.pageSize, data.total)} of {data.total} events · {data.pageSize} per page</p><OrderPagination currentPage={currentPage} totalPages={totalPages} tableId="activity-log-list" label="Activity log pages" onPageChange={next => { setPage(next); results.current?.focus({ preventScroll: true }); results.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }} /></>}
            </>}
        </section>
        <p className="audit-scope">Shows completed changes to access, services, pricing, orders, agreements, and approved earnings. Routine views, messages, and exports are excluded.</p>
    </div>;
}
