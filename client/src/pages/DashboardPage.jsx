import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { listMyNotifications, markNotificationRead } from "../api/notifications";
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

    useEffect(() => {
        let cancelled = false;

        const loadDashboard = async () => {
            try {
                setLoading(true);
                setError("");

                const [notificationItems, loyaltyData] = await Promise.all([
                    listMyNotifications({ dashboard: true }),
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

    useEffect(() => {
        let cancelled = false;
        const refresh = async () => {
            try {
                const items = await listMyNotifications({ dashboard: true });
                if (!cancelled) setNotifications(items);
            } catch { /* Keep the last successful activity list. */ }
        };
        const interval = window.setInterval(refresh, 30000);
        window.addEventListener("unread:update", refresh);
        window.addEventListener("focus", refresh);
        return () => {
            cancelled = true;
            window.clearInterval(interval);
            window.removeEventListener("unread:update", refresh);
            window.removeEventListener("focus", refresh);
        };
    }, []);

    const newNotifications = notifications
        .filter((item) => item.type !== "CHAT_MESSAGE")
        .slice(0, 3);

    const newMessages = notifications
        .filter((item) => item.type === "CHAT_MESSAGE")
        .slice(0, 3);

    const referralLink = loyalty?.referralLink || "";
    const referralCount = loyalty?.referralCount || 0;
    const referralOffer = loyalty?.referralOffer || {};
    const referralDiscountPercent = Number(
        referralOffer?.firstPurchaseDiscountPercent || 10
    );
    const referralQualifyingPurchaseMinimum = Number(
        referralOffer?.qualifyingPurchaseMinimum || 50
    );
    const referralRewardGold = Number(referralOffer?.rewardGold || 50);
    const canUseReferral = Boolean(referralLink);

    const referralSteps = [
        {
            label: "Share your private invite link",
            helpText: `Your friend receives ${referralDiscountPercent}% off their first purchase when they join through it.`,
        },
        {
            label: `Your friend completes a $${referralQualifyingPurchaseMinimum.toFixed(2)}+ first purchase`,
            helpText: "The order must be paid and completed before the gold rewards are added.",
        },
        {
            label: `Both accounts receive ${referralRewardGold} gold ($5)`,
            helpText: "Your friend's gold is ready for a future purchase.",
        },
    ];

    const tierInfo = {
        key: loyalty?.tierKey || "bronze",
        name: loyalty?.tier || "Bronze",
        icon: loyalty?.icon || "🥉",
        nextTier: loyalty?.nextTier || null,
        spendToNext: Number(loyalty?.spendToNext || 0),
    };

    const progressPercent = Number(loyalty?.progressPercent || 0);

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

    const openNotificationTarget = async (item) => {
        if (!item.read) {
            try {
                await markNotificationRead(item.id);
                setNotifications((items) => items.map((entry) => entry.id === item.id ? { ...entry, read: true } : entry));
                window.dispatchEvent(new Event("unread:update"));
            } catch {
                return;
            }
        }
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
                <DashboardSkeleton />
            ) : error ? (
                <div className="dashboard-card dashboard-error-card">
                    {error}
                </div>
            ) : (
                <>
                    <section className="dashboard-grid dashboard-grid-top">
                        <DashboardListCard
                            title="New Notifications"
                            emptyText="No notifications yet."
                            items={newNotifications}
                            onItemClick={openNotificationTarget}
                        />

                        <DashboardListCard
                            title="New Messages"
                            emptyText="No messages yet."
                            items={newMessages}
                            onItemClick={openNotificationTarget}
                            isMessage
                        />
                    </section>

                    <section className="dashboard-grid dashboard-grid-bottom">
                        <div className="dashboard-account-stack">
                            <section className="dashboard-card dashboard-wallet-card">
                                <p className="dashboard-eyebrow purple">Wallet</p>
                                <p className="dashboard-wallet-label">Available balance</p>
                                <strong className="dashboard-wallet-balance">$0.00</strong>
                                <Link to="/account/loyalty" className="dashboard-wallet-gold">
                                    <span className="dashboard-wallet-coin" aria-hidden="true">🪙</span>
                                    <span>Gold Balance</span>
                                    <strong>{Math.max(0, Number(loyalty?.totalGold || 0)).toLocaleString()}</strong>
                                    <span className="dashboard-wallet-chevron" aria-hidden="true">›</span>
                                </Link>
                                <div className="dashboard-wallet-actions">
                                    <button type="button" className="dashboard-wallet-topup" disabled title="Wallet top-ups are not available yet">Top Up</button>
                                    <Link to="/" className="dashboard-wallet-redeem" title="Choose a service to redeem gold at checkout">Redeem Gold</Link>
                                </div>
                            </section>
                            <Link
                                to="/account/loyalty"
                                className={"dashboard-card dashboard-loyalty-card dashboard-loyalty-" + tierInfo.key}
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
                                    <span className="dashboard-tier-badge">{tierInfo.icon}</span>
                                </div>
                                <div className="dashboard-track" role="progressbar" aria-label="Loyalty tier progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progressPercent}>
                                    <div
                                        className={"dashboard-track-fill dashboard-fill-" + tierInfo.key}
                                        style={{ width: progressPercent + "%" }}
                                    />
                                </div>
                            </Link>
                        </div>

                        <section className={`dashboard-card dashboard-referral-card ${canUseReferral ? "is-unlocked" : "is-locked"}`}>
                            <div className="dashboard-card-header">
                                <div>
                                    <p className="dashboard-eyebrow green">Refer a Friend</p>
                                    <h2>Refer a Friend</h2>
                                </div>

                                <div className="dashboard-referral-count">
                                    <strong>{referralCount}</strong>
                                    <small>Invited</small>
                                </div>
                            </div>

                            <div className="dashboard-referral-steps">
                                {referralSteps.map((step, index) => (
                                    <div
                                        key={step.label}
                                        className="dashboard-referral-step"
                                    >
                                        <span aria-hidden="true">{index + 1}</span>

                                        <div>
                                            <strong>
                                                {step.label}
                                            </strong>
                                            <small>{step.helpText}</small>
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
                <div className="dashboard-account-stack">
                    <section className="dashboard-card dashboard-wallet-card dashboard-skeleton-card">
                        <Skeleton width={100} height={24} />
                        <Skeleton width={140} height={12} />
                        <Skeleton width={160} height={44} />
                    </section>
                    <DashboardLoyaltySkeleton />
                </div>
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
                </div>

                <SkeletonCircle size={58} />
            </div>

            <div style={{ height: 22 }} />

            <Skeleton width="100%" height={14} radius={999} />

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
                </div>

                <Skeleton width={72} height={58} radius={18} />
            </div>

            <div className="dashboard-referral-steps">
                {Array.from({ length: 3 }).map((_, index) => (
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

function activityTime(createdAt) {
    const date = new Date(createdAt);
    if (!Number.isFinite(date.getTime())) return "";
    const minutes = Math.max(0, Math.floor((Date.now() - date.getTime()) / 60000));
    if (minutes < 1) return "Just now";
    if (minutes < 60) return minutes + "m ago";
    if (minutes < 1440) return Math.floor(minutes / 60) + "h ago";
    return Math.floor(minutes / 1440) + "d ago";
}

function ActivityIcon({ kind }) {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {kind === "message" ? <><path d="M4 4h16v12H9l-5 4V4Z" /><path d="M8 8h8M8 12h5" /></> :
                kind === "completed" ? <path d="m5 12 4 4L19 6" /> :
                kind === "cancelled" ? <path d="m6 6 12 12M18 6 6 18" /> :
                kind === "discount" ? <><path d="m6 18 12-12" /><circle cx="7" cy="7" r="2" /><circle cx="17" cy="17" r="2" /></> :
                <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" /><path d="M10 21h4" /></>}
        </svg>
    );
}

function MessageAvatar({ item }) {
    const [failedSource, setFailedSource] = useState(null);
    const source = item.data?.senderAvatar;
    if (source && source !== failedSource) {
        return <img src={source} alt="" className="dashboard-message-avatar" onError={() => setFailedSource(source)} />;
    }
    return item.data?.senderInitial || item.title?.charAt(0) || "?";
}

function DashboardListCard({ title, emptyText, items, onItemClick, isMessage = false }) {
    const unreadCount = items.filter((item) => !item.read).length;
    return (
        <section className="dashboard-card dashboard-list-card">
            <div className="dashboard-activity-header">
                <span className="dashboard-activity-heading-icon"><ActivityIcon kind={isMessage ? "message" : "notification"} /></span>
                <h2>{title}</h2>
                <button type="button" className="dashboard-view-all" onClick={() => window.dispatchEvent(new CustomEvent("dashboard:open-activity", { detail: isMessage ? "messages" : "notifications" }))}>View all</button>
                <span className="dashboard-count-pill" aria-label={unreadCount + " unread"}>{unreadCount}</span>
            </div>
            {items.length === 0 ? (
                <div className="dashboard-empty-line">{emptyText}</div>
            ) : (
                <div className="dashboard-activity-list">
                    {items.map((item) => {
                        const kind = item.type === "ORDER_COMPLETED" ? "completed" :
                            item.type.includes("CANCELLED") ? "cancelled" :
                            ["FIRST_PURCHASE_DISCOUNT", "REFERRAL_REWARD"].includes(item.type) ? "discount" : "notification";
                        return (
                            <button key={item.id} type="button" className="dashboard-activity-item" onClick={() => onItemClick(item)}>
                                <span className={"dashboard-activity-icon " + (isMessage ? "avatar" : kind)}>
                                    {isMessage ? <MessageAvatar item={item} /> : <ActivityIcon kind={kind} />}
                                </span>
                                <span className="dashboard-activity-copy">
                                    <strong>{item.title || (isMessage ? "New message" : "Notification")}</strong>
                                    <span>{item.message || "Open to view details."}</span>
                                </span>
                                <span className="dashboard-activity-meta">
                                    <time dateTime={item.createdAt} title={new Date(item.createdAt).toLocaleString()}>{activityTime(item.createdAt)}</time>
                                    {!item.read && <span className="dashboard-unread-dot" role="img" aria-label="Unread" />}
                                </span>
                            </button>
                        );
                    })}
                </div>
            )}
        </section>
    );
}
