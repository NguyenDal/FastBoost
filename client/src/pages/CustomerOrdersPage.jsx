import { authStorage } from "../utils/authStorage";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { customerListMyOrders } from "../api/customerOrders";
import "../styles/Admin.css";
import { GenericPageSkeleton } from "../components/PageSkeletons";
import OrderPagination from "../components/OrderPagination";

const ORDERS_PER_PAGE = 10;

function getStoredUser() {
    try {
        return JSON.parse(authStorage.getItem("user") || "null");
    } catch {
        return null;
    }
}

function useCustomerGuard() {
    const navigate = useNavigate();
    const [allowed, setAllowed] = useState(false);

    useEffect(() => {
        const check = () => {
            const token = authStorage.getItem("token");
            const user = getStoredUser();

            if (!token || !user) {
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
    const [status, setStatus] = useState("CURRENT");
    const [page, setPage] = useState(1);
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
                order.orderNumber?.toLowerCase().includes(q.replace(/^#/, "")) ||
                order.service?.title?.toLowerCase().includes(q) ||
                order.boostType?.toLowerCase().includes(q) ||
                order.region?.toLowerCase().includes(q);

            const matchesStatus =
                status === "CURRENT"
                    ? ["PENDING", "IN_PROGRESS"].includes(order.status)
                    : order.status === status;

            return matchesSearch && matchesStatus;
        });
    }, [orders, query, status]);

    const totalPages = Math.max(1, Math.ceil(filteredOrders.length / ORDERS_PER_PAGE));
    const currentPage = Math.min(page, totalPages);
    const pageOrders = filteredOrders.slice((currentPage - 1) * ORDERS_PER_PAGE, currentPage * ORDERS_PER_PAGE);

    if (!allowed) return null;

    return (
        <div className="dashboard-embedded-page customer-orders-embedded">
            <h1 className="admin-order-title customer-orders-title">My Orders</h1>

            <div className="admin-toolbar premium-toolbar">
                <input
                    className="admin-input"
                    aria-label="Search orders"
                    placeholder="Search by order ID, service, boost type, or region"
                    value={query}
                    onChange={(e) => { setQuery(e.target.value); setPage(1); }}
                />

                <select
                    className="admin-select"
                    aria-label="Order status"
                    value={status}
                    onChange={(e) => { setStatus(e.target.value); setPage(1); }}
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
                <div className="admin-table-wrap premium-table-wrap" role="region" aria-label="Orders table" tabIndex={0}>
                    <table className="admin-table" id="customer-orders-table">
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
                            {pageOrders.map((order) => (
                                <tr key={order.id}>
                                    <td className="mono order-id-cell">
                                        #{order.orderNumber}
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
                                            <span>{buildBoostPath(order)}</span>
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
            {!loading && !error && filteredOrders.length > 0 && (
                <OrderPagination currentPage={currentPage} totalPages={totalPages} onPageChange={setPage} />
            )}
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
