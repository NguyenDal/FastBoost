import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Navbar from "../components/Navbar";
import { getMyLoyaltyOrders } from "../api/loyalty";
import "../styles/Loyalty.css";

function useCustomerGuard() {
    const navigate = useNavigate();
    const [hasAccess, setHasAccess] = useState(false);

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

                if (user?.role !== "CUSTOMER" && user?.role !== "ADMIN") {
                    navigate("/", { replace: true });
                } else {
                    setHasAccess(true);
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

    return hasAccess;
}

export default function LoyaltyPage() {
    const hasAccess = useCustomerGuard();

    const [orders, setOrders] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    useEffect(() => {
        if (!hasAccess) return;

        const loadLoyalty = async () => {
            try {
                setLoading(true);
                setError("");

                const loadedOrders = await getMyLoyaltyOrders();
                setOrders(Array.isArray(loadedOrders) ? loadedOrders : []);
            } catch (e) {
                setError(e?.message || "Failed to load loyalty page");
            } finally {
                setLoading(false);
            }
        };

        loadLoyalty();
    }, [hasAccess]);

    const completedOrders = useMemo(() => {
        return orders.filter((order) => order.status === "COMPLETED");
    }, [orders]);

    const completedMatches = completedOrders.length;

    const totalGold = useMemo(() => {
        return completedOrders.reduce((sum, order) => {
            return sum + getGoldFromOrder(order);
        }, 0);
    }, [completedOrders]);

    const totalSpent = useMemo(() => {
        return completedOrders.reduce((sum, order) => {
            return sum + Number(order.totalPrice || 0);
        }, 0);
    }, [completedOrders]);

    const tierInfo = getTierInfo(completedMatches);
    const progressPercent = getTierProgressPercent(completedMatches, tierInfo);

    if (!hasAccess) return null;

    return (
        <div className="loyalty-page-shell">
            <Navbar />

            <div className="loyalty-page-container">
                {loading ? (
                    <p className="loyalty-muted">Loading loyalty rewards...</p>
                ) : error ? (
                    <p className="loyalty-error">{error}</p>
                ) : (
                    <>
                        <section className={`loyalty-hero loyalty-hero-${tierInfo.key}`}>
                            <div>
                                <p className="loyalty-eyebrow">FastBoost Loyalty</p>

                                <h1 className="loyalty-title">
                                    {tierInfo.name} Account
                                </h1>

                                <p className="loyalty-subtitle">
                                    Complete more matches to unlock higher loyalty status and track your earned gold.
                                </p>
                            </div>

                            <div className="loyalty-tier-emblem">
                                <span>{tierInfo.icon}</span>
                                <strong>{tierInfo.name}</strong>
                            </div>
                        </section>

                        <section className="loyalty-card loyalty-progress-card">
                            <div className="loyalty-progress-header">
                                <div>
                                    <h2>Account Progress</h2>
                                    <p>
                                        {tierInfo.nextTier
                                            ? `${tierInfo.matchesToNext} completed match${tierInfo.matchesToNext === 1 ? "" : "es"} until ${tierInfo.nextTier}`
                                            : "You reached the highest loyalty tier."}
                                    </p>
                                </div>

                                <div className="loyalty-progress-number">
                                    <strong>{completedMatches}</strong>
                                    <span>completed matches</span>
                                </div>
                            </div>

                            <div className="loyalty-track">
                                <div
                                    className={`loyalty-track-fill loyalty-fill-${tierInfo.key}`}
                                    style={{ width: `${progressPercent}%` }}
                                />
                            </div>

                            <div className="loyalty-tier-row">
                                {LOYALTY_TIERS.map((tier) => (
                                    <div
                                        key={tier.key}
                                        className={`loyalty-tier-step tier-${tier.key} ${completedMatches >= tier.minMatches ? "active" : ""
                                            } ${tier.key === tierInfo.key ? "current" : ""}`}
                                    >
                                        <span>{tier.icon}</span>
                                        <strong>{tier.name}</strong>
                                        <small>{tier.minMatches}+ matches</small>
                                    </div>
                                ))}
                            </div>
                        </section>

                        <section className="loyalty-stats-grid">
                            <div className="loyalty-stat-card">
                                <span>Total Gold</span>
                                <strong>{totalGold}</strong>
                                <p>Earned from completed matches</p>
                            </div>

                            <div className="loyalty-stat-card">
                                <span>Completed Matches</span>
                                <strong>{completedMatches}</strong>
                                <p>Only completed orders count</p>
                            </div>

                            <div className="loyalty-stat-card">
                                <span>Total Completed Spend</span>
                                <strong>${totalSpent.toFixed(2)}</strong>
                                <p>Used to estimate loyalty gold</p>
                            </div>
                        </section>

                        <section className="loyalty-card">
                            <div className="loyalty-section-header">
                                <div>
                                    <h2>Completed Match Rewards</h2>
                                    <p>Gold earned from every completed match.</p>
                                </div>

                                <Link to="/account/orders" className="loyalty-secondary-btn">
                                    View My Orders
                                </Link>
                            </div>

                            {completedOrders.length > 0 ? (
                                <div className="loyalty-match-list">
                                    {completedOrders.map((order) => (
                                        <div className="loyalty-match-row" key={order.id}>
                                            <div>
                                                <strong>
                                                    {order.service?.title || order.boostType || "Completed Order"}
                                                </strong>

                                                <small>
                                                    #{String(order.id).slice(0, 8)} •{" "}
                                                    {order.completedAt
                                                        ? new Date(order.completedAt).toLocaleString()
                                                        : order.updatedAt
                                                            ? new Date(order.updatedAt).toLocaleString()
                                                            : order.createdAt
                                                                ? new Date(order.createdAt).toLocaleString()
                                                                : "Completed"}
                                                </small>
                                            </div>

                                            <div className="loyalty-match-gold">
                                                <span>+{getGoldFromOrder(order)}</span>
                                                <small>gold</small>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="loyalty-empty">
                                    <h3>No completed matches yet</h3>
                                    <p>
                                        Your loyalty progress starts when your first order is marked completed.
                                    </p>
                                    <Link to="/" className="loyalty-primary-btn">
                                        Browse Services
                                    </Link>
                                </div>
                            )}
                        </section>
                    </>
                )}
            </div>
        </div>
    );
}

const LOYALTY_TIERS = [
    {
        key: "bronze",
        name: "Bronze",
        icon: "🥉",
        minMatches: 0,
        maxMatches: 4,
        nextTier: "Silver",
    },
    {
        key: "silver",
        name: "Silver",
        icon: "🥈",
        minMatches: 5,
        maxMatches: 14,
        nextTier: "Gold",
    },
    {
        key: "gold",
        name: "Gold",
        icon: "🥇",
        minMatches: 15,
        maxMatches: 29,
        nextTier: "Platinum",
    },
    {
        key: "platinum",
        name: "Platinum",
        icon: "💎",
        minMatches: 30,
        maxMatches: Infinity,
        nextTier: null,
    },
];

function getTierInfo(completedMatches) {
    const currentTier =
        [...LOYALTY_TIERS]
            .reverse()
            .find((tier) => completedMatches >= tier.minMatches) || LOYALTY_TIERS[0];

    if (!currentTier.nextTier) {
        return {
            ...currentTier,
            matchesToNext: 0,
        };
    }

    const nextTier = LOYALTY_TIERS.find((tier) => tier.name === currentTier.nextTier);

    return {
        ...currentTier,
        matchesToNext: Math.max(0, nextTier.minMatches - completedMatches),
    };
}

function getTierProgressPercent(completedMatches, tierInfo) {
    if (tierInfo.key === "platinum") return 100;

    const currentMin = tierInfo.minMatches;
    const nextTier = LOYALTY_TIERS.find((tier) => tier.name === tierInfo.nextTier);

    if (!nextTier) return 100;

    const range = nextTier.minMatches - currentMin;
    const currentProgress = completedMatches - currentMin;

    return Math.min(100, Math.max(0, (currentProgress / range) * 100));
}

function getGoldFromOrder(order) {
    return Math.floor(Number(order.totalPrice || 0));
}