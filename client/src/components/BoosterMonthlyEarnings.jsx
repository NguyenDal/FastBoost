import ArrowUpRightIcon from './ArrowUpRightIcon';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { operations, money } from '../api/operations';
import { API_BASE_URL } from '../api/config';
import { authStorage } from '../utils/authStorage';
import OrderPagination from './OrderPagination';
import { chronologicalMonths, monthAmount, monthWindow, chartScale, daysUntilPayout } from '../utils/monthlyEarningsChart';

function periodRange(period, timeZone) {
    if (!period) return '';
    const format = new Intl.DateTimeFormat('en-US', { timeZone, month: 'short', day: 'numeric', year: 'numeric' });
    // Period end is exclusive; display the last calendar day included.
    return `${format.format(new Date(period.startsAt))} – ${format.format(new Date(new Date(period.endsAt).getTime() - 1))}`;
}

function MonthDetails({ month, version, timeZone, onReport }) {
    const [state, setState] = useState({ data: null, error: '' });
    const [attempt, setAttempt] = useState(0);
    const [page, setPage] = useState(1);
    useEffect(() => {
        let active = true;
        operations(`/me/monthly-earnings/${month}`).then(data => { if (active) { setState({ data, error: '' }); onReport(data, version); } })
            .catch(error => { if (active) setState({ data: null, error: error.message }); });
        return () => { active = false; };
    }, [month, version, attempt, onReport]);
    if (state.error) return <div className="ops-error" role="alert">{state.error} <button type="button" onClick={() => setAttempt(value => value + 1)}>Try again</button></div>;
    if (!state.data) return <p role="status">Loading month details…</p>;
    const { period } = state.data;
    const entries = state.data.entries.filter(entry => entry.currency === 'USD');
    const pages = Math.max(1, Math.ceil(entries.length / 10));
    const currentPage = Math.min(page, pages);
    return <div className="booster-month-detail" id="booster-month-detail" aria-label={`${period.label} details`}>
        {entries.length ? <>
            <ul className="booster-month-entries" id="booster-month-entries" aria-label="Monthly order activity">
                {entries.slice((currentPage - 1) * 10, currentPage * 10).map(entry => <li key={entry.id}>
                    <div>
                        {entry.orderId ? <Link to={`/match/${encodeURIComponent(entry.orderId)}?tab=history`} className="booster-month-order-link" aria-label={`View match history for order #${entry.orderNumber}`} title="View match history">#{entry.orderNumber} <span aria-hidden="true"><ArrowUpRightIcon /></span></Link> : <strong>#{entry.orderNumber}</strong>}
                        <span>{new Date(entry.recognizedAt).toLocaleDateString('en-CA', { timeZone, month: 'short', day: 'numeric' })} · {entry.serviceTitle}{entry.kind === 'ADJUSTMENT' ? ' · Adjustment' : ''}</span>
                    </div>
                    <strong className={entry.amountCents < 0 ? 'booster-amount-negative' : ''}>{money(entry.amountCents, entry.currency)}</strong>
                </li>)}
            </ul>
            <div className="ops-contributions-pagination"><p role="status">Showing {(currentPage - 1) * 10 + 1}–{Math.min(currentPage * 10, entries.length)} of {entries.length} entries · 10 per page</p><OrderPagination currentPage={currentPage} totalPages={pages} onPageChange={setPage} tableId="booster-month-entries" label="Monthly activity pages" /></div>
        </> : <p className="booster-statement-empty">No earnings recorded for this month.</p>}
    </div>;
}

export default function BoosterMonthlyEarnings({ version = 0 }) {
    const [state, setState] = useState({ data: null, error: '' });
    const [attempt, setAttempt] = useState(0);
    const [downloading, setDownloading] = useState('');
    const [downloadError, setDownloadError] = useState('');
    const [selectedMonth, setSelectedMonth] = useState('');
    const [chartPage, setChartPage] = useState(0);
    const [now, setNow] = useState(() => new Date());
    const [reportTotals, setReportTotals] = useState({});
    const reportVersion = `${version}:${attempt}`;
    const receiveReport = useCallback((report, loadedVersion) => {
        setReportTotals(current => ({ ...current, [report.period.month]: { totals: report.totals, version: loadedVersion } }));
    }, []);
    useEffect(() => {
        const timer = setInterval(() => setNow(new Date()), 60000);
        return () => clearInterval(timer);
    }, []);
    useEffect(() => {
        let active = true;
        operations('/me/monthly-earnings').then(data => { if (active) setState({ data, error: '' }); })
            .catch(error => { if (active) setState({ data: null, error: error.message }); });
        return () => { active = false; };
    }, [version, attempt]);
    useEffect(() => {
        if (!state.data?.current.endsAt) return;
        const refresh = () => { setNow(new Date()); setAttempt(value => value + 1); };
        const delay = Math.min(86400000, Math.max(1000, new Date(state.data.current.endsAt).getTime() - Date.now() + 1000));
        const timer = setTimeout(refresh, delay);
        window.addEventListener('focus', refresh);
        return () => { clearTimeout(timer); window.removeEventListener('focus', refresh); };
    }, [state.data]);
    async function download(month) {
        if (downloading || !months.some(period => period.month === month && period.closed)) return;
        setDownloading(month); setDownloadError('');
        try {
            const response = await fetch(`${API_BASE_URL}/operations/me/monthly-earnings/${month}/pdf`, { headers: { Authorization: `Bearer ${authStorage.getItem('token')}` } });
            if (!response.ok) throw new Error((await response.json()).message || 'Could not download your statement.');
            const url = URL.createObjectURL(await response.blob());
            const link = document.createElement('a'); link.href = url; link.download = `FastBoost-earnings-${month}.pdf`; link.click();
            setTimeout(() => URL.revokeObjectURL(url), 60000);
        } catch (error) { setDownloadError(error.message); }
        finally { setDownloading(''); }
    }
    const { data, error } = state;
    const months = data ? chronologicalMonths(data).map(period => reportTotals[period.month]?.version === reportVersion
        ? { ...period, totals: reportTotals[period.month].totals } : period) : [];
    const currency = 'USD';
    const openingBalances = data?.openingBalances.filter(total => total.currency === currency) || [];
    const chartWindow = monthWindow(months, { page: chartPage, size: 6 });
    const scale = chartScale(chartWindow.months.map(month => monthAmount(month, currency)));
    const selected = months.some(month => month.month === selectedMonth) ? selectedMonth : data?.current.month;
    const selectedPeriod = months.find(month => month.month === selected);
    const payoutDays = selectedPeriod && !selectedPeriod.closed ? daysUntilPayout(selectedPeriod.endsAt, data.timeZone, now) : 0;
    return <section className="ops-card booster-monthly-earnings">
        <div className="booster-chart-heading">
            <div>
                <h2>Monthly earnings</h2>
                {data && <div className="booster-selected-summary" aria-live="polite"><p>{periodRange(selectedPeriod, data.timeZone)}</p><strong>{money(monthAmount(selectedPeriod, currency), currency)}</strong></div>}
            </div>
            {data && <div className="booster-chart-actions">
                {selectedPeriod?.closed
                    ? <button type="button" disabled={!!downloading} onClick={() => download(selected)} aria-label={`Export PDF for ${selectedPeriod.label}`} title={selectedPeriod.label}>{downloading ? 'Preparing…' : 'Export PDF'}</button>
                    : <span className="booster-payout-countdown" role="status">{payoutDays === 0 ? 'Pay today' : `Pay in ${payoutDays} ${payoutDays === 1 ? 'day' : 'days'}`}</span>}
                {chartWindow.totalPages > 1 && <div className="booster-chart-pages"><OrderPagination currentPage={chartWindow.totalPages - chartWindow.page} totalPages={chartWindow.totalPages} onPageChange={page => setChartPage(chartWindow.totalPages - page)} tableId="booster-earnings-chart" label="Monthly earnings chart pages" /></div>}
            </div>}
        </div>
        {error && <div className="ops-error" role="alert">{error} <button type="button" onClick={() => setAttempt(value => value + 1)}>Try again</button></div>}
        {!data && !error && <p role="status">Loading your earnings…</p>}
        {data && <>
            {downloadError && <p className="ops-error" role="alert">{downloadError}</p>}
            {openingBalances.length > 0 && <div className="booster-opening-balance"><strong>Earlier confirmed earnings</strong><p>{openingBalances.map(total => money(total.amountCents, total.currency)).join(' · ')}</p><small>Recorded before monthly tracking began. Kept separate from this period.</small></div>}
            <div className="booster-monthly-reports">
                <div className="booster-earnings-chart" id="booster-earnings-chart" role="group" aria-label={`Monthly earnings in ${currency}`}>
                    {chartWindow.months.map(month => {
                        const amount = monthAmount(month, currency);
                        const position = scale.position(amount);
                        return <button type="button" key={month.month} className="booster-month-bar" aria-pressed={selected === month.month} aria-controls="booster-month-detail" aria-label={`${month.label}: ${money(amount, currency)} ${currency}`} onClick={() => { setSelectedMonth(month.month); setDownloadError(''); }}>
                            <span className="booster-bar-value">{money(amount, currency)}</span>
                            <span className="booster-bar-track" aria-hidden="true"><span className="booster-chart-baseline" style={{ bottom: `${scale.baseline}%` }} /><span className={`booster-bar-fill${amount < 0 ? ' negative' : ''}`} style={{ bottom: `${Math.min(position, scale.baseline)}%`, height: `${Math.abs(position - scale.baseline)}%` }} /></span>
                            <span className="booster-bar-month">{new Date(`${month.month}-15T12:00:00Z`).toLocaleDateString('en-CA', { month: 'short', timeZone: 'UTC' })}<small>{month.month.slice(0, 4)}</small></span>
                        </button>;
                    })}
                </div>
                <MonthDetails key={selected} month={selected} version={reportVersion} timeZone={data.timeZone} onReport={receiveReport} />
            </div>
        </>}
    </section>;
}
