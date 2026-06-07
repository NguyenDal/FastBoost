import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Navbar from "../components/Navbar";
import { getMyLoyalty } from "../api/loyalty";
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

    const [loyalty, setLoyalty] = useState(null);
    const [loading, setLoading] = useState(true);
    const [rewardLoading, setRewardLoading] = useState(false);
    const [error, setError] = useState("");
    const [copiedReferral, setCopiedReferral] = useState(false);

    const [rewardPage, setRewardPage] = useState(1);
    const REWARD_PAGE_SIZE = 5;

    const rewardSectionRef = useRef(null);
    const hasLoadedOnceRef = useRef(false);

    useEffect(() => {
        if (!hasAccess) return;

        let cancelled = false;

        const loadLoyalty = async () => {
            const shouldOnlyRefreshRewards = hasLoadedOnceRef.current;

            try {
                if (shouldOnlyRefreshRewards) {
                    setRewardLoading(true);
                } else {
                    setLoading(true);
                }

                setError("");

                const loadedLoyalty = await getMyLoyalty({
                    rewardPage,
                    rewardLimit: REWARD_PAGE_SIZE,
                });

                if (!cancelled) {
                    setLoyalty(loadedLoyalty);
                    hasLoadedOnceRef.current = true;
                }
            } catch (e) {
                if (!cancelled) {
                    setError(e?.message || "Failed to load loyalty page");
                }
            } finally {
                if (!cancelled) {
                    setLoading(false);
                    setRewardLoading(false);
                }
            }
        };

        loadLoyalty();

        return () => {
            cancelled = true;
        };
    }, [hasAccess, rewardPage]);

    const rewardHistory = loyalty?.rewardHistory || loyalty?.completedOrders || [];
    const rewardPagination = loyalty?.rewardPagination || {
        page: 1,
        limit: REWARD_PAGE_SIZE,
        totalItems: rewardHistory.length,
        totalPages: 1,
    };

    const totalRewardPages = Math.max(1, rewardPagination.totalPages || 1);
    const completedMatches = loyalty?.completedMatches || 0;
    const totalGold = loyalty?.totalGold || 0;
    const totalSpent = Number(loyalty?.totalCompletedSpend || 0);
    const goldDollarValue = (totalGold / 10).toFixed(2);
    const referralLink = loyalty?.referralLink || "";
    const referralCount = loyalty?.referralCount || 0;
    const referralEligibility = loyalty?.referralEligibility || null;
    const referralConditions = referralEligibility?.conditions || {};
    const canUseReferral = Boolean(referralEligibility?.eligible && referralLink);

    const referralConditionList = [
        referralConditions.emailVerified,
        referralConditions.completedOrders,
    ].filter(Boolean);

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

    const tierInfo = {
        key: loyalty?.tierKey || "bronze",
        name: loyalty?.tier || "Bronze",
        icon: loyalty?.icon || "🥉",
        nextTier: loyalty?.nextTier || null,
        spendToNext: Number(loyalty?.spendToNext || 0),
    };

    const progressPercent = loyalty?.progressPercent || 0;
    const loyaltyTiers = loyalty?.tiers || LOYALTY_TIERS;

    if (!hasAccess) return null;

    const changeRewardPage = (nextPage) => {
        setRewardPage(nextPage);

        window.requestAnimationFrame(() => {
            rewardSectionRef.current?.scrollIntoView({
                behavior: "smooth",
                block: "start",
            });
        });
    };

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
                                    Spend more on completed orders to unlock higher loyalty status and track your earned gold.
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
                                            ? `Spend $${tierInfo.spendToNext.toFixed(2)} more to reach ${tierInfo.nextTier} tier.`
                                            : "You reached the highest loyalty tier."}
                                    </p>
                                </div>
                            </div>

                            <div className="loyalty-track">
                                <div
                                    className={`loyalty-track-fill loyalty-fill-${tierInfo.key}`}
                                    style={{ width: `${progressPercent}%` }}
                                />
                            </div>

                            <div className="loyalty-tier-row">
                                {loyaltyTiers.map((tier) => (
                                    <div
                                        key={tier.key}
                                        className={`loyalty-tier-step tier-${tier.key} ${totalSpent >= tier.minSpend ? "active" : ""
                                            } ${tier.key === tierInfo.key ? "current" : ""}`}
                                    >
                                        <span>{tier.icon}</span>
                                        <strong>{tier.name}</strong>
                                        <small>${tier.minSpend}+ spend</small>

                                        <div className="loyalty-tier-benefits">
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

                        <section className="loyalty-stats-grid">
                            <div className="loyalty-stat-card">
                                <span>Total Gold</span>
                                <strong>
                                    {totalGold} = ${goldDollarValue}
                                </strong>
                            </div>

                            <div className="loyalty-stat-card">
                                <span>Completed Matches</span>
                                <strong>{completedMatches}</strong>
                            </div>

                            <div className="loyalty-stat-card">
                                <span>Total Completed Spend</span>
                                <strong>${totalSpent.toFixed(2)}</strong>
                            </div>
                        </section>

                        <section className={`loyalty-card loyalty-referral-card ${canUseReferral ? "is-unlocked" : "is-locked"}`}>
                            <div className="loyalty-section-header">
                                <div>
                                    <p className="loyalty-eyebrow">Private Invite</p>
                                    <h2>Share Your Referral Link</h2>
                                    <p>
                                        Invite friends to FastBoost. Once this feature is fully connected,
                                        successful referred registrations can give you a $5 discount.
                                    </p>
                                </div>

                                <div className="loyalty-referral-count">
                                    <span>{referralCount}</span>
                                    <small>Invited Users</small>
                                </div>
                            </div>

                            <div className="loyalty-referral-condition-box">
                                <div className="loyalty-referral-condition-header">
                                    <strong>Referral Requirements</strong>
                                    <span className={canUseReferral ? "condition-status-ready" : "condition-status-locked"}>
                                        {canUseReferral ? "Unlocked" : "Locked"}
                                    </span>
                                </div>

                                <div className="loyalty-referral-condition-list">
                                    {referralConditionList.map((condition) => (
                                        <div
                                            key={condition.label}
                                            className={`loyalty-referral-condition ${condition.passed ? "passed" : "failed"}`}
                                        >
                                            <span className="condition-icon">
                                                {condition.passed ? "✓" : "×"}
                                            </span>

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
                            </div>

                            <div className={`loyalty-referral-link-box ${!canUseReferral ? "is-disabled" : ""}`}>
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

                        <section className="loyalty-card" ref={rewardSectionRef}>
                            <div className="loyalty-section-header">
                                <div>
                                    <h2>Reward History</h2>
                                    <p>Your latest completed match rewards, referral rewards, and bonus gold.</p>
                                </div>

                                <Link to="/account/orders" className="loyalty-secondary-btn">
                                    View My Orders
                                </Link>
                            </div>

                            {rewardHistory.length > 0 ? (
                                <>
                                    {rewardLoading && (
                                        <p className="loyalty-reward-loading">Updating reward history...</p>
                                    )}

                                    <div className="loyalty-match-list">
                                        {rewardHistory.map((reward) => (
                                            <div className="loyalty-match-row" key={reward.id}>
                                                <div>
                                                    <strong>{reward.title || "Reward"}</strong>

                                                    <small>
                                                        {reward.description || "Reward added"} •{" "}
                                                        {reward.createdAt
                                                            ? new Date(reward.createdAt).toLocaleString()
                                                            : "Recently added"}
                                                    </small>
                                                </div>

                                                <div className="loyalty-match-gold">
                                                    <span>+{reward.goldEarned}</span>
                                                    <small>gold</small>
                                                </div>
                                            </div>
                                        ))}
                                    </div>

                                    {totalRewardPages > 1 && (
                                        <div className="loyalty-pagination">
                                            <button
                                                type="button"
                                                onClick={() => changeRewardPage(Math.max(1, rewardPage - 1))}
                                                disabled={rewardPage <= 1 || rewardLoading}
                                            >
                                                Previous
                                            </button>

                                            <div className="loyalty-page-numbers">
                                                {Array.from({ length: totalRewardPages }, (_, index) => {
                                                    const pageNumber = index + 1;

                                                    return (
                                                        <button
                                                            key={pageNumber}
                                                            type="button"
                                                            className={pageNumber === rewardPage ? "active" : ""}
                                                            onClick={() => changeRewardPage(pageNumber)}
                                                            disabled={rewardLoading}
                                                        >
                                                            {pageNumber}
                                                        </button>
                                                    );
                                                })}
                                            </div>

                                            <button
                                                type="button"
                                                onClick={() => changeRewardPage(Math.min(totalRewardPages, rewardPage + 1))}
                                                disabled={rewardPage >= totalRewardPages || rewardLoading}
                                            >
                                                Next
                                            </button>
                                        </div>
                                    )}
                                </>
                            ) : (
                                <div className="loyalty-empty">
                                    <h3>No rewards yet</h3>
                                    <p>
                                        Your reward history starts when you complete orders or earn referral rewards.
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
        minSpend: 0,
        nextTier: "Silver",
        bonusCoins: 0,
        topUpBonusPercent: 0,
        benefits: ["No bonus"],
    },
    {
        key: "silver",
        name: "Silver",
        icon: "🥈",
        minSpend: 200,
        nextTier: "Gold",
        bonusCoins: 200,
        topUpBonusPercent: 3,
        benefits: ["200 bonus gold", "3% top-up bonus"],
    },
    {
        key: "gold",
        name: "Gold",
        icon: "🥇",
        minSpend: 500,
        nextTier: "Platinum",
        bonusCoins: 500,
        topUpBonusPercent: 5,
        benefits: ["500 bonus gold", "5% top-up bonus"],
    },
    {
        key: "platinum",
        name: "Platinum",
        icon: "💎",
        minSpend: 1000,
        nextTier: "Diamond",
        bonusCoins: 800,
        topUpBonusPercent: 8,
        benefits: ["800 bonus gold", "8% top-up bonus"],
    },
    {
        key: "diamond",
        name: "Diamond",
        icon: "🔷",
        minSpend: 1500,
        nextTier: null,
        bonusCoins: 1500,
        topUpBonusPercent: 10,
        benefits: ["1500 bonus gold", "10% top-up bonus"],
    },
];