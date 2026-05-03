import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Navbar from "../components/Navbar";
import { customerListMyOrders } from "../api/customerOrders";
import "../styles/Admin.css";

function getStoredUser() {
    try {
        return JSON.parse(localStorage.getItem("user") || "null");
    } catch {
        return null;
    }
}

function useCustomerGuard() {
    const navigate = useNavigate();
    const [allowed, setAllowed] = useState(false);

    useEffect(() => {
        const check = () => {
            const token = localStorage.getItem("token");
            const user = getStoredUser();

            if (!token || !user) {
                navigate("/", { replace: true });
                return;
            }

            if (user.role !== "CUSTOMER" && user.role !== "ADMIN") {
                navigate("/", { replace: true });
                return;
            }

            setAllowed(true);
        };

        check();

        window.addEventListener("focus", check);
        window.addEventListener("auth:changed", check);

        return () => {
            window.removeEventListener("focus", check);
            window.removeEventListener("auth:changed", check);
        };
    }, [navigate]);

    return allowed;
}

export default function CustomerOrdersPage() {
    const allowed = useCustomerGuard();

    const [orders, setOrders] = useState([]);
    const [query, setQuery] = useState("");
    const [status, setStatus] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

    useEffect(() => {
        if (!allowed) return;

        const load = async () => {
            try {
                setLoading(true);
                setError("");

                const items = await customerListMyOrders();
                setOrders(items);
            } catch (e) {
                setError(e.message || "Failed to load your orders");
            } finally {
                setLoading(false);
            }
        };

        load();
    }, [allowed]);

    const filteredOrders = useMemo(() => {
        return orders.filter((order) => {
            const q = query.trim().toLowerCase();

            const matchesSearch =
                !q ||
                order.id?.toLowerCase().includes(q) ||
                order.service?.title?.toLowerCase().includes(q) ||
                order.boostType?.toLowerCase().includes(q) ||
                order.region?.toLowerCase().includes(q);

            const matchesStatus = !status || order.status === status;

            return matchesSearch && matchesStatus;
        });
    }, [orders, query, status]);

    if (!allowed) return null;

    return (
        <div className="page-shell">
            <Navbar />

            <div className="page-container">
                <div className="admin-list-hero customer-list-hero">
                    <div>
                        <p className="admin-eyebrow">FastBoost Account</p>
                        <h1 className="admin-order-title">My Orders</h1>
                        <p className="admin-list-subtitle">
                            Track your active orders, view order details, and open chat with your assigned booster.
                        </p>
                    </div>

                    <div className="admin-list-stats">
                        <div className="admin-stat-card">
                            <span>Total Orders</span>
                            <strong>{orders.length}</strong>
                        </div>

                        <div className="admin-stat-card">
                            <span>Visible</span>
                            <strong>{filteredOrders.length}</strong>
                        </div>
                    </div>
                </div>

                <div className="admin-toolbar premium-toolbar">
                    <input
                        className="admin-input"
                        placeholder="Search by order ID, service, boost type, or region"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        style={{ minWidth: 320 }}
                    />

                    <select
                        className="admin-select"
                        value={status}
                        onChange={(e) => setStatus(e.target.value)}
                    >
                        <option value="">All statuses</option>
                        <option value="PENDING">PENDING</option>
                        <option value="IN_PROGRESS">IN_PROGRESS</option>
                        <option value="COMPLETED">COMPLETED</option>
                        <option value="CANCELLED">CANCELLED</option>
                    </select>
                </div>

                {loading ? (
                    <p className="muted-text">Loading your orders...</p>
                ) : error ? (
                    <p style={{ color: "#ef4444" }}>{error}</p>
                ) : (
                    <div className="admin-table-wrap premium-table-wrap">
                        <table className="admin-table">
                            <thead>
                                <tr>
                                    <th>Order</th>
                                    <th>Created</th>
                                    <th>Status</th>
                                    <th>Service</th>
                                    <th>Boost Path</th>
                                    <th>Region</th>
                                    <th>Total</th>
                                    <th></th>
                                </tr>
                            </thead>

                            <tbody>
                                {filteredOrders.map((order) => (
                                    <tr key={order.id}>
                                        <td className="mono order-id-cell">
                                            #{order.id.slice(0, 8)}
                                        </td>

                                        <td>
                                            {order.createdAt
                                                ? new Date(order.createdAt).toLocaleString()
                                                : "-"}
                                        </td>

                                        <td>
                                            <StatusBadge status={order.status} />
                                        </td>

                                        <td>
                                            <div className="service-cell">
                                                <span>{order.service?.title || order.boostType || "Order"}</span>
                                                <small>{order.boostType || "Custom order"}</small>
                                            </div>
                                        </td>

                                        <td>
                                            <div className="service-cell">
                                                <span>
                                                    {buildBoostPath(order)}
                                                </span>
                                                <small>{order.queueType || "-"}</small>
                                            </div>
                                        </td>

                                        <td>{order.region || "-"}</td>

                                        <td className="price-cell">
                                            ${Number(order.totalPrice || 0).toFixed(2)}
                                        </td>

                                        <td className="right">
                                            <Link className="secondary-btn" to={`/match/${order.id}`}>
                                                Open Chat
                                            </Link>
                                        </td>
                                    </tr>
                                ))}

                                {filteredOrders.length === 0 && (
                                    <tr>
                                        <td colSpan={8} className="admin-empty">
                                            No orders found.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}

function buildBoostPath(order) {
    if (order.boostType === "Placements") {
        return `${order.placementGames || "-"} placement games`;
    }

    if (order.boostType === "Ranked Wins") {
        return `${order.desiredWins || "-"} wins`;
    }

    if (order.boostType === "Pro Duo") {
        return `${order.numberOfGames || "-"} games`;
    }

    if (order.currentRank && order.desiredRank) {
        return `${order.currentRank} → ${order.desiredRank}`;
    }

    return order.boostType || "-";
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