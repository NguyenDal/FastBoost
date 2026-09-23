import { authStorage } from "../utils/authStorage";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Navbar from "../components/Navbar";
import { GenericPageSkeleton } from "../components/PageSkeletons";
import OrderPagination from "../components/OrderPagination";
import { providerListAssignedOrders } from "../api/providerOrders";
import "../styles/Admin.css";

function useProviderGuard() {
    const navigate = useNavigate();
    const [isProvider, setIsProvider] = useState(false);

    useEffect(() => {
        const check = () => {
            const token = authStorage.getItem("token");
            const userRaw = authStorage.getItem("user");

            if (!token || !userRaw) {
                navigate("/", { replace: true });
                return;
            }

            try {
                const user = JSON.parse(userRaw);

                if (user?.role !== "PROVIDER" && user?.role !== "ADMIN") {
                    navigate("/", { replace: true });
                } else {
                    setIsProvider(true);
                }
            } catch {
                navigate("/", { replace: true });
            }
        };

        check();

        window.addEventListener("focus", check);
        document.addEventListener("visibilitychange", check);
        window.addEventListener("auth:changed", check);

        return () => {
            window.removeEventListener("focus", check);
            document.removeEventListener("visibilitychange", check);
            window.removeEventListener("auth:changed", check);
        };
    }, [navigate]);

    return isProvider;
}

export default function ProviderOrdersPage() {
    const isProvider = useProviderGuard();

    const [query, setQuery] = useState("");
    const [status, setStatus] = useState("CURRENT");
    const [page, setPage] = useState(1);
    const [pageSize] = useState(10);

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [data, setData] = useState({
        items: [],
        total: 0,
        page: 1,
        pageSize: 10,
    });

    const totalPages = useMemo(
        () => Math.max(1, Math.ceil((data?.total || 0) / pageSize)),
        [data, pageSize]
    );

    useEffect(() => {
        if (!isProvider) return;
        let active = true;

        const load = async () => {
            setLoading(true);
            setError("");

            try {
                const res = await providerListAssignedOrders({
                    page,
                    pageSize,
                    status: status || undefined,
                    q: query || undefined,
                });

                if (active) setData(res);
            } catch (e) {
                if (active) setError(e?.message || "Failed to load assigned orders");
            } finally {
                if (active) setLoading(false);
            }
        };

        load();
        return () => { active = false; };
    }, [isProvider, page, pageSize, status, query]);

    if (!isProvider) return null;

    return (
        <div className="page-shell">
            <Navbar />

            <div className="page-container provider-orders-page">
                <div className="provider-orders-header">
                    <h1 className="admin-order-title">Assigned Orders</h1>
                    <div className="admin-stat-card provider-assigned-count">
                        <span>Assigned Orders</span>
                        <strong>{data.total}</strong>
                    </div>
                </div>

                <div className="admin-toolbar premium-toolbar">
                    <input
                        aria-label="Search assigned orders"
                        placeholder="Search by order ID, customer, or service"
                        value={query}
                        onChange={(e) => {
                            setQuery(e.target.value);
                            setPage(1);
                        }}
                        className="admin-input"
                    />

                    <select
                        aria-label="Order status"
                        value={status}
                        onChange={(e) => {
                            setStatus(e.target.value);
                            setPage(1);
                        }}
                        className="admin-select"
                    >
                        <option value="CURRENT">Current Orders</option>
                        <option value="PENDING">Pending</option>
                        <option value="IN_PROGRESS">In Progress</option>
                        <option value="COMPLETED">Completed</option>
                        <option value="CANCELLED">Cancelled</option>
                    </select>
                </div>

                {loading ? (
                    <GenericPageSkeleton />
                ) : error ? (
                    <p style={{ color: "#ef4444" }}>{error}</p>
                ) : (
                    <div className="admin-table-wrap premium-table-wrap" role="region" aria-label="Assigned orders table" tabIndex={0}>
                        <table className="admin-table" id="provider-orders-table">
                            <thead>
                                <tr>
                                    <th>ID</th>
                                    <th>Created</th>
                                    <th>Status</th>
                                    <th>Customer</th>
                                    <th>Service</th>
                                    <th>Region</th>
                                    <th>Total</th>
                                    <th></th>
                                </tr>
                            </thead>

                            <tbody>
                                {data.items.map((o) => (
                                    <tr key={o.id}>
                                        <td className="mono order-id-cell">#{o.orderNumber}</td>
                                        <td>{new Date(o.createdAt).toLocaleString()}</td>
                                        <td><StatusBadge status={o.status} /></td>

                                        <td>
                                            <div className="customer-cell">
                                                <span>{o.customer?.username || "No username"}</span>
                                                <small>{o.customer?.email || o.customer?.profile?.displayName || "Customer"}</small>
                                            </div>
                                        </td>

                                        <td>
                                            <div className="service-cell">
                                                <span>{o.service?.title || o.boostType || "Order"}</span>
                                                <small>{o.boostType || "Assigned Order"}</small>
                                            </div>
                                        </td>

                                        <td>{o.region || "-"}</td>

                                        <td className="price-cell">
                                            ${Number(o.totalPrice || 0).toFixed(2)}
                                        </td>

                                        <td className="right">
                                            <Link className="secondary-btn" to={`/provider/orders/${o.id}`}>
                                                Open
                                            </Link>
                                        </td>
                                    </tr>
                                ))}

                                {data.items.length === 0 && (
                                    <tr>
                                        <td colSpan={8} className="admin-empty">
                                            No assigned orders yet.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                )}

                {!loading && !error && data.total > 0 && (
                    <OrderPagination
                        currentPage={page}
                        totalPages={totalPages}
                        onPageChange={setPage}
                        tableId="provider-orders-table"
                        label="Assigned orders pagination"
                    />
                )}
            </div>
        </div>
    );
}

function StatusBadge({ status }) {
    const cls =
        status === "COMPLETED"
            ? "status-badge status-complete"
            : status === "IN_PROGRESS"
                ? "status-badge status-progress"
                : status === "CANCELLED"
                    ? "status-badge status-cancel"
                    : "status-badge status-pending";

    return <span className={cls}>{status}</span>;
}
