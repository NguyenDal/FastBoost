import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { listMyNotifications } from "../api/notifications";
import { getMyLoyalty } from "../api/loyalty";
import {
    Skeleton,
    SkeletonButton,
    SkeletonCircle,
} from "../components/Skeleton";
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

    const openLoyaltyPage = () => {
        navigate("/account/loyalty");
    };

    return (
        <>
            <div className="dashboard-title-row">
                <div>
                    <h1>Dashboard</h1>
                </div>
            </div>

            {loading ? (
                <DashboardSkeleton />
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
                        <Link
                            to="/account/loyalty"
                            className={`dashboard-card dashboard-loyalty-card dashboard-loyalty-${tierInfo.key}`}
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
                        </Link>

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

function DashboardSkeleton() {
    return (
        <>
            <section className="dashboard-grid dashboard-grid-top">
                <DashboardListSkeleton />
                <DashboardListSkeleton />
            </section>

            <section className="dashboard-grid dashboard-grid-bottom">
                <DashboardLoyaltySkeleton />
                <DashboardReferralSkeleton />
            </section>
        </>
    );
}

function DashboardListSkeleton() {
    return (
        <section className="dashboard-card dashboard-list-card dashboard-skeleton-card">
            <div className="dashboard-card-header">
                <div>
                    <Skeleton width={92} height={12} className="dashboard-skeleton-eyebrow" />
                    <div style={{ height: 10 }} />
                    <Skeleton width={190} height={24} radius={999} />
                </div>

                <Skeleton width={42} height={32} radius={999} />
            </div>

            <div className="dashboard-skeleton-list">
                {Array.from({ length: 3 }).map((_, index) => (
                    <div className="dashboard-skeleton-item" key={index}>
                        <div>
                            <Skeleton width={index === 1 ? "62%" : "76%"} height={15} />
                            <div style={{ height: 9 }} />
                            <Skeleton width={index === 1 ? "54%" : "84%"} height={13} />
                        </div>

                        <Skeleton width={78} height={12} />
                    </div>
                ))}
            </div>
        </section>
    );
}

function DashboardLoyaltySkeleton() {
    return (
        <section className="dashboard-card dashboard-loyalty-card dashboard-skeleton-card">
            <div className="dashboard-card-header">
                <div>
                    <Skeleton width={150} height={12} />
                    <div style={{ height: 10 }} />
                    <Skeleton width={220} height={26} />
                    <div style={{ height: 12 }} />
                    <Skeleton width={320} height={14} />
                </div>

                <SkeletonCircle size={58} />
            </div>

            <div style={{ height: 22 }} />

            <Skeleton width="100%" height={14} radius={999} />

            <div style={{ height: 22 }} />

            <div className="dashboard-tier-row">
                {Array.from({ length: 5 }).map((_, index) => (
                    <div className="dashboard-tier-step dashboard-skeleton-tier-step" key={index}>
                        <SkeletonCircle size={34} />
                        <Skeleton width="70%" height={14} />
                        <Skeleton width="82%" height={11} />
                        <Skeleton width={index === 0 ? "50%" : "68%"} height={11} />
                    </div>
                ))}
            </div>
        </section>
    );
}

function DashboardReferralSkeleton() {
    return (
        <section className="dashboard-card dashboard-referral-card dashboard-skeleton-card">
            <div className="dashboard-card-header">
                <div>
                    <Skeleton width={112} height={12} />
                    <div style={{ height: 10 }} />
                    <Skeleton width={250} height={26} />
                    <div style={{ height: 12 }} />
                    <Skeleton width={360} height={14} />
                </div>

                <Skeleton width={72} height={58} radius={18} />
            </div>

            <div className="dashboard-referral-conditions">
                {Array.from({ length: 2 }).map((_, index) => (
                    <div className="dashboard-skeleton-condition" key={index}>
                        <SkeletonCircle size={30} />

                        <div>
                            <Skeleton width={index === 0 ? 210 : 170} height={14} />
                            <div style={{ height: 9 }} />
                            <Skeleton width={index === 0 ? 300 : 245} height={12} />
                        </div>
                    </div>
                ))}
            </div>

            <div className="dashboard-skeleton-referral-box">
                <Skeleton width="72%" height={15} />
                <SkeletonButton width={82} />
            </div>
        </section>
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