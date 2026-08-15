import { useEffect, useState } from "react";
import { API_BASE_URL } from "../api/config";
import "../styles/Admin.css";
import "../styles/PriceManagement.css";

function formatPricingType(type) {
    const labels = {
        RANK_BASED: "Rank-based",
        PLACEMENT_BASED: "Placement-based",
        PER_WIN: "Per-win",
        DUO_ADDON: "Duo / Add-on",
    };

    return labels[type] || type || "Dynamic";
}

function getPricePreview(item) {
    const config = item.config || {};

    if (item.pricingType === "RANK_BASED") {
        const prices = config.divisionStepPrices || {};
        const values = Object.values(prices).map(Number).filter(Number.isFinite);

        if (values.length === 0) return "Dynamic";

        const min = Math.min(...values);
        const max = Math.max(...values);

        if (config.masterLpPricing?.perLp) {
            return `$${min}–$${max} / division, Master $${config.masterLpPricing.perLp}/LP`;
        }

        if (config.masterLpPricing?.first100LpPerLp) {
            return `$${min}–$${max} / division, Master from $${config.masterLpPricing.first100LpPerLp}/LP`;
        }

        return `$${min}–$${max} / division`;
    }

    if (item.pricingType === "PER_WIN") {
        const prices = config.perWinPrices || {};
        const values = Object.values(prices).map(Number).filter(Number.isFinite);

        if (values.length === 0) return "Dynamic";

        return `$${Math.min(...values)}–$${Math.max(...values)} / win`;
    }

    if (item.pricingType === "PLACEMENT_BASED") {
        const prices = config.fullSetPrices || {};
        const values = Object.values(prices).map(Number).filter(Number.isFinite);

        if (values.length === 0) return "Dynamic";

        return `$${Math.min(...values)}–$${Math.max(...values)} / 5 games`;
    }

    if (item.pricingType === "DUO_ADDON") {
        return "Win price × 0.75 / game";
    }

    return "Dynamic";
}

function formatMoney(value) {
    const number = Number(value);

    if (!Number.isFinite(number)) return "—";

    return Number.isInteger(number)
        ? `$${number}`
        : `$${number.toFixed(2)}`;
}

function formatMultiplier(value) {
    const number = Number(value);

    if (!Number.isFinite(number)) return "—";

    return `×${number.toFixed(2)}`;
}

function formatPercent(value) {
    const number = Number(value);

    if (!Number.isFinite(number)) return "—";

    return `+${Math.round(number * 100)}%`;
}

function DetailTable({
    title,
    entries,
    leftHeading = "Condition",
    rightHeading = "Price",
    formatter = formatMoney,
    editable = false,
    onValueChange,
}) {
    const rows = Object.entries(entries || {});

    if (rows.length === 0) return null;

    return (
        <section className="price-detail-section">
            <div className="price-detail-section-header">
                <h4>{title}</h4>
                <span>{rows.length} values</span>
            </div>

            <div className="price-detail-table-wrap">
                <table className="price-detail-table">
                    <thead>
                        <tr>
                            <th>{leftHeading}</th>
                            <th>{rightHeading}</th>
                        </tr>
                    </thead>

                    <tbody>
                        {rows.map(([label, value]) => (
                            <tr key={label}>
                                <td>{label}</td>

                                <td>
                                    {editable ? (
                                        <div className="price-edit-input-wrap">
                                            <span>$</span>

                                            <input
                                                type="number"
                                                min="0"
                                                step="0.01"
                                                value={value}
                                                onChange={(event) =>
                                                    onValueChange?.(
                                                        label,
                                                        event.target.value
                                                    )
                                                }
                                            />
                                        </div>
                                    ) : (
                                        <strong>
                                            {formatter(value)}
                                        </strong>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </section>
    );
}

function AddonDetails({ addons }) {
    if (!addons) return null;

    return (
        <section className="price-detail-section">
            <div className="price-detail-section-header">
                <h4>Add-on Pricing</h4>
                <span>Shared modifiers</span>
            </div>

            <div className="price-addon-grid">
                <div className="price-addon-item">
                    <span>Duo Mode</span>
                    <strong>{formatMultiplier(addons.duoModeMultiplier)}</strong>
                </div>

                <div className="price-addon-item">
                    <span>Duo Extra</span>
                    <strong>{formatPercent(addons.duoExtraPercent)}</strong>
                </div>

                <div className="price-addon-item">
                    <span>Express</span>
                    <strong>{formatPercent(addons.expressPercent)}</strong>
                </div>

                <div className="price-addon-item">
                    <span>Premium Coaching</span>
                    <strong>{formatPercent(addons.premiumCoachingPercent)}</strong>
                </div>

                <div className="price-addon-item">
                    <span>Solo Only</span>
                    <strong>{formatPercent(addons.soloOnlyPercent)}</strong>
                </div>

                <div className="price-addon-item">
                    <span>High MMR Duo</span>
                    <strong>{formatPercent(addons.highMmrDuoPercent)}</strong>
                </div>

                <div className="price-addon-item">
                    <span>Untrackable Duo</span>
                    <strong>{formatPercent(addons.untrackableDuoPercent)}</strong>
                </div>
            </div>

            {addons.championPreference && (
                <div className="price-detail-subsection">
                    <h5>Champion Preference</h5>

                    <div className="price-addon-grid">
                        {Object.entries(addons.championPreference).map(
                            ([label, value]) => (
                                <div className="price-addon-item" key={label}>
                                    <span>{label} champion{label === "1" ? "" : "s"}</span>
                                    <strong>{formatPercent(value)}</strong>
                                </div>
                            )
                        )}
                    </div>
                </div>
            )}

            {addons.bonusWin && (
                <div className="price-detail-subsection">
                    <h5>Bonus Win</h5>

                    <div className="price-addon-grid">
                        <div className="price-addon-item">
                            <span>Solo</span>
                            <strong>{addons.bonusWin.solo}</strong>
                        </div>

                        <div className="price-addon-item">
                            <span>Duo</span>
                            <strong>
                                {formatMultiplier(addons.bonusWin.duoMultiplier)}
                            </strong>
                        </div>
                    </div>
                </div>
            )}
        </section>
    );
}

function PricingRuleDetails({
    item,
    editing = false,
    draftConfig = null,
    onDraftPriceChange,
    onDraftValueChange,
}) {
    const config =
        editing && draftConfig
            ? draftConfig
            : item.config || {};
    const modifiers = config.modifiers || {};

    if (item.pricingType === "RANK_BASED") {
        return (
            <div className="price-rule-details">
                <DetailTable
                    title="Division Step Prices"
                    entries={config.divisionStepPrices}
                    leftHeading="Starting Division"
                    rightHeading="Step Price"
                    editable={editing}
                    onValueChange={(key, value) =>
                        onDraftPriceChange(
                            "divisionStepPrices",
                            key,
                            value
                        )
                    }
                />

                {config.masterLpPricing && (
                    <section className="price-detail-section">
                        <div className="price-detail-section-header">
                            <h4>Master LP Pricing</h4>
                        </div>

                        <div className="price-addon-grid">
                            {config.masterLpPricing.first100LpPerLp != null && (
                                <div className="price-addon-item">
                                    <span>First 100 LP</span>
                                    <strong>
                                        {formatMoney(
                                            config.masterLpPricing.first100LpPerLp
                                        )}{" "}
                                        / LP
                                    </strong>
                                </div>
                            )}

                            {config.masterLpPricing.above100LpPerLp != null && (
                                <div className="price-addon-item">
                                    <span>Above 100 LP</span>
                                    <strong>
                                        {formatMoney(
                                            config.masterLpPricing.above100LpPerLp
                                        )}{" "}
                                        / LP
                                    </strong>
                                </div>
                            )}

                            {config.masterLpPricing.perLp != null && (
                                <div className="price-addon-item">
                                    <span>Master LP</span>
                                    <strong>
                                        {formatMoney(config.masterLpPricing.perLp)} / LP
                                    </strong>
                                </div>
                            )}
                        </div>
                    </section>
                )}

                <DetailTable
                    title="Current LP Progress"
                    entries={modifiers.currentLpProgress}
                    leftHeading="Current LP"
                    rightHeading="Multiplier"
                    formatter={formatMultiplier}
                />

                <DetailTable
                    title="LP Gain Modifier"
                    entries={modifiers.lpGain}
                    leftHeading="LP Gain / Win"
                    rightHeading="Multiplier"
                    formatter={formatMultiplier}
                />

                <AddonDetails addons={config.addons} />
            </div>
        );
    }

    if (item.pricingType === "PLACEMENT_BASED") {
        return (
            <div className="price-rule-details">
                <section className="price-formula-card">
                    <span>Placement Set</span>
                    <strong>{config.fullSetGames || 5} games</strong>

                    {config.formula && <code>{config.formula}</code>}
                </section>

                <DetailTable
                    title="Placement Prices"
                    entries={config.fullSetPrices}
                    leftHeading="Previous / Peak Rank"
                    rightHeading={`Price / ${config.fullSetGames || 5} Games`}
                    editable={editing}
                    onValueChange={(key, value) =>
                        onDraftPriceChange(
                            "fullSetPrices",
                            key,
                            value
                        )
                    }
                />

                <AddonDetails addons={config.addons} />
            </div>
        );
    }

    if (item.pricingType === "PER_WIN") {
        return (
            <div className="price-rule-details">
                {config.formula && (
                    <section className="price-formula-card">
                        <span>Calculation Formula</span>
                        <code>{config.formula}</code>
                    </section>
                )}

                <DetailTable
                    title="Per-Win Prices"
                    entries={config.perWinPrices}
                    leftHeading="Current Rank"
                    rightHeading="Price / Win"
                    editable={editing}
                    onValueChange={(key, value) =>
                        onDraftPriceChange(
                            "perWinPrices",
                            key,
                            value
                        )
                    }
                />

                <DetailTable
                    title="LP Gain Modifier"
                    entries={modifiers.lpGain}
                    leftHeading="LP Gain / Win"
                    rightHeading="Multiplier"
                    formatter={formatMultiplier}
                />

                <AddonDetails addons={config.addons} />
            </div>
        );
    }

    if (item.pricingType === "DUO_ADDON") {
        return (
            <div className="price-rule-details">
                <section className="price-duo-summary">
                    <div>
                        <span>Pricing Source</span>
                        <strong>{config.source || "Win Boost"}</strong>
                    </div>

                    <div>
                        <span>Base Multiplier</span>
                        <strong>{formatMultiplier(config.multiplier)}</strong>
                    </div>
                </section>

                {config.formula && (
                    <section className="price-formula-card">
                        <span>Calculation Formula</span>
                        <code>{config.formula}</code>
                    </section>
                )}

                <DetailTable
                    title="Source Win Prices"
                    entries={config.perWinPrices}
                    leftHeading="Current Rank"
                    rightHeading="Win Boost Price"
                />

                <DetailTable
                    title="LP Gain Modifier"
                    entries={modifiers.lpGain}
                    leftHeading="LP Gain / Win"
                    rightHeading="Multiplier"
                    formatter={formatMultiplier}
                />

                <AddonDetails addons={config.addons} />
            </div>
        );
    }

    return (
        <div className="price-rule-details">
            <p className="price-empty-message">
                No detailed configuration is available for this rule.
            </p>
        </div>
    );
}

export default function PriceManagementPage() {
    const [pricingServices, setPricingServices] = useState([]);
    const [pricesLoading, setPricesLoading] = useState(true);
    const [pricesError, setPricesError] = useState("");

    const [editingRuleId, setEditingRuleId] = useState(null);
    const [draftConfig, setDraftConfig] = useState(null);
    const [priceSaving, setPriceSaving] = useState(false);
    const [priceSaveError, setPriceSaveError] = useState("");

    const [saleModalOpen, setSaleModalOpen] = useState(false);
    const [selectedService, setSelectedService] = useState(null);

    const [gameFilter, setGameFilter] = useState("ALL");
    const [statusFilter, setStatusFilter] = useState("ALL");
    const [searchTerm, setSearchTerm] = useState("");
    const [expandedRuleIds, setExpandedRuleIds] = useState(() => new Set());

    const toggleRuleDetails = (ruleId) => {
        setExpandedRuleIds((current) => {
            const next = new Set(current);

            if (next.has(ruleId)) {
                next.delete(ruleId);
            } else {
                next.add(ruleId);
            }

            return next;
        });
    };

    const loadPricingRules = async () => {
        setPricesLoading(true);
        setPricesError("");

        try {
            const token = localStorage.getItem("token");

            const response = await fetch(`${API_BASE_URL}/admin/prices`, {
                headers: {
                    ...(token ? { Authorization: `Bearer ${token}` } : {}),
                },
            });

            const data = await response.json();

            if (!response.ok || data.ok === false) {
                throw new Error(data.message || "Failed to load price rules.");
            }

            setPricingServices(data.items || []);
        } catch (error) {
            setPricesError(error.message || "Failed to load price rules.");
        } finally {
            setPricesLoading(false);
        }
    };

    const startPriceEdit = (item) => {
        setEditingRuleId(item.id);

        setDraftConfig(
            JSON.parse(JSON.stringify(item.config || {}))
        );

        setPriceSaveError("");
    };

    const cancelPriceEdit = () => {
        setEditingRuleId(null);
        setDraftConfig(null);
        setPriceSaveError("");
    };

    const updateDraftPrice = (section, key, value) => {
        setDraftConfig((current) => ({
            ...current,

            [section]: {
                ...(current?.[section] || {}),
                [key]: value,
            },
        }));
    };

    const updateDraftValue = (key, value) => {
        setDraftConfig((current) => ({
            ...current,
            [key]: value,
        }));
    };

    const savePriceChanges = async (item) => {
        try {
            setPriceSaving(true);
            setPriceSaveError("");

            const token = localStorage.getItem("token");

            const response = await fetch(
                `${API_BASE_URL}/admin/prices/rules/${item.id}`,
                {
                    method: "PATCH",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${token}`,
                    },
                    body: JSON.stringify({
                        config: draftConfig,
                    }),
                }
            );

            const data = await response.json();

            if (!response.ok || data.ok === false) {
                throw new Error(
                    data.message || "Failed to update pricing."
                );
            }

            setPricingServices((current) =>
                current.map((rule) =>
                    rule.id === item.id
                        ? {
                            ...rule,
                            config: data.rule.config,
                        }
                        : rule
                )
            );

            setEditingRuleId(null);
            setDraftConfig(null);
        } catch (error) {
            setPriceSaveError(error.message);
        } finally {
            setPriceSaving(false);
        }
    };

    useEffect(() => {
        loadPricingRules();
    }, []);

    const openSaleModal = (service = null) => {
        setSelectedService(service);
        setSaleModalOpen(true);
    };

    const closeSaleModal = () => {
        setSaleModalOpen(false);
        setSelectedService(null);
    };

    const activeServices = pricingServices.filter((item) => item.active).length;
    const activeSales = pricingServices.filter((item) => item.sale?.status === "ACTIVE").length;
    const upcomingSales = pricingServices.filter((item) => item.sale?.status === "SCHEDULED").length;

    const filteredPricingServices = pricingServices.filter((item) => {
        const matchesGame =
            gameFilter === "ALL" || item.game === gameFilter;

        const normalizedSearch = searchTerm.trim().toLowerCase();

        const matchesSearch =
            !normalizedSearch ||
            item.service?.title?.toLowerCase().includes(normalizedSearch) ||
            item.pricingType?.toLowerCase().includes(normalizedSearch);

        let matchesStatus = true;

        if (statusFilter === "ACTIVE") {
            matchesStatus = item.active;
        }

        if (statusFilter === "ON_SALE") {
            matchesStatus = item.sale?.status === "ACTIVE";
        }

        if (statusFilter === "SCHEDULED") {
            matchesStatus = item.sale?.status === "SCHEDULED";
        }

        if (statusFilter === "INACTIVE") {
            matchesStatus = !item.active;
        }

        return matchesGame && matchesSearch && matchesStatus;
    });

    return (
        <>

            <main className="price-management-page">
                <section className="admin-list-hero price-hero">
                    <div>
                        <p className="admin-eyebrow">FastBoost Admin</p>
                        <h1 className="admin-order-title">
                            Price <span>Management</span>
                        </h1>
                        <p className="admin-list-subtitle">
                            Manage dynamic service pricing rules, sale activation, and sale duration.
                        </p>
                    </div>
                </section>

                <section className="price-stats-grid">
                    <article className="price-stat-card">
                        <span className="price-stat-icon">🧾</span>
                        <div>
                            <p>Pricing Rules</p>
                            <strong>{pricingServices.length}</strong>
                            <span>Configured service rules</span>
                        </div>
                    </article>

                    <article className="price-stat-card">
                        <span className="price-stat-icon">✅</span>
                        <div>
                            <p>Active Services</p>
                            <strong>{activeServices}</strong>
                            <span>Available to customers</span>
                        </div>
                    </article>

                    <article className="price-stat-card">
                        <span className="price-stat-icon">🏷️</span>
                        <div>
                            <p>Active Sales</p>
                            <strong>{activeSales}</strong>
                            <span>Current sale campaigns</span>
                        </div>
                    </article>

                    <article className="price-stat-card">
                        <span className="price-stat-icon">⏱️</span>
                        <div>
                            <p>Upcoming Sales</p>
                            <strong>{upcomingSales}</strong>
                            <span>Scheduled promotions</span>
                        </div>
                    </article>
                </section>

                <section className="price-layout">
                    <div className="price-main-panel">
                        <div className="price-toolbar">
                            <div className="price-tabs">
                                <button
                                    type="button"
                                    className={`price-tab ${gameFilter === "ALL" ? "price-tab-active" : ""}`}
                                    onClick={() => setGameFilter("ALL")}
                                >
                                    All Games
                                </button>

                                <button
                                    type="button"
                                    className={`price-tab ${gameFilter === "LoL" ? "price-tab-active" : ""}`}
                                    onClick={() => setGameFilter("LoL")}
                                >
                                    League of Legends
                                </button>

                                <button
                                    type="button"
                                    className={`price-tab ${gameFilter === "TFT" ? "price-tab-active" : ""}`}
                                    onClick={() => setGameFilter("TFT")}
                                >
                                    Teamfight Tactics
                                </button>
                            </div>

                            <div className="price-search-row">
                                <select
                                    value={statusFilter}
                                    onChange={(event) => setStatusFilter(event.target.value)}
                                >
                                    <option value="ALL">All Status</option>
                                    <option value="ACTIVE">Active</option>
                                    <option value="ON_SALE">On Sale</option>
                                    <option value="SCHEDULED">Scheduled</option>
                                    <option value="INACTIVE">Inactive</option>
                                </select>

                                <input
                                    type="text"
                                    placeholder="Search service..."
                                    value={searchTerm}
                                    onChange={(event) => setSearchTerm(event.target.value)}
                                />
                            </div>
                        </div>

                        <div className="price-rules-panel">
                            <div className="price-table-header">
                                <div>
                                    <h2>Service Pricing Rules</h2>
                                    <p>
                                        Expand a service to inspect every rank price, modifier,
                                        formula, and add-on used by the pricing calculator.
                                    </p>
                                </div>

                                <span className="price-result-count">
                                    {filteredPricingServices.length} rule
                                    {filteredPricingServices.length === 1 ? "" : "s"}
                                </span>
                            </div>

                            {pricesLoading && (
                                <div className="price-empty-state">
                                    Loading pricing rules...
                                </div>
                            )}

                            {!pricesLoading && pricesError && (
                                <div className="price-empty-state price-empty-state-error">
                                    {pricesError}
                                </div>
                            )}

                            {!pricesLoading &&
                                !pricesError &&
                                filteredPricingServices.length === 0 && (
                                    <div className="price-empty-state">
                                        No pricing rules match the selected filters.
                                    </div>
                                )}

                            {!pricesLoading &&
                                !pricesError &&
                                filteredPricingServices.length > 0 && (
                                    <div className="price-rule-card-list">
                                        {filteredPricingServices.map((item) => {
                                            const expanded = expandedRuleIds.has(item.id);

                                            return (
                                                <article
                                                    key={item.id}
                                                    className={`price-rule-card ${expanded ? "price-rule-card-expanded" : ""
                                                        }`}
                                                >
                                                    <div className="price-rule-card-main">
                                                        <div className="price-rule-card-info">
                                                            <div className="price-rule-card-title-row">
                                                                <h3>
                                                                    {item.service?.title ||
                                                                        "Unknown Service"}
                                                                </h3>

                                                                <span
                                                                    className={`price-game-pill ${item.game === "LoL"
                                                                        ? "lol"
                                                                        : "tft"
                                                                        }`}
                                                                >
                                                                    {item.game}
                                                                </span>
                                                            </div>

                                                            <div className="price-rule-meta">
                                                                <span>
                                                                    {formatPricingType(
                                                                        item.pricingType
                                                                    )}
                                                                </span>

                                                                <span className="price-meta-divider">
                                                                    •
                                                                </span>

                                                                <strong>
                                                                    {getPricePreview(item)}
                                                                </strong>
                                                            </div>
                                                        </div>

                                                        <div className="price-rule-card-status">
                                                            {item.sale && (
                                                                <span className="price-sale-badge">
                                                                    {Number(
                                                                        item.sale.discountPercent
                                                                    ).toFixed(0)}
                                                                    % OFF
                                                                </span>
                                                            )}

                                                            <span
                                                                className={`price-status-pill ${item.active
                                                                    ? "active"
                                                                    : "inactive"
                                                                    }`}
                                                            >
                                                                {item.sale?.status === "ACTIVE"
                                                                    ? "On Sale"
                                                                    : item.sale?.status ===
                                                                        "SCHEDULED"
                                                                        ? "Scheduled"
                                                                        : item.active
                                                                            ? "Active"
                                                                            : "Inactive"}
                                                            </span>
                                                        </div>
                                                    </div>

                                                    {item.sale && (
                                                        <div className="price-rule-sale-row">
                                                            <span>
                                                                Sale:{" "}
                                                                <strong>
                                                                    {item.sale.title ||
                                                                        `${Number(
                                                                            item.sale.discountPercent
                                                                        ).toFixed(0)}% OFF`}
                                                                </strong>
                                                            </span>

                                                            <span>
                                                                Ends:{" "}
                                                                <strong>
                                                                    {item.sale.endsAt
                                                                        ? new Date(
                                                                            item.sale.endsAt
                                                                        ).toLocaleDateString()
                                                                        : "No end date"}
                                                                </strong>
                                                            </span>
                                                        </div>
                                                    )}

                                                    <div className="price-rule-card-actions">
                                                        <button
                                                            type="button"
                                                            className="price-detail-toggle"
                                                            onClick={() =>
                                                                toggleRuleDetails(item.id)
                                                            }
                                                        >
                                                            {expanded
                                                                ? "Hide Detailed Pricing"
                                                                : "View Detailed Pricing"}

                                                            <span
                                                                className={`price-detail-arrow ${expanded
                                                                    ? "price-detail-arrow-open"
                                                                    : ""
                                                                    }`}
                                                            >
                                                                ↓
                                                            </span>
                                                        </button>

                                                        <button
                                                            type="button"
                                                            className="price-row-btn"
                                                            onClick={() => openSaleModal(item)}
                                                        >
                                                            Sale Settings
                                                        </button>

                                                        <div className="price-rule-edit-actions">
                                                            {editingRuleId === item.id ? (
                                                                <>
                                                                    <button
                                                                        type="button"
                                                                        className="price-secondary-btn"
                                                                        onClick={cancelPriceEdit}
                                                                        disabled={priceSaving}
                                                                    >
                                                                        Cancel
                                                                    </button>

                                                                    <button
                                                                        type="button"
                                                                        className="price-primary-btn"
                                                                        onClick={() =>
                                                                            savePriceChanges(item)
                                                                        }
                                                                        disabled={priceSaving}
                                                                    >
                                                                        {priceSaving
                                                                            ? "Saving..."
                                                                            : "Save Prices"}
                                                                    </button>
                                                                </>
                                                            ) : (
                                                                <button
                                                                    type="button"
                                                                    className="price-row-btn"
                                                                    onClick={() => startPriceEdit(item)}
                                                                >
                                                                    Edit Prices
                                                                </button>
                                                            )}
                                                        </div>
                                                    </div>

                                                    {expanded && (
                                                        <PricingRuleDetails
                                                            item={item}
                                                            editing={editingRuleId === item.id}
                                                            draftConfig={draftConfig}
                                                            onDraftPriceChange={updateDraftPrice}
                                                            onDraftValueChange={updateDraftValue}
                                                        />
                                                    )}

                                                    {editingRuleId === item.id &&
                                                        priceSaveError && (
                                                            <div className="price-save-error">
                                                                {priceSaveError}
                                                            </div>
                                                        )}
                                                </article>
                                            );
                                        })}
                                    </div>
                                )}
                        </div>
                    </div>

                    <aside className="price-side-panel">
                        <section className="price-side-card">
                            <h3>Sale Control</h3>
                            <p>
                                Activate a discount for one or more services and choose how long it stays active.
                            </p>

                            <div className="price-sale-preview">
                                <span>Example</span>
                                <strong>15% OFF Rank Boost</strong>
                                <p>Applies to calculated base price before checkout.</p>
                            </div>
                            <button
                                type="button"
                                className="price-primary-btn price-full-btn"
                                onClick={() => openSaleModal()}
                            >
                                Create Sale
                            </button>
                        </section>

                        <section className="price-side-card">
                            <h3>Pricing Logic</h3>

                            <div className="price-rule-list">
                                <div>
                                    <strong>Rank Boost</strong>
                                    <span>Current rank → desired rank</span>
                                </div>

                                <div>
                                    <strong>Win Boost</strong>
                                    <span>Rank tier × number of wins</span>
                                </div>

                                <div>
                                    <strong>Placement</strong>
                                    <span>Peak rank × placement games</span>
                                </div>

                                <div>
                                    <strong>Add-ons</strong>
                                    <span>Priority, coaching, stream, privacy</span>
                                </div>
                            </div>
                        </section>
                    </aside>
                </section>
            </main>

            {saleModalOpen && (
                <div className="price-modal-backdrop" onClick={closeSaleModal}>
                    <section
                        className="price-modal"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <div className="price-modal-header">
                            <div>
                                <p className="admin-eyebrow">Sale Setup</p>
                                <h2>
                                    {selectedService
                                        ? `Edit ${selectedService.service?.title || "Service"}`
                                        : "Create Sale"}
                                </h2>
                                <p>
                                    Configure a temporary discount without changing the original pricing rules.
                                </p>
                            </div>

                            <button
                                type="button"
                                className="price-modal-close"
                                onClick={closeSaleModal}
                            >
                                ×
                            </button>
                        </div>

                        <div className="price-modal-grid">
                            <label className="price-modal-field">
                                <span>Service</span>
                                <select defaultValue={selectedService?.serviceId || ""}>
                                    <option value="">Select service</option>
                                    {pricingServices.map((service) => (
                                        <option key={service.serviceId} value={service.serviceId}>
                                            {service.service?.title || "Unknown Service"}
                                        </option>
                                    ))}
                                </select>
                            </label>

                            <label className="price-modal-field">
                                <span>Discount %</span>
                                <input type="number" min="1" max="90" placeholder="15" />
                            </label>

                            <label className="price-modal-field">
                                <span>Sale Start</span>
                                <input type="datetime-local" />
                            </label>

                            <label className="price-modal-field">
                                <span>Sale End</span>
                                <input type="datetime-local" />
                            </label>

                            <label className="price-modal-field price-modal-field-wide">
                                <span>Apply Discount To</span>
                                <select defaultValue="base">
                                    <option value="base">Base price only</option>
                                    <option value="total">Whole order total</option>
                                </select>
                            </label>
                        </div>

                        <div className="price-modal-note">
                            <strong>Safe behavior:</strong>
                            <span>
                                This sale will sit on top of the current dynamic calculator. It does not overwrite Rank Boost, Win Boost, Placement, or add-on pricing.
                            </span>
                        </div>

                        <div className="price-modal-actions">
                            <button
                                type="button"
                                className="price-secondary-btn"
                                onClick={closeSaleModal}
                            >
                                Cancel
                            </button>

                            <button
                                type="button"
                                className="price-primary-btn"
                                onClick={closeSaleModal}
                            >
                                Save Draft
                            </button>
                        </div>
                    </section>
                </div>
            )}
        </>
    );
}