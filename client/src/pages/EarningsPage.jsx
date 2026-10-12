import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { operations, money, date } from '../api/operations';
import OrderPagination from '../components/OrderPagination';
import { Skeleton } from '../components/Skeleton';
import { filterEarningsRows, summarizeEarnings, summarizeBoosters, buildMonthlyRevenue, averageMonthlyRevenue, toCsv } from '../utils/earningsReport';
import '../styles/Operations.css';
import '../styles/Skeleton.css';
import '../styles/Earnings.css';

const PAGE_SIZE = 10;
const REPORT_CURRENCY = 'USD';
const reviewLabels = { CONFIRMED: 'Confirmed', NEEDS_REVIEW: 'Needs review', READY_TO_CONFIRM: 'Ready to confirm', AWAITING_SUBMISSION: 'Awaiting submission', RETURNED: 'Changes requested' };
const formatMoney = (value, currency) => {
    if (value == null) return '—';
    try { return money(value, currency); } catch { return `${(value / 100).toFixed(2)} ${currency}`; }
};
const decimal = value => value == null ? '' : (value / 100).toFixed(2);

function periodDates(period) {
    const today = new Date();
    const year = today.getUTCFullYear(), month = today.getUTCMonth();
    const day = value => value.toISOString().slice(0, 10);
    if (period === 'month') return { from: day(new Date(Date.UTC(year, month, 1))), to: day(today) };
    if (period === 'last-month') return { from: day(new Date(Date.UTC(year, month - 1, 1))), to: day(new Date(Date.UTC(year, month, 0))) };
    if (period === 'year') return { from: `${year}-01-01`, to: day(today) };
    return { from: '', to: '' };
}

function downloadCsv(name, headers, rows) {
    const url = URL.createObjectURL(new Blob([toCsv(headers, rows)], { type: 'text/csv;charset=utf-8;' }));
    const link = document.createElement('a');
    link.href = url; link.download = name; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function EarningsSkeleton() {
    return <div className="earnings-loading" role="status" aria-busy="true" aria-label="Loading earnings report">
        <span className="ops-sr-only">Loading earnings report…</span>
        <div className="earnings-stats">{Array.from({ length: 6 }, (_, i) => <div className="ops-card earnings-stat" key={i}><Skeleton width="48%" height={14} /><Skeleton width="72%" height={32} radius={8} /></div>)}</div>
        <div className="earnings-insights"><div className="ops-card earnings-chart-skeleton"><Skeleton width="45%" height={20} /><Skeleton height={150} radius={12} /></div></div>
        {['Booster earnings', 'Completed orders'].map(label => <div className="ops-card earnings-table-skeleton" key={label}><Skeleton width={190} height={22} /><Skeleton height={42} radius={10} />{Array.from({ length: PAGE_SIZE }, (_, i) => <div className="earnings-skeleton-row" key={i}><Skeleton width="25%" /><Skeleton width="15%" /><Skeleton width="15%" /><Skeleton width="20%" /></div>)}</div>)}
    </div>;
}

function PageFooter({ count, page, onChange, tableId, noun, label }) {
    if (!count) return null;
    return <div className="earnings-pagination"><p role="status">Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, count)} of {count} {noun} · {PAGE_SIZE} per page</p><OrderPagination currentPage={page} totalPages={Math.ceil(count / PAGE_SIZE)} onPageChange={onChange} tableId={tableId} label={label || `${noun === 'boosters' ? 'Booster earnings' : 'Completed orders'} pages`} /></div>;
}

function BoosterRecords({ person, rows, amount }) {
    const [page, setPage] = useState(1);
    const records = rows.filter(row => row.boosters.some(booster => booster.id === person.id) ||
        [...row.shares, ...row.estimatedShares].some(share => share.boosterId === person.id));
    const currentPage = Math.min(page, Math.max(1, Math.ceil(records.length / PAGE_SIZE)));
    const tableId = `booster-records-${person.id}`;
    return <div className="earnings-booster-records">
        <div className="earnings-person-stats">{[
            ['Confirmed earnings', amount(person.confirmedCents)], ['Unconfirmed estimate', amount(person.pendingCents)],
            ['Confirmed orders', person.confirmedOrders], ['Confirmed matches', person.matches],
            ['Avg / order', amount(person.avgOrderCents)], ['Avg / match', amount(person.avgMatchCents)],
        ].map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
        {records.length ? <><div className="ops-table-wrap" tabIndex={0} role="region" aria-label={`Earnings records for ${person.name}`}><table id={tableId}><thead><tr><th>Order / paid date</th><th className="earnings-number">Confirmed earnings</th><th className="earnings-number">Unconfirmed estimate</th><th>Review status</th><th><span className="ops-sr-only">Approval</span></th></tr></thead><tbody>
            {records.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE).map(row => <tr key={row.id}>
                <th scope="row">#{row.orderNumber}<small>{row.paidAt ? date(row.paidAt) : 'Payment date unavailable'}</small></th>
                <td className="earnings-number">{amount(row.amountKnown ? row.shares.find(share => share.boosterId === person.id)?.cents || 0 : null)}</td>
                <td className="earnings-number">{amount(row.amountKnown ? row.estimatedShares.find(share => share.boosterId === person.id)?.cents || 0 : null)}</td>
                <td>{reviewLabels[row.reviewStatus]}</td><td><Link className="earnings-review-link" to={`/match/${row.id}?tab=history`}>Review &amp; approve →</Link></td>
            </tr>)}
        </tbody></table></div><PageFooter count={records.length} page={currentPage} onChange={setPage} tableId={tableId} noun="orders" label={`${person.name} earnings record pages`} /></> : <p className="earnings-empty">No earnings records in this period.</p>}
    </div>;
}

export default function EarningsPage() {
    const [version, setVersion] = useState(0);
    const [state, setState] = useState({ data: null, error: '', version: -1 });
    const [period, setPeriod] = useState('all');
    const [customDates, setCustomDates] = useState({ from: '', to: '' });
    const [boosterQuery, setBoosterQuery] = useState('');
    const [boosterSort, setBoosterSort] = useState('earnings');
    const [boosterPage, setBoosterPage] = useState(1);
    const [orderPage, setOrderPage] = useState(1);
    const [orderQuery, setOrderQuery] = useState('');
    const [orderBooster, setOrderBooster] = useState('');
    const [reviewFilter, setReviewFilter] = useState('all');
    const ordersHeading = useRef(null);
    const boostersHeading = useRef(null);
    const reload = useCallback(() => setVersion(value => value + 1), []);
    useEffect(() => {
        let cancelled = false;
        operations('/earnings').then(data => { if (!cancelled) setState({ data, error: '', version }); })
            .catch(error => { if (!cancelled) setState(previous => ({ ...previous, error: error.message, version })); });
        return () => { cancelled = true; };
    }, [version]);
    useEffect(() => {
        const onFocus = () => { if (!dialogOpen()) reload(); };
        window.addEventListener('focus', onFocus);
        return () => window.removeEventListener('focus', onFocus);
    }, [reload]);
    const loading = state.version !== version;
    const data = state.data;
    const selectedCurrency = REPORT_CURRENCY;
    const dates = period === 'custom' ? customDates : periodDates(period);
    const invalidRange = Boolean(dates.from && dates.to && dates.from > dates.to);
    const rows = filterEarningsRows(data?.rows || [], { currency: selectedCurrency, from: dates.from, to: dates.to });
    const totals = summarizeEarnings(rows);
    const boosters = summarizeBoosters(rows, data?.boosterDirectory);
    const months = buildMonthlyRevenue(rows);
    const sortedBoosters = boosters.filter(person => `${person.name} ${person.username}`.toLowerCase().includes(boosterQuery.trim().toLowerCase())).sort((a, b) => boosterSort === 'name' ? a.name.localeCompare(b.name) : boosterSort === 'matches' ? b.matches - a.matches || a.name.localeCompare(b.name) : b.confirmedCents - a.confirmedCents || b.pendingCents - a.pendingCents || a.name.localeCompare(b.name));
    const ledger = rows.filter(row => (!orderBooster || row.boosters.some(person => person.id === orderBooster)) &&
        (reviewFilter === 'all' || (reviewFilter === 'unconfirmed' ? row.reviewStatus !== 'CONFIRMED' : row.reviewStatus === reviewFilter)) &&
        `${row.orderNumber} ${row.boostType} ${row.boosters.map(person => person.displayName || person.username).join(' ')}`.toLowerCase().includes(orderQuery.trim().toLowerCase()));
    const currentBoosterPage = Math.min(boosterPage, Math.max(1, Math.ceil(sortedBoosters.length / PAGE_SIZE)));
    const currentOrderPage = Math.min(orderPage, Math.max(1, Math.ceil(ledger.length / PAGE_SIZE)));
    const resetPages = () => { setOrderPage(1); setBoosterPage(1); setOrderBooster(''); };
    const scrollTo = ref => requestAnimationFrame(() => {
        ref.current?.focus({ preventScroll: true });
        ref.current?.scrollIntoView({ block: 'start', behavior: 'instant' });
    });
    const undated = (data?.rows || []).filter(row => row.currency === selectedCurrency && !row.paidAt).length;
    const amount = value => formatMoney(value, selectedCurrency);
    const exportOrders = () => downloadCsv(`fastboost-orders-${selectedCurrency}.csv`, ['Order', 'Service', 'Currency', 'Paid date (UTC)', 'Service revenue', 'FastBoost share', 'Booster pool', 'Confirmed booster earnings', 'Awaiting allocation', 'Amount verified', 'Review status', 'Submitted matches', 'Approved matches', 'Pending matches', 'Boosters'], ledger.map(row => [row.orderNumber, row.boostType, row.currency, row.paidAt?.slice(0, 10), decimal(row.revenueCents), decimal(row.platformCents), decimal(row.boosterCents), decimal(row.confirmedBoosterCents), decimal(row.unallocatedCents), row.amountKnown ? 'Yes' : 'No', reviewLabels[row.reviewStatus], row.matchCounts.submitted, row.matchCounts.approved, row.matchCounts.pending, row.boosters.map(person => person.displayName || person.username || person.id).join('; ')]));
    const exportBoosters = () => downloadCsv(`fastboost-booster-earnings-${selectedCurrency}.csv`, ['Booster', 'Username', 'Currency', 'Confirmed earnings', 'Unconfirmed estimate', 'Orders involved', 'Confirmed orders', 'Confirmed matches', 'Average per confirmed order', 'Average per confirmed match'], sortedBoosters.map(person => [person.name, person.username, selectedCurrency, decimal(person.confirmedCents), decimal(person.pendingCents), person.orderCount, person.confirmedOrders, person.matches, decimal(person.avgOrderCents), decimal(person.avgMatchCents)]));

    return <div className="ops-page earnings-page">
        <header className="ops-heading earnings-heading"><div><p className="earnings-eyebrow">Financial overview</p><h1>Earnings</h1><p>Revenue, booster shares, and completed orders ready for review.</p></div></header>
        <section className="earnings-filters" aria-label="Report filters">
            <label>Payment period<select value={period} disabled={loading} onChange={event => { setPeriod(event.target.value); resetPages(); }}><option value="all">All time</option><option value="month">This month</option><option value="last-month">Last month</option><option value="year">This year</option><option value="custom">Custom dates</option></select></label>
            {period === 'custom' && <><label>From<input type="date" value={customDates.from} disabled={loading} onChange={event => { setCustomDates(previous => ({ ...previous, from: event.target.value })); resetPages(); }} /></label><label>To<input type="date" value={customDates.to} min={customDates.from || undefined} disabled={loading} onChange={event => { setCustomDates(previous => ({ ...previous, to: event.target.value })); resetPages(); }} /></label></>}
        </section>
        {invalidRange && <p className="ops-error" role="alert">The end date must be on or after the start date.</p>}
        {state.error && !loading && <div className="ops-error" role="alert"><p>{state.error}{data ? ' Showing the last loaded report.' : ''}</p><button type="button" onClick={reload}>Retry report</button></div>}
        {loading ? <EarningsSkeleton /> : data && <>
            {totals.missingAmounts > 0 && <p className="earnings-data-note" role="status">{totals.missingAmounts} {totals.missingAmounts === 1 ? 'order has' : 'orders have'} no verified amount. These orders remain available for review and are excluded from financial totals and averages.</p>}
            {undated > 0 && <p className="earnings-data-note">{undated} {undated === 1 ? 'order has' : 'orders have'} no payment date and {undated === 1 ? 'is' : 'are'} included only in All time. Undated orders are excluded from the chart.</p>}
            <div className="earnings-stats">
                {[
                    ['Service revenue', totals.revenueCents, 'revenue'],
                    ['FastBoost share · 30%', totals.platformCents, 'platform'],
                    ['Booster pool · 70%', totals.boosterCents, 'pool'],
                    ['Average monthly revenue', averageMonthlyRevenue(rows, dates), ''],
                    ['Confirmed booster earnings', totals.confirmedBoosterCents, 'confirmed'],
                    ['Average per booster', totals.averageBoosterCents, ''],
                ].map(([label, value, tone]) => <section className={`ops-card earnings-stat ${tone}`} key={label}><span>{label}</span><strong>{amount(value)}</strong></section>)}
            </div>
            <p className="earnings-basis">Revenue is after discounts and Gold redemption, before sales tax.</p>
            <div className="earnings-insights">
                <section className="ops-card earnings-trend"><header className="earnings-section-heading"><div><h2>Revenue by payment month</h2><p>Up to 6 most recent months in this report</p></div></header>
                    {months.length ? <><div className="earnings-chart" role="list" aria-label="Monthly service revenue">{months.map(month => <div className="earnings-chart-column" role="listitem" key={month.key} aria-label={`${month.label}: service revenue ${amount(month.revenueCents)}, FastBoost ${amount(month.platformCents)}, booster pool ${amount(month.boosterCents)}, ${month.orderCount} orders`}><strong>{amount(month.revenueCents)}</strong><div className="earnings-bar-track" aria-hidden="true"><div className="earnings-bar" style={{ height: `${month.revenueCents / Math.max(1, ...months.map(item => item.revenueCents)) * 100}%` }}><span className="earnings-bar-pool" style={{ flex: month.boosterCents }} /><span className="earnings-bar-platform" style={{ flex: month.platformCents }} /></div></div><span>{month.label}</span></div>)}</div><div className="earnings-legend"><span><i className="earnings-platform-dot" />FastBoost</span><span><i className="earnings-pool-dot" />Booster pool</span></div></> : <div className="earnings-empty">No dated revenue in this period.</div>}
                </section>
            </div>
            <section className="ops-card earnings-table-card" aria-labelledby="earnings-boosters-heading">
                <header className="earnings-section-heading"><div><h2 ref={boostersHeading} tabIndex={-1} id="earnings-boosters-heading">Booster earnings <span className="earnings-count">{boosters.length}</span></h2><p>Select a booster to view their earnings records.</p></div><button type="button" disabled={!sortedBoosters.length} onClick={exportBoosters}>Export boosters CSV</button></header>
                <div className="earnings-table-filters"><label><span className="ops-sr-only">Search booster earnings</span><input placeholder="Search boosters…" aria-label="Search booster earnings" value={boosterQuery} onChange={event => { setBoosterQuery(event.target.value); setBoosterPage(1); }} /></label><label>Sort by<select value={boosterSort} onChange={event => { setBoosterSort(event.target.value); setBoosterPage(1); }}><option value="earnings">Highest earnings</option><option value="matches">Most confirmed matches</option><option value="name">Name</option></select></label></div>
                <div className="earnings-booster-list" id="earnings-boosters-table">{sortedBoosters.slice((currentBoosterPage - 1) * PAGE_SIZE, currentBoosterPage * PAGE_SIZE).map(person => <details className="earnings-booster" key={person.id}>
                    <summary><span className="earnings-person"><span className="ops-avatar" aria-hidden="true">{person.name.slice(0, 1).toUpperCase()}</span><span>{person.name}{person.username && person.username !== person.name && <small>@{person.username}</small>}</span></span><span className="earnings-chevron" aria-hidden="true">⌄</span></summary>
                    <BoosterRecords key={`${person.id}-${dates.from}-${dates.to}`} person={person} rows={rows} amount={amount} />
                </details>)}</div>
                {!sortedBoosters.length && <div className="earnings-empty">{boosterQuery ? 'No boosters match your search.' : 'No boosters yet.'}</div>}
                <PageFooter count={sortedBoosters.length} page={currentBoosterPage} onChange={next => { setBoosterPage(next); scrollTo(boostersHeading); }} tableId="earnings-boosters-table" noun="boosters" />
            </section>
            <section className="ops-card earnings-table-card" aria-labelledby="earnings-orders-heading">
                <header className="earnings-section-heading"><div><h2 id="earnings-orders-heading" ref={ordersHeading} tabIndex={-1}>Completed orders <span className="earnings-count">{rows.length}</span></h2><p>Review submitted matches and confirm booster shares from each order.</p></div><button type="button" disabled={!ledger.length} onClick={exportOrders}>Export orders CSV</button></header>
                <div className="earnings-table-filters earnings-order-filters"><label><span className="ops-sr-only">Find completed order</span><input aria-label="Find completed order" placeholder="Order number, service or booster…" value={orderQuery} onChange={event => { setOrderQuery(event.target.value); setOrderPage(1); }} /></label><label>Review status<select value={reviewFilter} onChange={event => { setReviewFilter(event.target.value); setOrderPage(1); }}><option value="all">All statuses</option><option value="unconfirmed">Not confirmed</option>{Object.entries(reviewLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label>Booster<select value={orderBooster} onChange={event => { setOrderBooster(event.target.value); setOrderPage(1); }}><option value="">All boosters</option>{boosters.map(person => <option value={person.id} key={person.id}>{person.name}</option>)}</select></label></div>
                {orderBooster && <p className="earnings-table-note">Showing orders involving this booster. Revenue and pool columns cover the entire order; select their name above to view individual earnings.</p>}
                <div className="ops-table-wrap" tabIndex={0} role="region" aria-label="Completed orders table"><table id="earnings-orders-table"><thead><tr><th scope="col">Order / paid date</th><th scope="col" className="earnings-number">Revenue</th><th scope="col" className="earnings-number">FastBoost</th><th scope="col" className="earnings-number">Booster pool</th><th scope="col">Matches</th><th scope="col">Review status</th><th scope="col"><span className="ops-sr-only">Review action</span></th></tr></thead><tbody>{ledger.slice((currentOrderPage - 1) * PAGE_SIZE, currentOrderPage * PAGE_SIZE).map(row => <tr key={row.id}><th scope="row"><Link to={`/admin/orders/${row.id}`}>#{row.orderNumber}</Link><small>{row.boostType}{row.queueType ? ` · ${row.queueType}` : ''}</small><small>{row.paidAt ? date(row.paidAt) : 'Payment date unavailable'}</small></th><td className="earnings-number">{amount(row.revenueCents)}{!row.amountKnown && <small className="earnings-warning">Amount missing</small>}</td><td className="earnings-number">{amount(row.platformCents)}</td><td className="earnings-number">{amount(row.boosterCents)}</td><td>{row.matchCounts.approved} / {row.matchCounts.submitted} approved<small>{row.matchCounts.pending ? `${row.matchCounts.pending} to review` : row.matchCounts.rejected ? `${row.matchCounts.rejected} excluded / returned` : row.boosters.length ? `${row.boosters.length} ${row.boosters.length === 1 ? 'booster' : 'boosters'}` : 'No booster submissions'}</small></td><td><span className={`ops-badge earnings-badge ${row.reviewStatus === 'CONFIRMED' ? 'approved' : row.reviewStatus === 'READY_TO_CONFIRM' ? 'ready' : ''}`}>{reviewLabels[row.reviewStatus]}</span></td><td><Link className="earnings-review-link" to={`/match/${row.id}?tab=history`}>{row.reviewStatus === 'CONFIRMED' ? 'View approval' : 'Review & approve'} →</Link></td></tr>)}</tbody></table></div>
                {!ledger.length && <div className="earnings-empty">{rows.length ? 'No completed orders match these filters.' : 'No completed, paid orders in this period.'}</div>}
                <PageFooter count={ledger.length} page={currentOrderPage} onChange={next => { setOrderPage(next); scrollTo(ordersHeading); }} tableId="earnings-orders-table" noun="orders" />
            </section>
        </>}
    </div>;
}

function dialogOpen() { return Boolean(document.querySelector('dialog[open]')); }
