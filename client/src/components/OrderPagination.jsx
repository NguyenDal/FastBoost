function pageItems(currentPage, totalPages) {
    if (totalPages <= 7) {
        return Array.from({ length: totalPages }, (_, index) => index + 1);
    }
    if (currentPage <= 4) return [1, 2, 3, 4, 5, "end-gap", totalPages];
    if (currentPage >= totalPages - 3) {
        return [1, "start-gap", totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
    }
    return [1, "start-gap", currentPage - 1, currentPage, currentPage + 1, "end-gap", totalPages];
}

export default function OrderPagination({ currentPage, totalPages, onPageChange, tableId = "customer-orders-table", label = "Orders pagination" }) {
    return (
        <nav className="order-pagination" aria-label={label}>
            <button
                type="button"
                aria-label="Previous page"
                aria-controls={tableId}
                disabled={currentPage === 1}
                onClick={() => onPageChange(currentPage - 1)}
            >
                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="m14 6-6 6 6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
            </button>
            {pageItems(currentPage, totalPages).map(item => typeof item === "number" ? (
                <button
                    key={item}
                    type="button"
                    aria-label={`Page ${item}`}
                    aria-current={item === currentPage ? "page" : undefined}
                    aria-controls={tableId}
                    onClick={() => onPageChange(item)}
                >
                    {item}
                </button>
            ) : <span className="order-pagination-gap" key={item} aria-hidden="true">…</span>)}
            <button
                type="button"
                aria-label="Next page"
                aria-controls={tableId}
                disabled={currentPage === totalPages}
                onClick={() => onPageChange(currentPage + 1)}
            >
                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="m10 6 6 6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
            </button>
        </nav>
    );
}
