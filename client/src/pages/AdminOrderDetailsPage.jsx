import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
    adminGetOrder,
    adminListAssignments,
    adminListProviders,
    adminUpdateOrderStatus,
    adminUnassignBooster,
} from "../api/admin";

import {
    createAssignmentRequest,
    cancelAssignmentRequest,
    listOrderAssignmentRequests,
} from "../api/assignmentRequests";

import Navbar from "../components/Navbar";
import "../styles/Admin.css";

function useAdminGuard() {
    const navigate = useNavigate();
    const [isAdmin, setIsAdmin] = useState(false);

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
                if (user?.role !== "ADMIN") {
                    navigate("/", { replace: true });
                } else {
                    setIsAdmin(true);
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

    return isAdmin;
}

export default function AdminOrderDetailsPage() {
    const isAdmin = useAdminGuard();
    const { id } = useParams();

    const [order, setOrder] = useState(null);
    const [status, setStatus] = useState("");
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    const [providers, setProviders] = useState([]);
    const [providerQuery, setProviderQuery] = useState("");
    const [assignments, setAssignments] = useState([]);
    const [assignmentRequests, setAssignmentRequests] = useState([]);
    const [assignLoading, setAssignLoading] = useState(false);
    const [confirmCancelRequestId, setConfirmCancelRequestId] = useState(null);
    const [confirmTimerId, setConfirmTimerId] = useState(null);

    const assignedEmails = useMemo(
        () => assignments.map((a) => a.booster?.email).filter(Boolean),
        [assignments]
    );

    const assignedIds = useMemo(
        () => assignments.map((a) => a.boosterId || a.booster?.id).filter(Boolean),
        [assignments]
    );

    const pendingRequestByBoosterId = useMemo(() => {
        const map = {};

        assignmentRequests.forEach((request) => {
            if (request.status === "PENDING") {
                map[request.boosterId] = request;
            }
        });

        return map;
    }, [assignmentRequests]);

    useEffect(() => {
        if (!isAdmin) return;

        const load = async () => {
            setLoading(true);
            setError("");
            try {
                const o = await adminGetOrder(id);
                setOrder(o);
                setStatus(o.status);
                const [prov, asg, reqs] = await Promise.all([
                    adminListProviders(""),
                    adminListAssignments(id),
                    listOrderAssignmentRequests(id),
                ]);

                setProviders(prov);
                setAssignments(asg);
                setAssignmentRequests(reqs);
            } catch (e) {
                setError(e?.message || "Failed to load order");
            } finally {
                setLoading(false);
            }
        };

        load();
    }, [id, isAdmin]);

    useEffect(() => {
        return () => {
            if (confirmTimerId) {
                clearTimeout(confirmTimerId);
            }
        };
    }, [confirmTimerId]);

    const refreshAssignments = async () => {
        const asg = await adminListAssignments(id);
        setAssignments(asg);
    };

    const refreshAssignmentRequests = async () => {
        const reqs = await listOrderAssignmentRequests(id);
        setAssignmentRequests(reqs);
    };

    const onStatusSave = async () => {
        try {
            await adminUpdateOrderStatus(id, status);
            // Re-fetch full order to keep conversation/assignments intact
            const fresh = await adminGetOrder(id);
            setOrder(fresh);
        } catch (e) {
            alert(e?.message || "Failed to update status");
        }
    };

    const onRequestAssign = async (boosterId) => {
        try {
            setAssignLoading(true);
            await createAssignmentRequest(id, boosterId);
            await refreshAssignmentRequests();
        } catch (e) {
            alert(e?.message || "Failed to send assignment request");
        } finally {
            setAssignLoading(false);
        }
    };

    const onPendingRequestClick = (request) => {
        if (!request) return;

        if (confirmCancelRequestId !== request.id) {
            if (confirmTimerId) {
                clearTimeout(confirmTimerId);
            }

            setConfirmCancelRequestId(request.id);

            const timer = setTimeout(() => {
                setConfirmCancelRequestId(null);
                setConfirmTimerId(null);
            }, 5000);

            setConfirmTimerId(timer);
            return;
        }

        onCancelRequest(request.id);
    };

    const onCancelRequest = async (requestId) => {
        try {
            setAssignLoading(true);

            if (confirmTimerId) {
                clearTimeout(confirmTimerId);
                setConfirmTimerId(null);
            }

            await cancelAssignmentRequest(requestId);

            setConfirmCancelRequestId(null);
            await refreshAssignmentRequests();
        } catch (e) {
            alert(e?.message || "Failed to cancel assignment request");
        } finally {
            setAssignLoading(false);
        }
    };

    const onUnassign = async (boosterId) => {
        try {
            setAssignLoading(true);
            await adminUnassignBooster(id, boosterId);

            await Promise.all([
                refreshAssignments(),
                refreshAssignmentRequests(),
            ]);
        } catch (e) {
            alert(e?.message || "Failed to unassign");
        } finally {
            setAssignLoading(false);
        }
    };

    if (!isAdmin) return null;

    return (
        <div className="page-shell">
            <Navbar />
            <div className="page-container">

                {loading ? (
                    <p>Loading…</p>
                ) : error ? (
                    <p style={{ color: "#ef4444" }}>{error}</p>
                ) : order ? (
                    <>
                        <div className="admin-order-hero">
                            <div>
                                <p className="admin-eyebrow">FastBoost Admin</p>
                                <h1 className="admin-order-title">
                                    {order.service?.title || order.boostType}
                                </h1>

                                <div className="admin-order-meta">
                                    <span className="admin-chip">Order #{id?.slice?.(0, 8)}</span>
                                    <StatusBadge status={order.status} />
                                    <span className="admin-chip">
                                        {new Date(order.createdAt).toLocaleString()}
                                    </span>
                                </div>
                            </div>

                            <div className="admin-hero-actions">
                                <Link to="/admin/orders" className="secondary-btn">Close</Link>
                            </div>
                        </div>

                        <div className="admin-grid premium-grid">
                            <section className="admin-card premium-card">
                                <h3 className="card-title">Order Overview</h3>

                                <div className="order-overview-grid">
                                    <Field label="Customer" value={order.customer?.username || order.customer?.profile?.displayName || (order.customer?.email ? order.customer.email.split("@")[0] : "-")} />
                                    <Field label="Service" value={order.service?.title || order.boostType || "-"} />
                                    <Field label="Region" value={order.region || "-"} />
                                    <Field label="Queue Type" value={order.queueType || "-"} />
                                    <Field label="Play Mode" value={order.playMode || "-"} />
                                    <Field label="Boost Type" value={order.boostType || "-"} />
                                </div>

                                <div className="status-row">
                                    <label className="field-label">Status</label>
                                    <div className="status-control">
                                        <select
                                            className="admin-select"
                                            value={status}
                                            onChange={(e) => setStatus(e.target.value)}
                                        >
                                            <option value="PENDING">PENDING</option>
                                            <option value="IN_PROGRESS">IN_PROGRESS</option>
                                            <option value="COMPLETED">COMPLETED</option>
                                            <option value="CANCELLED">CANCELLED</option>
                                        </select>

                                        <button className="secondary-btn admin-btn-sm" onClick={onStatusSave}>
                                            Save
                                        </button>
                                    </div>
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

                                {order.conversation ? (
                                    <div className="conversation-box">
                                        <Link className="secondary-btn admin-btn-sm conversation-btn" to={`/match/${order.id}`}>
                                            <span>Go to Conversation</span>
                                            <span aria-hidden="true" className="arrow">→</span>
                                        </Link>
                                    </div>
                                ) : (
                                    <p className="muted-text">
                                        No conversation yet. Assign a booster to create one.
                                    </p>
                                )}



                                <div className="admin-card premium-card">
                                    <div className="assign-header">
                                        <h3 className="card-title">Assign Booster</h3>
                                        <input
                                            placeholder="Search providers..."
                                            value={providerQuery}
                                            onChange={async (e) => {
                                                const v = e.target.value;
                                                setProviderQuery(v);
                                                const users = await adminListProviders(v);
                                                setProviders(users);
                                            }}
                                            className="admin-input"
                                        />
                                    </div>

                                    <div className="admin-list">
                                        {/* Assigned first */}
                                        {assignments.map((a) => (
                                            <div key={a.id} className="admin-list-item">
                                                <div>
                                                    <div className="assignment-email">
                                                        {a.booster?.username || a.booster?.profile?.displayName || a.booster?.email}
                                                    </div>
                                                    <div className="assignment-role">{a.booster?.role}</div>
                                                </div>
                                                <button
                                                    className="danger-btn"
                                                    disabled={assignLoading}
                                                    onClick={() => onUnassign(a.boosterId)}
                                                >
                                                    Unassign
                                                </button>
                                            </div>
                                        ))}

                                        {/* Unassigned after */}
                                        {providers
                                            .filter((u) => !assignedIds.includes(u.id) && !assignedEmails.includes(u.email))
                                            .map((u) => (
                                                <div key={u.id} className="admin-list-item">
                                                    <div>
                                                        <div className="assignment-email">{u.username || u.profile?.displayName || u.email}</div>
                                                        <div className="assignment-role">Joined {new Date(u.createdAt).toLocaleDateString()}</div>
                                                    </div>
                                                    <AssignmentRequestButton
                                                        provider={u}
                                                        disabled={assignLoading}
                                                        isAssigned={assignedIds.includes(u.id)}
                                                        pendingRequest={pendingRequestByBoosterId[u.id]}
                                                        confirmCancelRequestId={confirmCancelRequestId}
                                                        onAssign={() => onRequestAssign(u.id)}
                                                        onPendingClick={onPendingRequestClick}
                                                    />
                                                </div>
                                            ))}

                                        {assignments.length === 0 && providers.filter((u) => !assignedIds.includes(u.id) && !assignedEmails.includes(u.email)).length === 0 && (
                                            <p className="muted-text">No providers</p>
                                        )}
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

function AssignmentRequestButton({
    provider,
    disabled,
    isAssigned,
    pendingRequest,
    confirmCancelRequestId,
    onAssign,
    onPendingClick,
}) {
    if (isAssigned) {
        return (
            <button className="assign-btn assigned" disabled>
                Assigned
            </button>
        );
    }

    if (pendingRequest) {
        const isConfirming = confirmCancelRequestId === pendingRequest.id;

        return (
            <button
                className={`assign-btn ${isConfirming ? "revoke countdown" : "waiting"}`}
                disabled={disabled}
                onClick={() => onPendingClick(pendingRequest)}
                title={isConfirming ? "Click again to revoke" : "Waiting for booster response"}
            >
                <span>{isConfirming ? "Revoke" : "Waiting"}</span>
            </button>
        );
    }

    return (
        <button
            className="assign-btn assign"
            disabled={disabled}
            onClick={onAssign}
            title={`Send assignment request to ${provider.username || provider.email}`}
        >
            <span>Assign</span>
        </button>
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
    const serviceTitle = (order.service?.title || "").toLowerCase();
    const boostType = (order.boostType || "").toLowerCase();

    const isRankBoost =
        serviceTitle.includes("rank") || boostType.includes("division");

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

                    {isMasterRank(order.currentRank) && (
                        <SmartField label="Current Master LP" value={order.currentMasterLp} />
                    )}

                    <SmartField label="Desired Rank" value={order.desiredRank} />

                    {isMasterRank(order.desiredRank) && (
                        <SmartField label="Desired Master LP" value={order.desiredMasterLp} />
                    )}

                    <SmartField label="LP Gain" value={order.lpGain} />
                    <SmartField label="First Role" value={order.firstRole} />
                    <SmartField label="Second Role" value={order.secondRole} />
                    <SmartField label="Selected Champions" value={formatArray(order.selectedChampions)} />
                </div>
            )}

            {isPlacement && (
                <div className="order-detail-grid">
                    <SmartField label="Peak Rank" value={order.peakRank} />
                    <Field label="Placement Games" value={formatValue(order.placementGames)} />
                    <Field label="Current Rank" value={order.currentRank || "-"} />
                    <Field label="Queue Type" value={order.queueType || "-"} />
                    <Field label="First Role" value={order.firstRole || "-"} />
                    <Field label="Second Role" value={order.secondRole || "-"} />
                    <Field label="Champions" value={formatArray(order.selectedChampions)} />
                </div>
            )}

            {isWinBoost && (
                <div className="order-detail-grid">
                    <Field label="Current Rank" value={order.currentRank || "-"} />
                    <Field label="Desired Wins" value={formatValue(order.desiredWins)} />
                    <Field label="LP Gain" value={order.lpGain || "-"} />
                    <Field label="First Role" value={order.firstRole || "-"} />
                    <Field label="Second Role" value={order.secondRole || "-"} />
                    <Field label="Champions" value={formatArray(order.selectedChampions)} />
                </div>
            )}

            {isProDuo && (
                <div className="order-detail-grid">
                    <Field label="Number of Games" value={formatValue(order.numberOfGames)} />
                    <Field label="First Role" value={order.firstRole || "-"} />
                    <Field label="Second Role" value={order.secondRole || "-"} />
                    <Field label="Queue Type" value={order.queueType || "-"} />
                    <Field label="Champions" value={formatArray(order.selectedChampions)} />
                    <Field label="High MMR Duo" value={formatBoolean(order.highMMRDuo)} />
                </div>
            )}

            {!isRankBoost && !isPlacement && !isWinBoost && !isProDuo && (
                <div className="order-detail-grid">
                    <Field label="Current Rank" value={order.currentRank || "-"} />
                    <Field label="Desired Rank" value={order.desiredRank || "-"} />
                    <Field label="Desired Wins" value={formatValue(order.desiredWins)} />
                    <Field label="Placement Games" value={formatValue(order.placementGames)} />
                    <Field label="Number of Games" value={formatValue(order.numberOfGames)} />
                </div>
            )}
        </div>
    );
}

function AddonDetails({ order }) {
    const selectedChampionsText = formatArray(order.selectedChampions);
    const hasSelectedChampions = selectedChampionsText !== "-";

    const addons = [
        { label: "Priority Order", value: order.priorityOrder },
        { label: "Premium Coaching", value: order.premiumCoaching },
        { label: "Live Stream", value: order.liveStream },
        { label: "Appear Offline", value: order.appearOffline },
        { label: "Bonus Win", value: order.bonusWin },
        { label: "Solo Only", value: order.soloOnly },
        { label: "High MMR Duo", value: order.highMMRDuo },

        // This is important because champion specific can create addon price
        {
            label: `Champion Specific: ${selectedChampionsText}`,
            value: hasSelectedChampions,
        },
    ].filter((item) => item.value === true);

    if (addons.length === 0 && Number(order.addonPrice || 0) <= 0) {
        return null;
    }

    return (
        <div className="detail-section">
            <h3 className="card-subtitle">Add-ons</h3>

            <div className="addon-grid">
                {addons.map((item) => (
                    <div key={item.label} className="addon-pill active">
                        {item.label}
                    </div>
                ))}

                {addons.length === 0 && Number(order.addonPrice || 0) > 0 && (
                    <div className="addon-pill active">
                        Add-on Price Recorded: ${Number(order.addonPrice || 0).toFixed(2)}
                    </div>
                )}
            </div>
        </div>
    );
}

function formatBoolean(value) {
    return value ? "Yes" : "No";
}

function formatValue(value) {
    return value === null || value === undefined || value === "" ? "-" : value;
}

function isMasterRank(rank) {
    if (!rank) return false;

    const normalized = String(rank).toLowerCase();

    return (
        normalized.includes("master") ||
        normalized.includes("grandmaster") ||
        normalized.includes("challenger")
    );
}

function formatArray(value) {
    if (Array.isArray(value)) {
        return value.length > 0 ? value.join(", ") : "-";
    }

    if (typeof value === "string") {
        try {
            const parsed = JSON.parse(value);
            if (Array.isArray(parsed)) {
                return parsed.length > 0 ? parsed.join(", ") : "-";
            }
        } catch {
            return value || "-";
        }
    }

    return "-";
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
