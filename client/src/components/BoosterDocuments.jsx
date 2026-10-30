import { useState } from 'react';
import { Link } from 'react-router-dom';
import { date } from '../api/operations';
import { nativeContractPendingStatus } from '../utils/contractSigning';
import { payoutPath, payoutStatus, PAYOUT_COUNTRIES } from '../utils/payoutInformation';
import OrderPagination from './OrderPagination';

const PAGE_SIZE = 3;

export default function BoosterDocuments({ boosterId, contracts = [], payouts = [] }) {
    const documents = [
        ...contracts.map(contract => ({ kind: 'contract', key: `contract-${contract.id}`, value: contract })),
        ...payouts.map(payout => ({ kind: 'payout', key: `payout-${payout.id}`, value: payout })),
    ].sort((a, b) => (Date.parse(b.value.createdAt) || 0) - (Date.parse(a.value.createdAt) || 0) || a.key.localeCompare(b.key));
    const firstId = documents[0]?.key || null;
    const [pagination, setPagination] = useState({ boosterId, firstId, page: 1 });
    const totalPages = Math.max(1, Math.ceil(documents.length / PAGE_SIZE));
    const currentPage = pagination.boosterId === boosterId && pagination.firstId === firstId
        ? Math.min(pagination.page, totalPages) : 1;
    const offset = (currentPage - 1) * PAGE_SIZE;
    const listId = `booster-documents-${boosterId}`;
    const changePage = page => setPagination({ boosterId, firstId, page: Math.max(1, Math.min(page, totalPages)) });

    return <>
        <h3>Documents</h3>
        <div id={listId}>
            {documents.length ? documents.slice(offset, offset + PAGE_SIZE).map(({ kind, key, value }) => kind === 'contract'
                ? <Link className="ops-contract-link" to={`/provider/contracts/${encodeURIComponent(value.id)}`} key={key}>
                    <span>{value.title}<small>{date(value.createdAt)}</small></span>
                    <span className={`ops-badge ${value.signedAt ? 'approved' : ''}`}>{value.archivedAt ? 'Archived' : value.signedAt ? `Signed ${date(value.signedAt)}` : value.signingProvider === 'FASTBOOST' ? nativeContractPendingStatus(value) : 'Awaiting signature'} →</span>
                </Link>
                : <Link className="ops-contract-link" to={payoutPath(value.id)} key={key}>
                    <span>Payout Information<small>Remitly · {PAYOUT_COUNTRIES[value.country]} · {date(value.createdAt)}</small></span>
                    <span className={`ops-badge ${value.status === 'VERIFIED' ? 'approved' : ''}`}>{payoutStatus(value.status)} →</span>
                </Link>) : <p>No documents sent yet.</p>}
        </div>
        {documents.length > PAGE_SIZE && <div className="ops-contributions-pagination">
            <p role="status">Showing {offset + 1}–{Math.min(offset + PAGE_SIZE, documents.length)} of {documents.length} documents · {PAGE_SIZE} per page</p>
            <OrderPagination currentPage={currentPage} totalPages={totalPages} onPageChange={changePage} tableId={listId} label="Document pages" />
        </div>}
    </>;
}
