import { useEffect, useState } from "react";
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
    const [error, setError] = useState("");
    const [copiedReferral, setCopiedReferral] = useState(false);

    useEffect(() => {
        if (!hasAccess) return;

        const loadLoyalty = async () => {
            try {
                setLoading(true);
                setError("");

                const loadedLoyalty = await getMyLoyalty();
                setLoyalty(loadedLoyalty);
            } catch (e) {
                setError(e?.message || "Failed to load loyalty page");
            } finally {
                setLoading(false);
            }
        };

        loadLoyalty();
    }, [hasAccess]);

    const rewardHistory = loyalty?.rewardHistory || loyalty?.completedOrders || [];
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
                                                <em>{tier.bonusCoins} bonus coins</em>
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

                        <section className="loyalty-card">
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
        benefits: ["200 bonus coins", "3% top-up bonus"],
    },
    {
        key: "gold",
        name: "Gold",
        icon: "🥇",
        minSpend: 500,
        nextTier: "Platinum",
        bonusCoins: 500,
        topUpBonusPercent: 5,
        benefits: ["500 bonus coins", "5% top-up bonus"],
    },
    {
        key: "platinum",
        name: "Platinum",
        icon: "💎",
        minSpend: 1000,
        nextTier: "Diamond",
        bonusCoins: 800,
        topUpBonusPercent: 8,
        benefits: ["800 bonus coins", "8% top-up bonus"],
    },
    {
        key: "diamond",
        name: "Diamond",
        icon: "🔷",
        minSpend: 1500,
        nextTier: null,
        bonusCoins: 1500,
        topUpBonusPercent: 10,
        benefits: ["1500 bonus coins", "10% top-up bonus"],
    },
];