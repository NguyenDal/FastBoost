import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { listMyNotifications } from "../api/notifications";
import { getMyLoyalty } from "../api/loyalty";
import "../styles/Dashboard.css";

export default function DashboardPage() {
    const navigate = useNavigate();

    const [notifications, setNotifications] = useState([]);
    const [loyalty, setLoyalty] = useState(null);
    const [loading, setLoading] = useState(true);
    const [copiedReferral, setCopiedReferral] = useState(false);
    const [error, setError] = useState("");

    const user = useMemo(() => {
        try {
            return JSON.parse(localStorage.getItem("user") || "null");
        } catch {
            return null;
        }
    }, []);

    useEffect(() => {
        let cancelled = false;

        const loadDashboard = async () => {
            try {
                setLoading(true);
                setError("");

                const [notificationItems, loyaltyData] = await Promise.all([
                    listMyNotifications(),
                    getMyLoyalty({ rewardPage: 1, rewardLimit: 5 }),
                ]);

                if (!cancelled) {
                    setNotifications(notificationItems || []);
                    setLoyalty(loyaltyData);
                }
            } catch (e) {
                if (!cancelled) {
                    setError(e?.message || "Failed to load dashboard");
                }
            } finally {
                if (!cancelled) {
                    setLoading(false);
                }
            }
        };

        loadDashboard();

        return () => {
            cancelled = true;
        };
    }, []);

    const newNotifications = notifications
        .filter((item) => !item.read && item.type !== "CHAT_MESSAGE")
        .slice(0, 5);

    const newMessages = notifications
        .filter((item) => !item.read && item.type === "CHAT_MESSAGE")
        .slice(0, 5);

    const role = user?.role || "CUSTOMER";
    const ordersPath = role === "PROVIDER" ? "/provider/orders" : "/account/orders";

    const totalSpent = Number(loyalty?.totalCompletedSpend || 0);
    const totalGold = Number(loyalty?.totalGold || 0);
    const referralLink = loyalty?.referralLink || "";
    const referralCount = loyalty?.referralCount || 0;
    const referralEligibility = loyalty?.referralEligibility || {};
    const referralConditions = referralEligibility?.conditions || {};
    const canUseReferral = Boolean(referralEligibility?.eligible && referralLink);

    const referralConditionList = [
        referralConditions.emailVerified,
        referralConditions.completedOrders,
    ].filter(Boolean);

    const tierInfo = {
        key: loyalty?.tierKey || "bronze",
        name: loyalty?.tier || "Bronze",
        icon: loyalty?.icon || "🥉",
        nextTier: loyalty?.nextTier || null,
        spendToNext: Number(loyalty?.spendToNext || 0),
    };

    const progressPercent = Number(loyalty?.progressPercent || 0);
    const loyaltyTiers = loyalty?.tiers || DASHBOARD_FALLBACK_TIERS;

    const handleCopyReferralLink = async () => {
        if (!canUseReferral || !referralLink) return;

        try {
            await navigator.clipboard.writeText(referralLink);
            setCopiedReferral(true);

            setTimeout(() => {
                setCopiedReferral(false);
            }, 1600);
        } catch {
            setCopiedReferral(false);
        }
    };

    const openNotificationTarget = (item) => {
        const targetPath =
            item.data?.targetPath ||
            (item.data?.orderId ? `/match/${item.data.orderId}` : null);

        if (targetPath) {
            navigate(targetPath);
        }
    };

    return (
        <>
            <div className="dashboard-title-row">
                <div>
                    <h1>Dashboard</h1>
                </div>
            </div>

            {loading ? (
                <div className="dashboard-card dashboard-loading-card">
                    Loading dashboard...
                </div>
            ) : error ? (
                <div className="dashboard-card dashboard-error-card">
                    {error}
                </div>
            ) : (
                <>
                    <section className="dashboard-grid dashboard-grid-top">
                        <DashboardListCard
                            eyebrow="Updates"
                            title="New Notifications"
                            emptyText="No new notifications."
                            items={newNotifications}
                            onItemClick={openNotificationTarget}
                        />

                        <DashboardListCard
                            eyebrow="Messages"
                            title="New Messages"
                            emptyText="No new messages."
                            items={newMessages}
                            onItemClick={openNotificationTarget}
                            isMessage
                        />
                    </section>

                    <section className="dashboard-grid dashboard-grid-bottom">
                        <section
                            className={`dashboard-card dashboard-loyalty-card dashboard-loyalty-${tierInfo.key}`}
                            role="button"
                            tabIndex={0}
                            onClick={() => navigate("/account/loyalty")}
                            onKeyDown={(event) => {
                                if (event.key === "Enter") navigate("/account/loyalty");
                            }}
                        >
                            <div className="dashboard-card-header">
                                <div>
                                    <p className="dashboard-eyebrow gold">Loyalty Rewards Status</p>
                                    <h2>{tierInfo.name} Rank</h2>
                                    <p className="dashboard-subtitle">
                                        {tierInfo.nextTier
                                            ? `Spend $${tierInfo.spendToNext.toFixed(2)} more to reach ${tierInfo.nextTier} tier.`
                                            : "You reached the highest loyalty tier."}
                                    </p>
                                </div>

                                <span className="dashboard-tier-badge">
                                    {tierInfo.icon}
                                </span>
                            </div>

                            <div className="dashboard-track">
                                <div
                                    className={`dashboard-track-fill dashboard-fill-${tierInfo.key}`}
                                    style={{ width: `${progressPercent}%` }}
                                />
                            </div>

                            <div className="dashboard-tier-row">
                                {loyaltyTiers.map((tier) => (
                                    <div
                                        key={tier.key}
                                        className={`dashboard-tier-step tier-${tier.key} ${totalSpent >= tier.minSpend ? "active" : ""
                                            } ${tier.key === tierInfo.key ? "current" : ""}`}
                                    >
                                        <span>{tier.icon}</span>
                                        <strong>{tier.name}</strong>
                                        <small>${tier.minSpend}+ spend</small>

                                        <div>
                                            {tier.bonusCoins > 0 ? (
                                                <em>{tier.bonusCoins} bonus gold</em>
                                            ) : (
                                                <em>No bonus</em>
                                            )}

                                            {tier.topUpBonusPercent > 0 && (
                                                <em>{tier.topUpBonusPercent}% top-up bonus</em>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </section>

                        <section className={`dashboard-card dashboard-referral-card ${canUseReferral ? "is-unlocked" : "is-locked"}`}>
                            <div className="dashboard-card-header">
                                <div>
                                    <p className="dashboard-eyebrow green">Private Invite</p>
                                    <h2>Share Your Referral Link</h2>
                                    <p className="dashboard-subtitle">
                                        Invite friends to FastBoost and earn reward gold when the referral requirements are met.
                                    </p>
                                </div>

                                <div className="dashboard-referral-count">
                                    <strong>{referralCount}</strong>
                                    <small>Invited</small>
                                </div>
                            </div>

                            <div className="dashboard-referral-conditions">
                                {referralConditionList.map((condition) => (
                                    <div
                                        key={condition.label}
                                        className={`dashboard-referral-condition ${condition.passed ? "passed" : "failed"
                                            }`}
                                    >
                                        <span>{condition.passed ? "✓" : "×"}</span>

                                        <div>
                                            <strong>
                                                {condition.label}
                                                {condition.current !== undefined && condition.required !== undefined
                                                    ? ` • ${condition.current}/${condition.required}`
                                                    : ""}
                                            </strong>
                                            <small>{condition.helpText}</small>
                                        </div>
                                    </div>
                                ))}
                            </div>

                            <div className={`dashboard-referral-link-box ${!canUseReferral ? "is-disabled" : ""}`}>
                                <span>
                                    {canUseReferral
                                        ? referralLink
                                        : "Complete all requirements to unlock your referral link."}
                                </span>

                                <button
                                    type="button"
                                    onClick={handleCopyReferralLink}
                                    disabled={!canUseReferral}
                                >
                                    {copiedReferral ? "Copied!" : canUseReferral ? "Copy" : "Locked"}
                                </button>
                            </div>
                        </section>
                    </section>
                </>
            )}
        </>
    );
}

function DashboardListCard({ eyebrow, title, emptyText, items, onItemClick, isMessage = false }) {
    return (
        <section className={`dashboard-card dashboard-list-card ${isMessage ? "message-card" : ""}`}>
            <div className="dashboard-card-header">
                <div>
                    <p className="dashboard-eyebrow">{eyebrow}</p>
                    <h2>{title}</h2>
                </div>

                <span className="dashboard-count-pill">{items.length}</span>
            </div>

            {items.length === 0 ? (
                <div className="dashboard-empty-line">{emptyText}</div>
            ) : (
                <div className="dashboard-mini-list">
                    {items.map((item) => (
                        <button
                            key={item.id}
                            type="button"
                            className="dashboard-mini-item"
                            onClick={() => onItemClick(item)}
                        >
                            <div>
                                <strong>{item.title || (isMessage ? "New message" : "Notification")}</strong>
                                <p>{item.message || "Open to view details."}</p>
                            </div>

                            <small>{new Date(item.createdAt).toLocaleString()}</small>
                        </button>
                    ))}
                </div>
            )}
        </section>
    );
}

const DASHBOARD_FALLBACK_TIERS = [
    {
        key: "bronze",
        name: "Bronze",
        icon: "🥉",
        minSpend: 0,
        bonusCoins: 0,
        topUpBonusPercent: 0,
    },
    {
        key: "silver",
        name: "Silver",
        icon: "🥈",
        minSpend: 200,
        bonusCoins: 200,
        topUpBonusPercent: 3,
    },
    {
        key: "gold",
        name: "Gold",
        icon: "🥇",
        minSpend: 500,
        bonusCoins: 500,
        topUpBonusPercent: 5,
    },
    {
        key: "platinum",
        name: "Platinum",
        icon: "💎",
        minSpend: 1000,
        bonusCoins: 800,
        topUpBonusPercent: 8,
    },
    {
        key: "diamond",
        name: "Diamond",
        icon: "🔷",
        minSpend: 1500,
        bonusCoins: 1500,
        topUpBonusPercent: 10,
    },
];