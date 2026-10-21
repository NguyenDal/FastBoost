import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Skeleton } from './Skeleton';
import OrderPagination from './OrderPagination';

const PAGE_SIZE = 10;
const historyId = 'wallet-history-list';
const money = cents => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);

function ActivitySkeleton() {
    return <div className="wallet-history-skeleton" role="status" aria-label="Loading wallet activity">{Array.from({ length: 3 }, (_, index) => <div className="wallet-history-skeleton-row" key={index}>
        <Skeleton width={36} height={36} radius={11} />
        <div><Skeleton width="70%" height={14} /><Skeleton width="42%" height={11} /></div>
        <Skeleton width={72} height={18} />
    </div>)}</div>;
}

function RefreshIcon() {
    return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5M5.4 8a7 7 0 0 1 11.5-2L20 9M4 15l3.1 3A7 7 0 0 0 18.6 16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

export default function WalletActivity({ transactions = [], loading = false, busy = false, onRefresh }) {
    const firstId = transactions[0]?.id || null;
    const [pagination, setPagination] = useState({ firstId, page: 1 });
    const heading = useRef(null);
    const totalPages = Math.max(1, Math.ceil(transactions.length / PAGE_SIZE));
    // New activity should appear immediately. A refresh with the same newest
    // entry keeps the reader's page, while shorter results clamp to a valid page.
    const currentPage = pagination.firstId === firstId ? Math.min(pagination.page, totalPages) : 1;
    const offset = (currentPage - 1) * PAGE_SIZE;
    const changePage = next => {
        setPagination({ firstId, page: Math.max(1, Math.min(next, totalPages)) });
        heading.current?.focus({ preventScroll: true });
        heading.current?.scrollIntoView({ block: 'start', behavior: 'instant' });
    };

    return <section className="wallet-section" aria-labelledby="wallet-history-title" aria-busy={loading}>
        <div className="wallet-section-heading"><div><h2 id="wallet-history-title" ref={heading} tabIndex={-1}>Recent activity</h2><p>Your top ups, bonuses and order payments.</p></div><button className="wallet-refresh" type="button" aria-label={loading ? 'Refreshing wallet activity' : 'Refresh wallet activity'} title="Refresh activity" disabled={loading || busy || !onRefresh} onClick={onRefresh}><RefreshIcon /></button></div>
        {loading ? <ActivitySkeleton /> : transactions.length ? <>
            <ol className="wallet-history" id={historyId} start={offset + 1}>{transactions.slice(offset, offset + PAGE_SIZE).map(item => <li key={item.id}>
                <span className={`wallet-history-icon${item.amountCents < 0 ? ' is-payment' : ''}`} aria-hidden="true">{item.amountCents < 0 ? '↗' : '+'}</span>
                <div><strong>{item.description || (item.amountCents < 0 ? 'Order payment' : 'Wallet top up')}</strong><span>{new Date(item.createdAt).toLocaleDateString('en-CA', { year: 'numeric', month: 'short', day: 'numeric' })}{item.orderId && <> · <Link to={`/match/${encodeURIComponent(item.orderId)}`}>View order</Link></>}</span></div>
                <strong className={item.amountCents > 0 ? 'wallet-history-credit' : ''}>{item.amountCents > 0 ? '+' : ''}{money(item.amountCents)}</strong>
            </li>)}</ol>
            <div className="wallet-activity-pagination"><p role="status">Showing {offset + 1}–{Math.min(offset + PAGE_SIZE, transactions.length)} of {transactions.length} transactions · {PAGE_SIZE} per page</p><OrderPagination currentPage={currentPage} totalPages={totalPages} onPageChange={changePage} tableId={historyId} label="Wallet activity pages" /></div>
        </> : <div className="wallet-empty"><span aria-hidden="true">↗</span><strong>Your wallet starts here</strong><p>Completed top ups and wallet payments will appear here.</p></div>}
    </section>;
}
