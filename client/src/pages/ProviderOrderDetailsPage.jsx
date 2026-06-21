import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import Navbar from "../components/Navbar";
import { GenericPageSkeleton } from "../components/PageSkeletons";
import {
    providerCompleteOrder,
    providerGetOrder,
    providerLeaveOrder,
} from "../api/providerOrders";
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

export default function ProviderOrderDetailsPage() {
    const isProvider = useProviderGuard();
    const { id } = useParams();
    const navigate = useNavigate();

    const [order, setOrder] = useState(null);
    const [loading, setLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState(false);
    const [error, setError] = useState("");

    useEffect(() => {
        if (!isProvider) return;

        const loadOrder = async () => {
            setLoading(true);
            setError("");

            try {
                const loadedOrder = await providerGetOrder(id);
                setOrder(loadedOrder);
            } catch (e) {
                setError(e?.message || "Failed to load order");
            } finally {
                setLoading(false);
            }
        };

        loadOrder();
    }, [id, isProvider]);

    const onMarkCompleted = async () => {
        try {
            setActionLoading(true);

            const updatedOrder = await providerCompleteOrder(id);
            setOrder(updatedOrder);
        } catch (e) {
            alert(e?.message || "Failed to mark order completed");
        } finally {
            setActionLoading(false);
        }
    };

    const onLeaveOrder = async () => {
        const confirmed = window.confirm(
            "Leave this order? You will be unassigned from this customer's order."
        );

        if (!confirmed) return;

        try {
            setActionLoading(true);

            await providerLeaveOrder(id);
            navigate("/provider/orders", { replace: true });
        } catch (e) {
            alert(e?.message || "Failed to leave order");
        } finally {
            setActionLoading(false);
        }
    };

    if (!isProvider) return null;

    return (
        <div className="page-shell">
            <Navbar />

            <div className="page-container">
                {loading ? (
                    <GenericPageSkeleton />
                ) : error ? (
                    <p style={{ color: "#ef4444" }}>{error}</p>
                ) : order ? (
                    <>
                        <div className="admin-order-hero">
                            <div>
                                <p className="admin-eyebrow">FastBoost Provider</p>

                                <h1 className="admin-order-title">
                                    {order.service?.title || order.boostType || "Order Details"}
                                </h1>

                                <div className="admin-order-meta">
                                    <span className="admin-chip">
                                        Order #{String(order.id || id).slice(0, 8)}
                                    </span>

                                    <StatusBadge status={order.status} />

                                    {order.createdAt && (
                                        <span className="admin-chip">
                                            {new Date(order.createdAt).toLocaleString()}
                                        </span>
                                    )}
                                </div>
                            </div>

                            <div className="admin-hero-actions">
                                <Link to="/provider/orders" className="secondary-btn">
                                    Close
                                </Link>
                            </div>
                        </div>

                        <div className="admin-grid premium-grid">
                            <section className="admin-card premium-card">
                                <h3 className="card-title">Order Overview</h3>

                                <div className="order-overview-grid">
                                    <Field
                                        label="Customer"
                                        value={
                                            order.customer?.username ||
                                            order.customer?.profile?.displayName ||
                                            order.customer?.email?.split("@")[0] ||
                                            "Customer"
                                        }
                                    />

                                    <Field
                                        label="Service"
                                        value={order.service?.title || order.boostType || "-"}
                                    />

                                    <Field label="Region" value={order.region || "-"} />
                                    <Field label="Queue Type" value={order.queueType || "-"} />
                                    <Field label="Play Mode" value={order.playMode || "-"} />
                                    <Field label="Boost Type" value={order.boostType || "-"} />
                                </div>

                                <div className="status-row">
                                    <label className="field-label">Provider Actions</label>

                                    <div className="status-control">
                                        <button
                                            className="secondary-btn admin-btn-sm"
                                            disabled={
                                                actionLoading ||
                                                order.status === "COMPLETED" ||
                                                order.status === "CANCELLED"
                                            }
                                            onClick={onMarkCompleted}
                                        >
                                            Mark Completed
                                        </button>

                                        <button
                                            className="danger-btn admin-btn-sm"
                                            disabled={
                                                actionLoading ||
                                                order.status === "COMPLETED" ||
                                                order.status === "CANCELLED"
                                            }
                                            onClick={onLeaveOrder}
                                        >
                                            Leave Order
                                        </button>
                                    </div>

                                    <p className="muted-text status-helper">
                                        Boosters can complete assigned orders or leave the order. Only admins can cancel orders or assign other boosters.
                                    </p>
                                </div>

                                {order.currentRank && order.desiredRank && (
                                    <div className="detail-section">
                                        <h3 className="card-subtitle">Boost Path</h3>

                                        <div className="boost-path">
                                            <div className="boost-rank-box">{order.currentRank}</div>
                                            <div className="boost-arrow">→</div>
                                            <div className="boost-rank-box">{order.desiredRank}</div>
                                        </div>
                                    </div>
                                )}

                                <OrderTypeDetails order={order} />
                                <AddonDetails order={order} />
                            </section>

                            <aside className="admin-sidebar-stack">
                                <div className="admin-card premium-card">
                                    <h3 className="card-title">Price Summary</h3>

                                    <div className="price-summary">
                                        <div className="price-row">
                                            <span>Base Price</span>
                                            <strong>${Number(order.basePrice || 0).toFixed(2)}</strong>
                                        </div>

                                        <div className="price-row">
                                            <span>Add-on Price</span>
                                            <strong>${Number(order.addonPrice || 0).toFixed(2)}</strong>
                                        </div>

                                        <div className="price-row total">
                                            <span>Total</span>
                                            <strong>${Number(order.totalPrice || 0).toFixed(2)}</strong>
                                        </div>
                                    </div>
                                </div>

                                <div className="conversation-box">
                                    <Link
                                        className="secondary-btn admin-btn-sm conversation-btn"
                                        to={`/match/${order.id}`}
                                    >
                                        <span>Go to Conversation</span>
                                        <span aria-hidden="true" className="arrow">
                                            →
                                        </span>
                                    </Link>
                                </div>

                                <div className="admin-card premium-card">
                                    <h3 className="card-title">Assignment</h3>

                                    <div className="admin-list">
                                        <div className="admin-list-item">
                                            <div>
                                                <div className="assignment-email">You are assigned</div>
                                                <div className="assignment-role">
                                                    Provider access only
                                                </div>
                                            </div>

                                            <StatusBadge status={order.status} />
                                        </div>
                                    </div>
                                </div>
                            </aside>
                        </div>
                    </>
                ) : null}
            </div>
        </div>
    );
}

function Field({ label, value }) {
    return (
        <div>
            <label className="field-label">{label}</label>
            <div className="field-value">{value}</div>
        </div>
    );
}

function SmartField({ label, value }) {
    if (
        value === null ||
        value === undefined ||
        value === "" ||
        value === "-" ||
        value === false
    ) {
        return null;
    }

    return <Field label={label} value={value} />;
}

function OrderTypeDetails({ order }) {
    const serviceTitle = String(order.service?.title || "").toLowerCase();
    const boostType = String(order.boostType || "").toLowerCase();

    const isRankBoost =
        serviceTitle.includes("rank") ||
        boostType.includes("rank") ||
        boostType.includes("division");

    const isPlacement =
        serviceTitle.includes("placement") || boostType.includes("placement");

    const isWinBoost =
        serviceTitle.includes("win") || boostType.includes("win");

    const isProDuo =
        serviceTitle.includes("duo") || boostType.includes("duo");

    return (
        <div className="detail-section">
            <h3 className="card-subtitle">Order Configuration</h3>

            {isRankBoost && (
                <div className="order-detail-grid">
                    <SmartField label="Current Rank" value={order.currentRank} />
                    <SmartField label="Current LP" value={order.currentLP} />
                    <SmartField label="Desired Rank" value={order.desiredRank} />
                    <SmartField label="LP Gain" value={order.lpGain} />
                    <SmartField label="First Role" value={order.firstRole} />
                    <SmartField label="Second Role" value={order.secondRole} />
                    <SmartField
                        label="Selected Champions"
                        value={formatSelectedChampions(order.selectedChampions)}
                    />
                </div>
            )}

            {isPlacement && (
                <div className="order-detail-grid">
                    <SmartField label="Previous Rank" value={order.currentRank} />
                    <SmartField label="Placement Games" value={order.placementGames} />
                    <SmartField label="Queue Type" value={order.queueType} />
                    <SmartField label="First Role" value={order.firstRole} />
                    <SmartField label="Second Role" value={order.secondRole} />
                    <SmartField
                        label="Selected Champions"
                        value={formatSelectedChampions(order.selectedChampions)}
                    />
                </div>
            )}

            {isWinBoost && (
                <div className="order-detail-grid">
                    <SmartField label="Current Rank" value={order.currentRank} />
                    <SmartField label="Desired Wins" value={order.desiredWins} />
                    <SmartField label="Queue Type" value={order.queueType} />
                    <SmartField label="First Role" value={order.firstRole} />
                    <SmartField label="Second Role" value={order.secondRole} />
                    <SmartField
                        label="Selected Champions"
                        value={formatSelectedChampions(order.selectedChampions)}
                    />
                </div>
            )}

            {isProDuo && (
                <div className="order-detail-grid">
                    <SmartField label="Current Rank" value={order.currentRank} />
                    <SmartField label="Number of Games" value={order.numberOfGames} />
                    <SmartField label="Queue Type" value={order.queueType} />
                    <SmartField label="First Role" value={order.firstRole} />
                    <SmartField label="Second Role" value={order.secondRole} />
                    <SmartField
                        label="Selected Champions"
                        value={formatSelectedChampions(order.selectedChampions)}
                    />
                </div>
            )}

            {!isRankBoost && !isPlacement && !isWinBoost && !isProDuo && (
                <p className="muted-text">No extra configuration details available.</p>
            )}
        </div>
    );
}

function AddonDetails({ order }) {
    const addons = [];

    if (order.priorityOrder) addons.push("Priority Order");
    if (order.liveStream) addons.push("Live Stream");
    if (order.appearOffline) addons.push("Appear Offline");
    if (order.bonusWin) addons.push("Bonus Win");
    if (order.soloOnly) addons.push("Solo Only");
    if (order.duoWithBooster) addons.push("Play With Booster");
    if (order.highMMRDuo) addons.push("High MMR Duo");

    const champions = formatSelectedChampions(order.selectedChampions);

    if (champions) {
        addons.push(`Champion Specific: ${champions}`);
    }

    return (
        <div className="detail-section">
            <h3 className="card-subtitle">Add-ons</h3>

            {addons.length > 0 ? (
                <div className="addon-grid">
                    {addons.map((addon) => (
                        <span key={addon} className="addon-pill active">
                            {addon}
                        </span>
                    ))}
                </div>
            ) : (
                <p className="muted-text">No add-ons selected.</p>
            )}
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

    return <span className={cls}>{status || "PENDING"}</span>;
}

function formatSelectedChampions(value) {
    if (Array.isArray(value)) {
        return value.length ? value.join(", ") : "";
    }

    if (typeof value === "string") {
        return value;
    }

    return "";
}