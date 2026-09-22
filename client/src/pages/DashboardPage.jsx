import { useEffect, useState } from "react";
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
