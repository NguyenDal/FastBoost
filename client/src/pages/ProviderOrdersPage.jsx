import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Navbar from "../components/Navbar";
import { providerListAssignedOrders } from "../api/providerOrders";
import "../styles/Admin.css";

function useProviderGuard() {
    const navigate = useNavigate();
    const [isProvider, setIsProvider] = useState(false);

    useEffect(() => {
        const check = () => {
            const token = localStorage.getItem("token");
            const userRaw = localStorage.getItem("user");

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
    const [status, setStatus] = useState("");
    const [page, setPage] = useState(1);
    const [pageSize] = useState(20);

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [data, setData] = useState({
        items: [],
        total: 0,
        page: 1,
        pageSize: 20,
    });

    const totalPages = useMemo(
        () => Math.max(1, Math.ceil((data?.total || 0) / pageSize)),
        [data, pageSize]
    );

    useEffect(() => {
        if (!isProvider) return;

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

                setData(res);
            } catch (e) {
                setError(e?.message || "Failed to load assigned orders");
            } finally {
                setLoading(false);
            }
        };

        load();
    }, [isProvider, page, pageSize, status, query]);

    if (!isProvider) return null;

    return (
        <div className="page-shell">
            <Navbar />

            <div className="page-container">
                <div className="admin-list-hero provider-list-hero">
                    <div>
                        <p className="admin-eyebrow">FastBoost Provider</p>
                        <h1 className="admin-order-title">Assigned Orders</h1>
                        <p className="admin-list-subtitle">
                            View orders assigned to you, check customer request details, and open the order conversation.
                        </p>
                    </div>

                    <div className="admin-list-stats">
                        <div className="admin-stat-card">
                            <span>Assigned Orders</span>
                            <strong>{data.total}</strong>
                        </div>

                        <div className="admin-stat-card">
                            <span>Current Page</span>
                            <strong>{page}</strong>
                        </div>
                    </div>
                </div>

                <div className="admin-toolbar premium-toolbar">
                    <input
                        placeholder="Search by order ID, customer, or service"
                        value={query}
                        onChange={(e) => {
                            setQuery(e.target.value);
                            setPage(1);
                        }}
                        className="admin-input"
                        style={{ minWidth: 300 }}
                    />

                    <select
                        value={status}
                        onChange={(e) => {
                            setStatus(e.target.value);
                            setPage(1);
                        }}
                        className="admin-select"
                    >
                        <option value="">All statuses</option>
                        <option value="PENDING">PENDING</option>
                        <option value="IN_PROGRESS">IN_PROGRESS</option>
                        <option value="COMPLETED">COMPLETED</option>
                        <option value="CANCELLED">CANCELLED</option>
                    </select>
                </div>

                {loading ? (
                    <p className="muted-text">Loading assigned orders...</p>
                ) : error ? (
                    <p style={{ color: "#ef4444" }}>{error}</p>
                ) : (
                    <div className="admin-table-wrap premium-table-wrap">
                        <table className="admin-table">
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
                                        <td className="mono order-id-cell">#{o.id.slice(0, 6)}</td>
                                        <td>{new Date(o.createdAt).toLocaleString()}</td>
                                        <td><StatusBadge status={o.status} /></td>

                                        <td>
                                            <div className="customer-cell">
                                                <span>
                                                    {o.customer?.username ||
                                                        o.customer?.profile?.displayName ||
                                                        o.customer?.email?.split("@")[0] ||
                                                        "Customer"}
                                                </span>
                                                <small>{o.customer?.email}</small>
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
                                            <Link className="secondary-btn" to={`/match/${o.id}`}>
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

                <div className="admin-pagination">
                    <span>Total: {data.total}</span>

                    <div style={{ display: "flex", gap: 8 }}>
                        <button
                            className="secondary-btn"
                            disabled={page <= 1}
                            onClick={() => setPage((p) => Math.max(1, p - 1))}
                        >
                            Prev
                        </button>

                        <span style={{ padding: "6px 10px" }}>
                            {page} / {totalPages}
                        </span>

                        <button
                            className="secondary-btn"
                            disabled={page >= totalPages}
                            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                        >
                            Next
                        </button>
                    </div>
                </div>
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