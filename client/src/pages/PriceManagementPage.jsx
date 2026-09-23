import PersonalCouponFields from "../components/PersonalCouponFields";
import { authStorage } from "../utils/authStorage";
import { useEffect, useRef, useState } from "react";
import { SaleBanner } from "../components/SaleFooter";
import { API_BASE_URL } from "../api/config";
import "../styles/Admin.css";
import "../styles/PriceManagement.css";

function CampaignCard({ sale, now, onEnd }) {
    const status = getSaleDisplayStatus(sale, now);
    const serviceName = sale.scope === "GLOBAL" ? "All Services" : sale.serviceTitle || "Selected service";
    return <article className="price-campaign-card">
        <div className="price-sale-control-header">
            <span>{status === "SCHEDULED" ? "Scheduled Campaign" : status === "ACTIVE" ? "Live Campaign" : "Past Campaign"}</span>
            <span className={"price-global-status " + status.toLowerCase()}>{status}</span>
        </div>
        <div className="price-sale-preview">
            <strong>{sale.title}</strong>
            <p>{Number(sale.discountPercent)}% OFF — {serviceName}</p>
            {sale.couponCode && <p>Use code <code>{sale.couponCode}</code></p>}
        </div>
        <div className="price-sale-countdown">
            <span>{status === "SCHEDULED" ? "Starts in" : "Expires in"}</span>
            <strong>{formatTimeRemaining(status === "SCHEDULED" ? sale.startsAt : sale.endsAt, now)}</strong>
        </div>
        <div className="price-sale-meta"><span>Discount applies to</span><strong>Base price only</strong></div>
        <div className="price-sale-meta"><span>Ends</span><strong>{sale.endsAt ? new Date(sale.endsAt).toLocaleString() : "No expiration"}</strong></div>
        <div className="price-sale-meta"><span>Footer decoration</span><strong>{sale.footerDecoration ? "Enabled" : "Disabled"}</strong></div>
        <button type="button" className="price-secondary-btn price-full-btn price-end-sale-btn" onClick={() => onEnd({ sale, scope: sale.scope, serviceName })}>
            {sale.couponCode ? "Disable Coupon" : sale.scope === "GLOBAL" ? "End Global Sale" : "End Service Sale"}
        </button>
    </article>;
}

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

const rankTierOrder = [
    "Unranked",
    "Iron",
    "Bronze",
    "Silver",
    "Gold",
    "Platinum",
    "Emerald",
    "Diamond",
    "Master",
    "Grandmaster",
    "Challenger",
];

const rankDivisionOrder = ["IV", "III", "II", "I"];

function parseRankLabel(label) {
    if (typeof label !== "string") return null;

    const trimmed = label.trim();
    if (!trimmed) return null;

    const parts = trimmed.split(/\s+/);
    if (parts.length === 1) {
        return {
            tier: parts[0],
            division: null,
        };
    }

    return {
        tier: parts[0],
        division: parts[1],
    };
}

function isRankLabel(label) {
    const parsed = parseRankLabel(label);
    if (!parsed) return false;

    if (parsed.tier === "Unranked") return true;

    const hasTier = rankTierOrder.includes(parsed.tier);
    const hasDivision = parsed.division
        ? rankDivisionOrder.includes(parsed.division)
        : true;

    return hasTier && hasDivision;
}

function sortRankRows(rows) {
    if (!rows.some(([label]) => isRankLabel(label))) {
        return rows;
    }

    return [...rows].sort(([leftLabel], [rightLabel]) => {
        const left = parseRankLabel(leftLabel) || { tier: "", division: null };
        const right = parseRankLabel(rightLabel) || { tier: "", division: null };

        const tierDiff =
            (rankTierOrder.indexOf(left.tier) === -1
                ? Number.MAX_SAFE_INTEGER
                : rankTierOrder.indexOf(left.tier)) -
            (rankTierOrder.indexOf(right.tier) === -1
                ? Number.MAX_SAFE_INTEGER
                : rankTierOrder.indexOf(right.tier));

        if (tierDiff !== 0) return tierDiff;

        const leftDivisionIndex = left.division
            ? rankDivisionOrder.indexOf(left.division)
            : rankDivisionOrder.length;
        const rightDivisionIndex = right.division
            ? rankDivisionOrder.indexOf(right.division)
            : rankDivisionOrder.length;

        return leftDivisionIndex - rightDivisionIndex;
    });
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
    const rows = sortRankRows(Object.entries(entries || {}));

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

function AddonDetails({ addons, editing = false, onDraftValueChange }) {
    if (!addons) return null;

    const championPreferenceOrder = { "1": 0, "2-3": 1, "4+": 2 };

    const addonEntries = [
        { key: "duoModeMultiplier", label: "Duo Mode", value: addons.duoModeMultiplier, formatter: formatMultiplier },
        { key: "duoExtraPercent", label: "Duo Extra", value: addons.duoExtraPercent, formatter: formatPercent },
        { key: "expressPercent", label: "Express", value: addons.expressPercent, formatter: formatPercent },
        { key: "premiumCoachingPercent", label: "Premium Coaching", value: addons.premiumCoachingPercent, formatter: formatPercent },
        { key: "highMmrDuoPercent", label: "High MMR Duo", value: addons.highMmrDuoPercent, formatter: formatPercent },
        { key: "untrackableDuoPercent", label: "Untrackable Duo", value: addons.untrackableDuoPercent, formatter: formatPercent },
    ];

    return (
        <section className="price-detail-section">
            <div className="price-detail-section-header">
                <h4>Add-on Pricing</h4>
                <span>Shared modifiers</span>
            </div>

            <div className="price-addon-grid">
                {addonEntries
                    .filter(({ key }) => key !== "soloOnlyPercent")
                    .map(({ key, label, value, formatter }) => (
                        <div className="price-addon-item" key={key}>
                            <span>{label}</span>

                            {editing ? (
                                <div className="price-edit-input-wrap">
                                    <span>{key.includes("Multiplier") ? "×" : "%"}</span>
                                    <input
                                        type="number"
                                        min="0"
                                        step={key.includes("Multiplier") ? "0.01" : "0.01"}
                                        value={value}
                                        onChange={(event) =>
                                            onDraftValueChange?.("addons", key, event.target.value)
                                        }
                                    />
                                </div>
                            ) : (
                                <strong>{formatter(value)}</strong>
                            )}
                        </div>
                    ))}
            </div>

            {addons.championPreference && (
                <div className="price-detail-subsection">
                    <h5>Champion Preference</h5>

                    <div className="price-addon-grid">
                        {Object.entries(addons.championPreference)
                            .sort(([left], [right]) => (championPreferenceOrder[left] ?? 99) - (championPreferenceOrder[right] ?? 99))
                            .map(([label, value]) => (
                                <div className="price-addon-item" key={label}>
                                    <span>
                                        {label === "1"
                                            ? "1 champ"
                                            : label === "2-3"
                                                ? "2-3 champs"
                                                : "4+ champs"}
                                    </span>

                                    {editing ? (
                                        <div className="price-edit-input-wrap">
                                            <span>%</span>
                                            <input
                                                type="number"
                                                min="0"
                                                step="0.01"
                                                value={value}
                                                onChange={(event) =>
                                                    onDraftValueChange?.(
                                                        "addons",
                                                        "championPreference",
                                                        label,
                                                        event.target.value
                                                    )
                                                }
                                            />
                                        </div>
                                    ) : (
                                        <strong>{formatPercent(value)}</strong>
                                    )}
                                </div>
                            ))}
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
                                    {editing ? (
                                        <div className="price-edit-input-wrap">
                                            <span>$</span>
                                            <input
                                                type="number"
                                                min="0"
                                                step="0.01"
                                                value={config.masterLpPricing.first100LpPerLp}
                                                onChange={(event) =>
                                                    onDraftPriceChange(
                                                        "masterLpPricing",
                                                        "first100LpPerLp",
                                                        event.target.value
                                                    )
                                                }
                                            />
                                            <span>/ LP</span>
                                        </div>
                                    ) : (
                                        <strong>
                                            {formatMoney(
                                                config.masterLpPricing.first100LpPerLp
                                            )}{" "}
                                            / LP
                                        </strong>
                                    )}
                                </div>
                            )}

                            {config.masterLpPricing.above100LpPerLp != null && (
                                <div className="price-addon-item">
                                    <span>Above 100 LP</span>
                                    {editing ? (
                                        <div className="price-edit-input-wrap">
                                            <span>$</span>
                                            <input
                                                type="number"
                                                min="0"
                                                step="0.01"
                                                value={config.masterLpPricing.above100LpPerLp}
                                                onChange={(event) =>
                                                    onDraftPriceChange(
                                                        "masterLpPricing",
                                                        "above100LpPerLp",
                                                        event.target.value
                                                    )
                                                }
                                            />
                                            <span>/ LP</span>
                                        </div>
                                    ) : (
                                        <strong>
                                            {formatMoney(
                                                config.masterLpPricing.above100LpPerLp
                                            )}{" "}
                                            / LP
                                        </strong>
                                    )}
                                </div>
                            )}

                            {config.masterLpPricing.perLp != null && (
                                <div className="price-addon-item">
                                    <span>Master LP</span>
                                    {editing ? (
                                        <div className="price-edit-input-wrap">
                                            <span>$</span>
                                            <input
                                                type="number"
                                                min="0"
                                                step="0.01"
                                                value={config.masterLpPricing.perLp}
                                                onChange={(event) =>
                                                    onDraftPriceChange(
                                                        "masterLpPricing",
                                                        "perLp",
                                                        event.target.value
                                                    )
                                                }
                                            />
                                            <span>/ LP</span>
                                        </div>
                                    ) : (
                                        <strong>
                                            {formatMoney(config.masterLpPricing.perLp)} / LP
                                        </strong>
                                    )}
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

                <AddonDetails
                    addons={config.addons}
                    editing={editing}
                    onDraftValueChange={onDraftValueChange}
                />
            </div>
        );
    }

    if (item.pricingType === "PLACEMENT_BASED") {
        return (
            <div className="price-rule-details">
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

                <AddonDetails
                    addons={config.addons}
                    editing={editing}
                    onDraftValueChange={onDraftValueChange}
                />
            </div>
        );
    }

    if (item.pricingType === "PER_WIN") {
        return (
            <div className="price-rule-details">
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
                    editable={editing}
                    onValueChange={(key, value) =>
                        onDraftPriceChange(
                            "modifiers",
                            "lpGain",
                            key,
                            value
                        )
                    }
                />

                <AddonDetails
                    addons={config.addons}
                    editing={editing}
                    onDraftValueChange={onDraftValueChange}
                />
            </div>
        );
    }

    if (item.pricingType === "DUO_ADDON") {
        return (
            <div className="price-rule-details">
                <DetailTable
                    title="Source Win Prices"
                    entries={config.perWinPrices}
                    leftHeading="Current Rank"
                    rightHeading="Win Boost Price"
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
                    editable={editing}
                    onValueChange={(key, value) =>
                        onDraftPriceChange(
                            "modifiers",
                            "lpGain",
                            key,
                            value
                        )
                    }
                />

                <AddonDetails
                    addons={config.addons}
                    editing={editing}
                    onDraftValueChange={onDraftValueChange}
                />
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


function cloneConfig(config) {
    return JSON.parse(JSON.stringify(config || {}));
}

function valuesDiffer(oldValue, newValue) {
    const oldNumber = Number(oldValue);
    const newNumber = Number(newValue);

    if (Number.isFinite(oldNumber) && Number.isFinite(newNumber)) {
        return oldNumber !== newNumber;
    }

    return String(oldValue ?? "") !== String(newValue ?? "");
}

function collectPriceChanges(item, draftConfig) {
    const original = item?.config || {};
    const draft = draftConfig || {};
    const changes = [];

    const addMapChanges = (section, sectionLabel) => {
        const originalMap = original?.[section] || {};
        const draftMap = draft?.[section] || {};
        const keys = new Set([
            ...Object.keys(originalMap),
            ...Object.keys(draftMap),
        ]);

        for (const key of keys) {
            const oldValue = originalMap[key];
            const newValue = draftMap[key];

            if (!valuesDiffer(oldValue, newValue)) continue;

            changes.push({
                id: `${section}::${key}`,
                section,
                key,
                sectionLabel,
                label: key,
                oldValue,
                newValue,
                kind: "price",
            });
        }
    };

    const addNestedMapChanges = (section, mapKey, sectionLabel) => {
        const originalMap = original?.[section]?.[mapKey] || {};
        const draftMap = draft?.[section]?.[mapKey] || {};
        const keys = new Set([
            ...Object.keys(originalMap),
            ...Object.keys(draftMap),
        ]);

        for (const key of keys) {
            const oldValue = originalMap[key];
            const newValue = draftMap[key];

            if (!valuesDiffer(oldValue, newValue)) continue;

            changes.push({
                id: `${section}::${mapKey}::${key}`,
                section,
                mapKey,
                key,
                sectionLabel,
                label: key,
                oldValue,
                newValue,
                kind: "price",
            });
        }
    };

    if (item?.pricingType === "RANK_BASED") {
        addMapChanges("divisionStepPrices", "Division Step Price");
        addMapChanges("masterLpPricing", "Master LP Price");
    }

    if (item?.pricingType === "PLACEMENT_BASED") {
        addMapChanges("fullSetPrices", "Placement Price");
    }

    if (item?.pricingType === "PER_WIN") {
        addMapChanges("perWinPrices", "Per-Win Price");
        addNestedMapChanges("modifiers", "lpGain", "LP Gain Modifier");
    }

    if (item?.pricingType === "DUO_ADDON") {
        addMapChanges("perWinPrices", "Source Win Price");
        addNestedMapChanges("modifiers", "lpGain", "LP Gain Modifier");
    }

    if (
        item?.pricingType === "DUO_ADDON" &&
        valuesDiffer(original?.multiplier, draft?.multiplier)
    ) {
        changes.push({
            id: "root::multiplier",
            section: null,
            key: "multiplier",
            sectionLabel: "Pro Duo",
            label: "Base Multiplier",
            oldValue: original?.multiplier,
            newValue: draft?.multiplier,
            kind: "multiplier",
        });
    }

    return changes;
}

function applySelectedPriceChanges(originalConfig, changes, selectedIds) {
    const nextConfig = cloneConfig(originalConfig);

    for (const change of changes) {
        if (!selectedIds.has(change.id)) continue;

        const numericValue = Number(change.newValue);
        const safeValue = Number.isFinite(numericValue)
            ? numericValue
            : change.newValue;

        if (!change.section) {
            nextConfig[change.key] = safeValue;
            continue;
        }

        if (change.mapKey) {
            nextConfig[change.section] = {
                ...(nextConfig[change.section] || {}),
                [change.mapKey]: {
                    ...((nextConfig[change.section] || {})[change.mapKey] || {}),
                    [change.key]: safeValue,
                },
            };
            continue;
        }

        nextConfig[change.section] = {
            ...(nextConfig[change.section] || {}),
            [change.key]: safeValue,
        };
    }

    return nextConfig;
}

function formatChangeValue(change, value) {
    if (change?.kind === "multiplier") {
        const number = Number(value);
        return Number.isFinite(number) ? `×${number.toFixed(2)}` : String(value ?? "—");
    }

    return formatMoney(value);
}

const EMPTY_SALE_FORM = {
    title: "",
    discountPercent: "",
    startsAt: "",
    endsAt: "",
    appliesTo: "BASE_PRICE",
    saleMode: "WITHOUT_COUPON",
    couponCode: "",
    footerDecoration: false,
    footerTimer: true,
};

function getSaleDisplayStatus(sale, nowMs = Date.now()) {
    if (!sale || !sale.active) return "NONE";

    const startsAt = sale.startsAt
        ? new Date(sale.startsAt).getTime()
        : null;

    const endsAt = sale.endsAt
        ? new Date(sale.endsAt).getTime()
        : null;

    if (startsAt && startsAt > nowMs) {
        return "SCHEDULED";
    }

    if (endsAt && endsAt < nowMs) {
        return "EXPIRED";
    }

    return "ACTIVE";
}

function formatTimeRemaining(targetDate, nowMs = Date.now()) {
    if (!targetDate) return "No expiration";

    const difference =
        new Date(targetDate).getTime() - nowMs;

    if (difference <= 0) {
        return "Ending now";
    }

    const days = Math.floor(
        difference / (1000 * 60 * 60 * 24)
    );

    const hours = Math.floor(
        (difference / (1000 * 60 * 60)) % 24
    );

    const minutes = Math.floor(
        (difference / (1000 * 60)) % 60
    );

    if (days > 0) {
        return `${days}d ${hours}h ${minutes}m`;
    }

    if (hours > 0) {
        return `${hours}h ${minutes}m`;
    }

    return `${Math.max(minutes, 1)}m`;
}

export default function PriceManagementPage() {
    const [pricingServices, setPricingServices] = useState([]);
    const [pricesLoading, setPricesLoading] = useState(true);
    const [pricesError, setPricesError] = useState("");
    const [availabilitySaving, setAvailabilitySaving] = useState(null);
    const [availabilityError, setAvailabilityError] = useState("");
    const [pendingAvailability, setPendingAvailability] = useState(null);
    const availabilityDialog = useRef(null);

    useEffect(() => {
        if (!pendingAvailability) return;
        const previousFocus = document.activeElement;
        availabilityDialog.current?.querySelector("button")?.focus();
        return () => previousFocus?.focus();
    }, [pendingAvailability]);

    const closeAvailabilityConfirmation = () => {
        if (availabilitySaving) return;
        setPendingAvailability(null);
        setAvailabilityError("");
    };

    const confirmAvailability = async () => {
        if (availabilitySaving || !pendingAvailability) return;
        const item = pendingAvailability;
        setAvailabilitySaving(item.serviceId);
        setAvailabilityError("");
        try {
            const response = await fetch(`${API_BASE_URL}/admin/prices/rules/${item.id}/availability`, {
                method: "PATCH", headers: { "Content-Type": "application/json", Authorization: `Bearer ${authStorage.getItem("token")}` },
                body: JSON.stringify({ active: item.nextActive }),
            });
            const data = await response.json();
            if (!response.ok || !data.ok) throw new Error(data.message || "Could not update this service.");
            setPricingServices(items => items.map(rule => rule.serviceId === item.serviceId ? { ...rule, active: data.active } : rule));
            localStorage.removeItem("fastboost:services:v1");
            window.dispatchEvent(new Event("fastboost:services-updated"));
            setPendingAvailability(null);
        } catch (error) { setAvailabilityError(error.message); }
        finally { setAvailabilitySaving(null); }
    };

    const [editingRuleId, setEditingRuleId] = useState(null);
    const [draftConfig, setDraftConfig] = useState(null);
    const [priceSaving, setPriceSaving] = useState(false);
    const [priceSaveError, setPriceSaveError] = useState("");

    const [priceConfirmOpen, setPriceConfirmOpen] = useState(false);
    const [pendingPriceItem, setPendingPriceItem] = useState(null);
    const [pendingPriceChanges, setPendingPriceChanges] = useState([]);
    const [selectedPriceChangeIds, setSelectedPriceChangeIds] = useState(
        () => new Set()
    );

    const [saleModalOpen, setSaleModalOpen] = useState(false);
    const [selectedService, setSelectedService] = useState(null);

    const [globalSale, setGlobalSale] = useState(null);
    const [coupons, setCoupons] = useState([]);
    const [saleScope, setSaleScope] = useState("SERVICE");

    const [saleForm, setSaleForm] = useState(
        EMPTY_SALE_FORM
    );

    const [saleSaving, setSaleSaving] = useState(false);
    const [saleError, setSaleError] = useState("");
    const [saleConfirmOpen, setSaleConfirmOpen] = useState(false);
    const [saleConfirmType, setSaleConfirmType] = useState(null);
    const [pendingSaleAction, setPendingSaleAction] = useState(null);
    const [saleConfirmationChecked, setSaleConfirmationChecked] = useState(false);

    const [saleClock, setSaleClock] = useState(
        Date.now()
    );

    const [gameFilter, setGameFilter] = useState("LoL");
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
            const token = authStorage.getItem("token");

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
            setGlobalSale(data.globalSale || null);
            setCoupons(data.coupons || []);
        } catch (error) {
            setPricesError(error.message || "Failed to load price rules.");
        } finally {
            setPricesLoading(false);
        }
    };

    

    const startPriceEdit = (item) => {
        setEditingRuleId(item.id);
        setDraftConfig(cloneConfig(item.config));
        setPriceSaveError("");

        // Editing must always reveal the detailed board where the inputs live.
        setExpandedRuleIds((current) => {
            const next = new Set(current);
            next.add(item.id);
            return next;
        });
    };

    const cancelPriceEdit = () => {
        setEditingRuleId(null);
        setDraftConfig(null);
        setPriceSaveError("");
        setPriceConfirmOpen(false);
        setPendingPriceItem(null);
        setPendingPriceChanges([]);
        setSelectedPriceChangeIds(new Set());
    };

    const updateDraftPrice = (section, key, value, nestedKey) => {
        setDraftConfig((current) => {
            const next = cloneConfig(current);

            if (nestedKey !== undefined) {
                const parentMap = next?.[section] || {};
                const nestedMap = parentMap[key] || {};

                next[section] = {
                    ...parentMap,
                    [key]: {
                        ...nestedMap,
                        [nestedKey]: value,
                    },
                };

                return next;
            }

            next[section] = {
                ...(next?.[section] || {}),
                [key]: value,
            };

            return next;
        });
    };

    const updateDraftValue = (section, key, value, nestedKey) => {
        if (section === "addons" && nestedKey !== undefined) {
            setDraftConfig((current) => {
                const next = cloneConfig(current);
                const addons = next?.addons || {};

                if (key === "championPreference") {
                    const currentTierPrefs = addons.championPreference || {};
                    next.addons = {
                        ...addons,
                        championPreference: {
                            ...currentTierPrefs,
                            [value]: Number(nestedKey),
                        },
                    };
                    return next;
                }

                next.addons = {
                    ...addons,
                    [key]: Number.isFinite(Number(value)) ? Number(value) : value,
                };

                return next;
            });
            return;
        }

        setDraftConfig((current) => {
            const next = cloneConfig(current);
            next[section] = {
                ...(next?.[section] || {}),
                [key]: Number.isFinite(Number(value)) ? Number(value) : value,
            };
            return next;
        });
    };

    const openPriceConfirmation = (item) => {
        const changes = collectPriceChanges(item, draftConfig);

        if (changes.length === 0) {
            setPriceSaveError("No price changes to save.");
            return;
        }

        setPendingPriceItem(item);
        setPendingPriceChanges(changes);
        setSelectedPriceChangeIds(new Set());
        setPriceSaveError("");
        setPriceConfirmOpen(true);
    };

    const closePriceConfirmation = () => {
        if (priceSaving) return;

        setPriceConfirmOpen(false);
        setPendingPriceItem(null);
        setPendingPriceChanges([]);
        setSelectedPriceChangeIds(new Set());
    };

    const togglePriceChange = (changeId) => {
        setSelectedPriceChangeIds((current) => {
            const next = new Set(current);

            if (next.has(changeId)) {
                next.delete(changeId);
            } else {
                next.add(changeId);
            }

            return next;
        });
    };

    const toggleAllPriceChanges = () => {
        setSelectedPriceChangeIds((current) => {
            const allSelected =
                pendingPriceChanges.length > 0 &&
                pendingPriceChanges.every((change) => current.has(change.id));

            if (allSelected) {
                return new Set();
            }

            return new Set(pendingPriceChanges.map((change) => change.id));
        });
    };

    const savePriceChanges = async () => {
        const item = pendingPriceItem;

        if (!item) return;

        if (selectedPriceChangeIds.size === 0) {
            return;
        }

        try {
            setPriceSaving(true);
            setPriceSaveError("");

            const token = authStorage.getItem("token");

            // Start from the original config and apply ONLY the checked changes.
            // Unchecked edits are intentionally discarded.
            const selectedConfig = applySelectedPriceChanges(
                item.config,
                pendingPriceChanges,
                selectedPriceChangeIds
            );

            const response = await fetch(
                `${API_BASE_URL}/admin/prices/rules/${item.id}`,
                {
                    method: "PATCH",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${token}`,
                    },
                    body: JSON.stringify({
                        config: selectedConfig,
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

            setPriceConfirmOpen(false);
            setPendingPriceItem(null);
            setPendingPriceChanges([]);
            setSelectedPriceChangeIds(new Set());
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

    useEffect(() => {
        const timer = window.setInterval(() => {
            setSaleClock(Date.now());
        }, 60000);

        return () => {
            window.clearInterval(timer);
        };
    }, []);

    const openSaleModal = (
        service = null,
        scope = "SERVICE",
        personalCoupon = false
    ) => {
        setSelectedService(service);
        setSaleScope(scope);

        setSaleForm({
            ...EMPTY_SALE_FORM,
            personalCoupon,
            recipientEmail: "",
            recipientAccountId: "",
            recipients: [],
            couponServiceIds: [],
            personalReason: "MANUAL",
            ...(personalCoupon ? { saleMode: "WITH_COUPON" } : {}),
        });

        setSaleError("");
        setSaleModalOpen(true);
    };

    const closeSaleModal = () => {
        if (saleSaving) return;

        setSaleModalOpen(false);
        setSelectedService(null);
        setSaleScope("SERVICE");

        setSaleForm({
            ...EMPTY_SALE_FORM,
        });

        setSaleError("");
    };

    const requestCreateSale = () => {
        try {
            setSaleError("");

            const discount = Number(saleForm.discountPercent);

            if (saleForm.personalCoupon && !saleForm.recipients?.length) throw new Error("Select an account from the search results.");

            if (!Number.isFinite(discount) || discount <= 0 || discount > 90) {
                throw new Error("Discount must be between 1 and 90.");
            }

            if (
                saleForm.startsAt &&
                saleForm.endsAt &&
                new Date(saleForm.endsAt) <= new Date(saleForm.startsAt)
            ) {
                throw new Error("Sale end must be after sale start.");
            }

            if (saleScope === "SERVICE" && !selectedService?.serviceId) {
                throw new Error("No service was selected.");
            }

            {
                if (saleForm.saleMode === "WITHOUT_COUPON" && !saleForm.endsAt) throw new Error("Set Sale End for a sale without a coupon.");
                if (saleScope === "GLOBAL" && saleForm.saleMode === "WITHOUT_COUPON" && hasCurrentGlobalSale) throw new Error("End the existing global sale first, or choose With coupon.");
                if (saleForm.saleMode === "WITH_COUPON" && !/^[A-Z0-9][A-Z0-9-]{3,31}$/.test(saleForm.couponCode.trim().toUpperCase())) throw new Error("Enter or generate a coupon code of 4–32 letters, numbers or hyphens.");
            }
            const pending = {
                personalCoupon: Boolean(saleForm.personalCoupon),
                recipientEmail: saleForm.recipientEmail?.trim() || "",
                recipientAccountId: saleForm.recipients?.[0]?.id,
                recipientAccountIds: saleForm.recipients?.map(account => account.id),
                recipientNames: saleForm.recipients?.map(account => account.username || account.profile?.displayName || account.email).join(", "),
                couponServiceIds: saleForm.couponServiceIds || [],
                personalReason: saleForm.personalReason || "MANUAL",
                type: "CREATE",
                scope: saleForm.personalCoupon ? (saleForm.couponServiceIds?.length ? "SERVICE" : "GLOBAL") : saleScope,
                serviceId: saleForm.personalCoupon ? (saleForm.couponServiceIds?.[0] || null) :
                    saleScope === "SERVICE"
                        ? selectedService.serviceId
                        : null,
                serviceName: saleForm.personalCoupon && saleForm.couponServiceIds?.length ? saleForm.couponServiceIds.map(id => pricingServices.find(item => item.serviceId === id)?.service?.title || "Service").join(", ") :
                    saleScope === "SERVICE"
                        ? selectedService?.service?.title || "Service"
                        : "All FastBoost Services",
                title:
                    saleForm.title.trim() || (saleForm.personalCoupon ? `${discount}% personal coupon` : "") ||
                    (saleScope === "GLOBAL"
                        ? `${discount}% off all services`
                        : `${discount}% off ${selectedService?.service?.title || "Service"}`),
                discountPercent: discount,
                appliesTo: "BASE_PRICE",
                saleMode: saleForm.saleMode,
                couponCode: saleForm.saleMode === "WITH_COUPON" ? saleForm.couponCode.trim().toUpperCase() : null,
                footerDecoration: saleForm.footerDecoration,
                footerTimer: saleForm.footerTimer,
                startsAt: saleForm.startsAt || null,
                endsAt: saleForm.endsAt || null,
            };

            setPendingSaleAction(pending);
            setSaleConfirmType("CREATE");
            setSaleConfirmationChecked(false);
            setSaleModalOpen(false);
            setSaleConfirmOpen(true);
        } catch (error) {
            setSaleError(error.message || "Failed to create sale.");
        }
    };

    const confirmCreateSale = async () => {
        if (
            !pendingSaleAction ||
            pendingSaleAction.type !== "CREATE" ||
            !saleConfirmationChecked
        ) {
            return;
        }

        try {
            setSaleSaving(true);
            setSaleError("");

            const token = authStorage.getItem("token");
            const response = await fetch(
                `${API_BASE_URL}/admin/prices/sales`,
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${token}`,
                    },
                    body: JSON.stringify({
                        personalCoupon: pendingSaleAction.personalCoupon,
                        recipientEmail: pendingSaleAction.recipientEmail,
                        recipientAccountId: pendingSaleAction.recipientAccountId,
                        recipientAccountIds: pendingSaleAction.personalCoupon ? pendingSaleAction.recipientAccountIds : undefined,
                        couponServiceIds: pendingSaleAction.couponServiceIds,
                        personalReason: pendingSaleAction.personalReason,
                        scope: pendingSaleAction.scope,
                        serviceId: pendingSaleAction.serviceId,
                        title: pendingSaleAction.title,
                        discountPercent: pendingSaleAction.discountPercent,
                        appliesTo: pendingSaleAction.appliesTo,
                        saleMode: pendingSaleAction.saleMode,
                        couponCode: pendingSaleAction.couponCode,
                        footerDecoration: pendingSaleAction.footerDecoration,
                        footerTimer: pendingSaleAction.footerTimer,
                        startsAt: pendingSaleAction.startsAt
                            ? new Date(pendingSaleAction.startsAt).toISOString()
                            : null,
                        endsAt: pendingSaleAction.endsAt
                            ? new Date(pendingSaleAction.endsAt).toISOString()
                            : null,
                    }),
                }
            );

            const data = await response.json();

            if (!response.ok || data.ok === false) {
                throw new Error(data.message || "Failed to create sale.");
            }

            await loadPricingRules();
            setSaleConfirmOpen(false);
            setPendingSaleAction(null);
            setSaleConfirmType(null);
            setSaleConfirmationChecked(false);
            setSelectedService(null);
            setSaleScope("SERVICE");
            setSaleForm({ ...EMPTY_SALE_FORM });
        } catch (error) {
            setSaleError(error.message || "Failed to create sale.");
        } finally {
            setSaleSaving(false);
        }
    };

    const requestEndSale = ({ sale, scope, serviceName }) => {
        if (!sale?.id) return;

        setSaleError("");
        setPendingSaleAction({
            type: "END",
            saleId: sale.id,
            scope,
            serviceName:
                serviceName ||
                (scope === "GLOBAL" ? "All FastBoost Services" : "Service"),
            title: sale.title || `${Number(sale.discountPercent).toFixed(0)}% OFF`,
            discountPercent: Number(sale.discountPercent),
            appliesTo: sale.appliesTo,
            couponCode: sale.couponCode,
            footerDecoration: sale.footerDecoration,
            footerTimer: sale.footerTimer,
            startsAt: sale.startsAt || null,
            endsAt: sale.endsAt || null,
        });
        setSaleConfirmType("END");
        setSaleConfirmationChecked(false);
        setSaleConfirmOpen(true);
    };

    const confirmEndSale = async () => {
        if (
            !pendingSaleAction ||
            pendingSaleAction.type !== "END" ||
            !saleConfirmationChecked
        ) {
            return;
        }

        try {
            setSaleSaving(true);
            setSaleError("");

            const token = authStorage.getItem("token");
            const response = await fetch(
                `${API_BASE_URL}/admin/prices/sales/${pendingSaleAction.saleId}/disable`,
                {
                    method: "PATCH",
                    headers: {
                        Authorization: `Bearer ${token}`,
                    },
                }
            );
            const data = await response.json();

            if (!response.ok || data.ok === false) {
                throw new Error(data.message || "Failed to end sale.");
            }

            await loadPricingRules();
            setSaleConfirmOpen(false);
            setPendingSaleAction(null);
            setSaleConfirmType(null);
            setSaleConfirmationChecked(false);
        } catch (error) {
            setSaleError(error.message || "Failed to end sale.");
        } finally {
            setSaleSaving(false);
        }
    };

    const closeSaleConfirmation = () => {
        if (saleSaving) return;

        setSaleConfirmOpen(false);
        setSaleConfirmType(null);
        setPendingSaleAction(null);
        setSaleConfirmationChecked(false);
        setSaleError("");
    };

    const backToSaleSetup = () => {
        if (saleSaving) return;

        setSaleConfirmOpen(false);
        setPendingSaleAction(null);
        setSaleConfirmType(null);
        setSaleConfirmationChecked(false);
        setSaleModalOpen(true);
    };

    const publicCampaigns = [...new Map([
        ...(globalSale ? [{ ...globalSale, scope: "GLOBAL" }] : []),
        ...pricingServices.filter(item => item.sale).map(item => ({ ...item.sale, scope: "SERVICE", serviceTitle: item.service?.title })),
        ...coupons.filter(coupon => !coupon.recipientAccountId),
    ].map(sale => [sale.id, sale])).values()];
    const globalSaleStatus = getSaleDisplayStatus(globalSale, saleClock);
    const hasCurrentGlobalSale =
        globalSaleStatus === "ACTIVE" || globalSaleStatus === "SCHEDULED";

    const activeServices = pricingServices.filter((item) => item.active).length;
    const activeSales =
        pricingServices.filter((item) => item.sale?.status === "ACTIVE").length +
        (globalSaleStatus === "ACTIVE" ? 1 : 0) + coupons.filter(coupon => getSaleDisplayStatus(coupon, saleClock) === "ACTIVE").length;
    const upcomingSales =
        pricingServices.filter((item) => item.sale?.status === "SCHEDULED").length +
        (globalSaleStatus === "SCHEDULED" ? 1 : 0) + coupons.filter(coupon => getSaleDisplayStatus(coupon, saleClock) === "SCHEDULED").length;

    const filteredPricingServices = pricingServices.filter((item) => {
        const matchesGame =
            item.game === gameFilter;

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

            <section className="price-management-page">
                <h1 className="admin-order-title price-management-title">Price Management</h1>

                <section className="price-stats-grid">
                    <article className="price-stat-card">
                        <span className="price-stat-icon">🧾</span>
                        <div>
                            <p>Pricing Rules</p>
                            <strong>{pricingServices.length}</strong>
                        </div>
                    </article>

                    <article className="price-stat-card">
                        <span className="price-stat-icon">✅</span>
                        <div>
                            <p>Active Services</p>
                            <strong>{activeServices}</strong>
                        </div>
                    </article>

                    <article className="price-stat-card">
                        <span className="price-stat-icon">🏷️</span>
                        <div>
                            <p>Active Sales</p>
                            <strong>{activeSales}</strong>
                        </div>
                    </article>

                    <article className="price-stat-card">
                        <span className="price-stat-icon">⏱️</span>
                        <div>
                            <p>Upcoming Sales</p>
                            <strong>{upcomingSales}</strong>
                        </div>
                    </article>
                </section>

                <section className="price-layout">
                    <div className="price-main-panel">
                        <div className="price-toolbar">
                            <div className="price-tabs">
                                <button
                                    type="button"
                                    className={`price-tab ${gameFilter === "LoL" ? "price-tab-active" : ""}`}
                                    aria-pressed={gameFilter === "LoL"}
                                    onClick={() => setGameFilter("LoL")}
                                >
                                    League of Legends
                                </button>

                                <button
                                    type="button"
                                    className={`price-tab ${gameFilter === "TFT" ? "price-tab-active" : ""}`}
                                    aria-pressed={gameFilter === "TFT"}
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

                        <>
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
                                                    className={`price-rule-card ${!item.active ? "price-rule-card-inactive" : ""} ${expanded ? "price-rule-card-expanded" : ""
                                                        }`}
                                                >
                                                    <div className="price-rule-card-main">
                                                        <div className="price-rule-card-info">
                                                            <div className="price-rule-card-title-row">
                                                                <h3>
                                                                    {item.service?.title ||
                                                                        "Unknown Service"}
                                                                </h3>

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

                                                            <button type="button" role="switch" aria-checked={item.active}
                                                                aria-label={`${item.service?.title || "Service"} availability`}
                                                                className={`price-availability-toggle ${item.active ? "is-active" : "is-inactive"}`}
                                                                disabled={Boolean(availabilitySaving)} onClick={() => { setAvailabilityError(""); setPendingAvailability({ ...item, nextActive: !item.active }); }}>
                                                                <span className="price-availability-track" aria-hidden="true"><span /></span>
                                                                {availabilitySaving === item.serviceId ? "Saving…" : item.active ? "Activated" : "Deactivated"}
                                                            </button>
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
                                                            onClick={() =>
                                                                openSaleModal(item, "SERVICE")
                                                            }
                                                        >
                                                            Create Sale
                                                        </button>

                                                        {item.sale && (
                                                            <button
                                                                type="button"
                                                                className="price-row-btn price-end-sale-row-btn"
                                                                onClick={() =>
                                                                    requestEndSale({
                                                                        sale: item.sale,
                                                                        scope: "SERVICE",
                                                                        serviceName:
                                                                            item.service?.title ||
                                                                            "Service",
                                                                    })
                                                                }
                                                            >
                                                                End Sale
                                                            </button>
                                                        )}

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
                                                                            openPriceConfirmation(item)
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
                        </>
                    </div>

                    <aside className="price-side-panel">
                        <section className="price-side-card price-global-create-card">
                            <h3>Create Global Sale</h3>

                            <p>
                                Apply a temporary discount across all FastBoost services.
                            </p>

                            <button
                                type="button"
                                className="price-primary-btn price-full-btn"
                                onClick={() => openSaleModal(null, "GLOBAL")}

                            >
                                Create Global Sale
                            </button>
                        </section>

                        <section className="price-side-card">
                            <h3>Sale Control</h3>
                            {!publicCampaigns.length && <p className="price-sale-empty-text">No sale created yet.</p>}
                            {publicCampaigns.map(sale => <CampaignCard key={sale.id} sale={sale} now={saleClock} onEnd={requestEndSale} />)}
                        </section>
                        <section className="price-side-card">
                            <h3>Create Personal Coupon</h3>
                            <p>Create a personal coupon for an individual account.</p>
                            <button type="button" className="price-primary-btn price-full-btn" onClick={() => openSaleModal(null, "GLOBAL", true)}>Create Personal Coupon</button>
                        </section>
                        <section className="price-side-card">
                            <h3>Personal Coupons</h3>
                            <p>Birthday and account anniversary coupons will be automated later.</p>
                            {!coupons.some(coupon => coupon.recipientAccountId) && <p className="price-sale-empty-copy">No personal coupons created yet.</p>}
                            {coupons.filter(coupon => coupon.recipientAccountId).map(coupon => <div className="price-sale-preview" key={coupon.id}>
                                <strong>{coupon.title}</strong>
                                <p><code>{coupon.couponCode}</code></p>
                                <p>{coupon.recipientAccountIds?.length > 1 ? `${coupon.recipientAccountIds.length} selected accounts` : coupon.recipientAccount?.email}</p>
                                <p>{coupon.couponServiceIds?.length ? coupon.couponServiceIds.map(id => pricingServices.find(item => item.serviceId === id)?.service?.title || "Service").join(", ") : coupon.scope === "GLOBAL" ? "All services" : coupon.serviceTitle}</p>
                                <p>{coupon.personalReason === "NEGOTIATED" ? "Negotiated" : "Manual"} · {Number(coupon.discountPercent)}% off base price · {getSaleDisplayStatus(coupon, saleClock)}</p>
                                <p>{coupon.startsAt ? new Date(coupon.startsAt).toLocaleString() : "Immediately"} → {coupon.endsAt ? new Date(coupon.endsAt).toLocaleString() : "No expiration"}</p>
                                <button type="button" className="price-secondary-btn" onClick={() => requestEndSale({ sale: coupon, scope: coupon.scope, serviceName: coupon.recipientAccount?.email || "Selected account" })}>Disable Coupon</button>
                            </div>)}
                        </section>
                    </aside>
                </section>
            </section>

            {pendingAvailability && (
                <div className="price-modal-backdrop" onClick={closeAvailabilityConfirmation}>
                    <section className="price-modal" ref={availabilityDialog} role="dialog" aria-modal="true" aria-labelledby="availability-confirm-title" aria-describedby="availability-confirm-description"
                        onClick={event => event.stopPropagation()}
                        onKeyDown={event => {
                            if (event.key === "Escape") { event.preventDefault(); closeAvailabilityConfirmation(); }
                            if (event.key !== "Tab") return;
                            const buttons = [...event.currentTarget.querySelectorAll("button:not(:disabled)")];
                            const first = buttons[0]; const last = buttons[buttons.length - 1];
                            if (!first) { event.preventDefault(); return; }
                            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
                            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
                        }}>
                        <div className="price-modal-header">
                            <div>
                                <p className="admin-eyebrow">Confirm Service Availability</p>
                                <h2 id="availability-confirm-title">{pendingAvailability.nextActive ? "Activate" : "Deactivate"} {pendingAvailability.service?.title || "service"}?</h2>
                                <p id="availability-confirm-description">{pendingAvailability.nextActive
                                    ? "Customers will be able to select this service and place new orders again."
                                    : "This service will be greyed out for customers and unavailable for new orders. Existing paid orders will remain accessible."}</p>
                            </div>
                            <button type="button" className="price-modal-close" aria-label="Close confirmation" disabled={Boolean(availabilitySaving)} onClick={closeAvailabilityConfirmation}>×</button>
                        </div>
                        {availabilityError && <p role="alert" className="price-save-error">{availabilityError}</p>}
                        <div className="price-modal-actions">
                            <button type="button" className="price-secondary-btn" disabled={Boolean(availabilitySaving)} onClick={closeAvailabilityConfirmation}>Cancel</button>
                            <button type="button" className="price-primary-btn" disabled={Boolean(availabilitySaving)} onClick={confirmAvailability}>{availabilitySaving ? "Saving…" : pendingAvailability.nextActive ? "Confirm Activation" : "Confirm Deactivation"}</button>
                        </div>
                    </section>
                </div>
            )}

            {priceConfirmOpen && pendingPriceItem && (
                <div
                    className="price-modal-backdrop"
                    onClick={closePriceConfirmation}
                >
                    <section
                        className="price-modal price-change-confirm-modal"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <div className="price-modal-header">
                            <div>
                                <p className="admin-eyebrow">Confirm Price Changes</p>
                                <h2>
                                    Review {pendingPriceItem.service?.title || "Service"}
                                </h2>
                                <p>
                                    Only checked changes will be saved. Unchecked changes
                                    will keep their current production values.
                                </p>
                            </div>

                            <button
                                type="button"
                                className="price-modal-close"
                                onClick={closePriceConfirmation}
                                disabled={priceSaving}
                            >
                                ×
                            </button>
                        </div>

                        <div className="price-change-confirm-toolbar">
                            <label className="price-change-check-all">
                                <input
                                    type="checkbox"
                                    checked={
                                        pendingPriceChanges.length > 0 &&
                                        pendingPriceChanges.every((change) =>
                                            selectedPriceChangeIds.has(change.id)
                                        )
                                    }
                                    onChange={toggleAllPriceChanges}
                                    disabled={priceSaving}
                                />
                                <span>Check All</span>
                            </label>

                            <span className="price-change-selected-count">
                                {selectedPriceChangeIds.size} of {pendingPriceChanges.length} selected
                            </span>
                        </div>

                        <div className="price-change-list">
                            {pendingPriceChanges.map((change) => {
                                const checked = selectedPriceChangeIds.has(change.id);

                                return (
                                    <label
                                        className={`price-change-row ${checked ? "price-change-row-selected" : ""}`}
                                        key={change.id}
                                    >
                                        <input
                                            type="checkbox"
                                            checked={checked}
                                            onChange={() => togglePriceChange(change.id)}
                                            disabled={priceSaving}
                                        />

                                        <div className="price-change-copy">
                                            <span className="price-change-section">
                                                {change.sectionLabel}
                                            </span>
                                            <strong>{change.label}</strong>
                                        </div>

                                        <div className="price-change-values">
                                            <span className="price-change-old">
                                                {formatChangeValue(change, change.oldValue)}
                                            </span>
                                            <span className="price-change-arrow">→</span>
                                            <span className="price-change-new">
                                                {formatChangeValue(change, change.newValue)}
                                            </span>
                                        </div>
                                    </label>
                                );
                            })}
                        </div>

                        {priceSaveError && (
                            <div className="price-save-error price-confirm-error">
                                {priceSaveError}
                            </div>
                        )}

                        <div className="price-modal-actions">
                            <button
                                type="button"
                                className="price-secondary-btn"
                                onClick={closePriceConfirmation}
                                disabled={priceSaving}
                            >
                                Back to Editing
                            </button>

                            <button
                                type="button"
                                className="price-primary-btn"
                                onClick={savePriceChanges}
                                disabled={
                                    priceSaving || selectedPriceChangeIds.size === 0
                                }
                            >
                                {priceSaving
                                    ? "Applying Changes..."
                                    : `Apply ${selectedPriceChangeIds.size} Selected Change${selectedPriceChangeIds.size === 1 ? "" : "s"
                                    }`}
                            </button>
                        </div>
                    </section>
                </div>
            )}

            {saleConfirmOpen && pendingSaleAction && (
                <div
                    className="price-modal-backdrop"
                    onClick={
                        saleConfirmType === "CREATE"
                            ? backToSaleSetup
                            : closeSaleConfirmation
                    }
                >
                    <section
                        className="price-modal price-change-confirm-modal"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <div className="price-modal-header">
                            <div>
                                <p className="admin-eyebrow">
                                    {saleConfirmType === "CREATE"
                                        ? "Confirm Sale Creation"
                                        : "Confirm Sale Cancellation"}
                                </p>
                                <h2>
                                    {saleConfirmType === "CREATE"
                                        ? "Review Sale Before Activation"
                                        : "Review Sale Before Ending"}
                                </h2>
                                <p>
                                    {saleConfirmType === "CREATE"
                                        ? "Review every setting below. Nothing will be changed until you explicitly confirm."
                                        : "Ending this sale will remove its discount from future price calculations."}
                                </p>
                            </div>

                            <button
                                type="button"
                                className="price-modal-close"
                                onClick={
                                    saleConfirmType === "CREATE"
                                        ? backToSaleSetup
                                        : closeSaleConfirmation
                                }
                                disabled={saleSaving}
                            >
                                ×
                            </button>
                        </div>

                        <div
                            className={`price-sale-critical-banner ${saleConfirmType === "END" ? "danger" : ""}`}
                        >
                            <span>
                                {saleConfirmType === "CREATE"
                                    ? "SALE WILL BE CREATED"
                                    : "SALE WILL BE ENDED"}
                            </span>
                            <strong>{pendingSaleAction.title}</strong>
                        </div>

                        <div className="price-sale-confirm-list">
                            {pendingSaleAction.personalCoupon && <>
                                <div className="price-sale-confirm-row"><span>Selected accounts</span><strong>{pendingSaleAction.recipientNames}</strong></div>
                                <div className="price-sale-confirm-row"><span>Reason</span><strong>{pendingSaleAction.personalReason === "NEGOTIATED" ? "Negotiated" : "Manual"}</strong></div>
                            </>}
                            <div className="price-sale-confirm-row">
                                <span>Action</span>
                                <strong>
                                    {saleConfirmType === "CREATE"
                                        ? "Create sale"
                                        : "End existing sale"}
                                </strong>
                            </div>
                            <div className="price-sale-confirm-row">
                                <span>Scope</span>
                                <strong>
                                    {pendingSaleAction.scope === "GLOBAL"
                                        ? "Global - All Services"
                                        : `Service - ${pendingSaleAction.serviceName}`}
                                </strong>
                            </div>
                            <div className="price-sale-confirm-row">
                                <span>Sale Title</span>
                                <strong>{pendingSaleAction.title}</strong>
                            </div>
                            <div className="price-sale-confirm-row">
                                <span>Discount</span>
                                <strong>
                                    {Number(pendingSaleAction.discountPercent).toFixed(0)}% OFF
                                </strong>
                            </div>
                            <div className="price-sale-confirm-row">
                                <span>Discount Applies To</span>
                                <strong>
                                    {String(pendingSaleAction.appliesTo).toUpperCase() === "TOTAL"
                                        ? "Whole order total"
                                        : "Base price only"}
                                </strong>
                            </div>
                            <>
                                <div className="price-sale-confirm-row"><span>Sale Type</span><strong>{pendingSaleAction.couponCode ? "With coupon" : "Without coupon"}</strong></div>
                                {pendingSaleAction.couponCode && <div className="price-sale-confirm-row"><span>Coupon</span><strong>{pendingSaleAction.couponCode}</strong></div>}
                                {!pendingSaleAction.personalCoupon && <div className="price-sale-confirm-row"><span>Footer decoration</span><strong>{pendingSaleAction.footerDecoration ? "Yes" : "No"}</strong></div>}
                                {pendingSaleAction.footerDecoration && <div className="price-sale-confirm-row"><span>Countdown timer</span><strong>{pendingSaleAction.footerTimer !== false && pendingSaleAction.endsAt ? "Yes" : "No"}</strong></div>}
                            </>
                            <div className="price-sale-confirm-row">
                                <span>Starts</span>
                                <strong>
                                    {pendingSaleAction.startsAt
                                        ? new Date(pendingSaleAction.startsAt).toLocaleString()
                                        : "Immediately"}
                                </strong>
                            </div>
                            <div className="price-sale-confirm-row">
                                <span>Ends</span>
                                <strong>
                                    {pendingSaleAction.endsAt
                                        ? new Date(pendingSaleAction.endsAt).toLocaleString()
                                        : "No expiration"}
                                </strong>
                            </div>
                        </div>

                        <label
                            className={`price-sale-critical-check ${saleConfirmationChecked ? "checked" : ""}`}
                        >
                            <input
                                type="checkbox"
                                checked={saleConfirmationChecked}
                                onChange={(event) =>
                                    setSaleConfirmationChecked(event.target.checked)
                                }
                                disabled={saleSaving}
                            />
                            <div>
                                <strong>I have reviewed these changes</strong>
                                <span>
                                    {saleConfirmType === "CREATE"
                                        ? "I confirm that this sale should be created with exactly the settings shown above."
                                        : "I understand that this sale will stop applying to future orders."}
                                </span>
                            </div>
                        </label>

                        {saleError && (
                            <div className="price-save-error price-confirm-error">
                                {saleError}
                            </div>
                        )}

                        <div className="price-modal-actions">
                            <button
                                type="button"
                                className="price-secondary-btn"
                                onClick={
                                    saleConfirmType === "CREATE"
                                        ? backToSaleSetup
                                        : closeSaleConfirmation
                                }
                                disabled={saleSaving}
                            >
                                {saleConfirmType === "CREATE"
                                    ? "Back to Sale Setup"
                                    : "Keep Sale Active"}
                            </button>

                            <button
                                type="button"
                                className={saleConfirmType === "END" ? "price-danger-btn" : "price-primary-btn"}
                                onClick={
                                    saleConfirmType === "CREATE"
                                        ? confirmCreateSale
                                        : confirmEndSale
                                }
                                disabled={saleSaving || !saleConfirmationChecked}
                            >
                                {saleSaving
                                    ? saleConfirmType === "CREATE"
                                        ? "Creating Sale..."
                                        : "Ending Sale..."
                                    : saleConfirmType === "CREATE"
                                        ? "Confirm & Create Sale"
                                        : "Confirm & End Sale"}
                            </button>
                        </div>
                    </section>
                </div>
            )}

            {saleModalOpen && (
                <div
                    className="price-modal-backdrop"
                    onClick={closeSaleModal}
                >
                    <section
                        className="price-modal"
                        onClick={(event) =>
                            event.stopPropagation()
                        }
                    >
                        <div className="price-modal-header">
                            <div>
                                <p className="admin-eyebrow">
                                    {saleForm.personalCoupon ? "Personal Coupon" : saleScope === "GLOBAL"
                                        ? "Global Campaign"
                                        : "Service Campaign"}
                                </p>

                                <h2>
                                    {saleForm.personalCoupon ? "Create Personal Coupon" : saleScope === "GLOBAL"
                                        ? "Create Global Sale"
                                        : `Create ${selectedService?.service?.title || "Service"} Sale`}
                                </h2>

                                <p>
                                    {saleForm.personalCoupon ? "Each selected account can redeem this coupon once." : saleScope === "GLOBAL"
                                        ? "Apply one temporary discount across every FastBoost service."
                                        : `This discount applies only to ${selectedService?.service?.title || "this service"}.`}
                                </p>
                            </div>

                            <button
                                type="button"
                                className="price-modal-close"
                                onClick={closeSaleModal}
                                disabled={saleSaving}
                            >
                                ×
                            </button>
                        </div>

                        {saleForm.personalCoupon ? <PersonalCouponFields form={saleForm} setForm={setSaleForm} services={pricingServices} /> : <div className="price-sale-scope-preview">
                            <span>Sale Scope</span>
                            <strong>
                                {saleScope === "GLOBAL"
                                    ? "🌐 All FastBoost Services"
                                    : `🎯 ${selectedService?.service?.title || "Selected Service"} Only`}
                            </strong>
                        </div>}

                        <div className="price-modal-grid">
                            {saleForm.personalCoupon && <>
                                <label className="price-modal-field price-modal-field-wide"><span>Reason</span><select value={saleForm.personalReason} onChange={event => setSaleForm(current => ({ ...current, personalReason: event.target.value }))}><option value="MANUAL">Manual gift</option><option value="NEGOTIATED">Negotiated discount</option></select></label>
                            </>}
                            <label className="price-modal-field price-modal-field-wide">
                                <span>Sale Title</span>
                                <input
                                    type="text"
                                    placeholder={saleScope === "GLOBAL"
                                        ? "Summer Sale"
                                        : `${selectedService?.service?.title || "Service"} Promotion`}
                                    value={saleForm.title}
                                    onChange={(event) =>
                                        setSaleForm((current) => ({
                                            ...current,
                                            title: event.target.value,
                                        }))
                                    }
                                />
                            </label>

                            <label className="price-modal-field">
                                <span>Discount %</span>
                                <input
                                    type="number"
                                    min="1"
                                    max="90"
                                    step="1"
                                    placeholder="15"
                                    value={saleForm.discountPercent}
                                    onChange={(event) =>
                                        setSaleForm((current) => ({
                                            ...current,
                                            discountPercent: event.target.value,
                                        }))
                                    }
                                />
                            </label>

                            {!saleForm.personalCoupon && <label className="price-modal-field">
                                <span>Sale Type</span>
                                <select disabled={saleForm.personalCoupon} value={saleForm.saleMode} onChange={event => setSaleForm(current => ({ ...current, saleMode: event.target.value }))}>
                                    <option value="WITHOUT_COUPON">Without coupon</option>
                                    <option value="WITH_COUPON">With coupon</option>
                                </select>
                            </label>}
                            {saleForm.saleMode === "WITH_COUPON" && <label className="price-modal-field price-modal-field-full">
                                <span>Coupon Code</span>
                                <div className="price-coupon-input">
                                    <input value={saleForm.couponCode} maxLength={32} placeholder="WELCOME15" onChange={event => setSaleForm(current => ({ ...current, couponCode: event.target.value.toUpperCase() }))} />
                                    <button type="button" className="price-secondary-btn" onClick={() => {
                                        const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
                                        const bytes = crypto.getRandomValues(new Uint8Array(10));
                                        setSaleForm(current => ({ ...current, couponCode: Array.from(bytes, byte => alphabet[byte % 32]).join("") }));
                                    }}>Generate Coupon</button>
                                </div>
                                <small>Customers can redeem this code at checkout while the coupon is active.</small>
                            </label>}

                            <label className="price-modal-field">
                                <span>Sale Start</span>
                                <input
                                    type="datetime-local"
                                    value={saleForm.startsAt}
                                    onChange={(event) =>
                                        setSaleForm((current) => ({
                                            ...current,
                                            startsAt: event.target.value,
                                        }))
                                    }
                                />
                            </label>

                            <label className="price-modal-field">
                                <span>Sale End</span>
                                <input
                                    type="datetime-local"
                                    value={saleForm.endsAt}
                                    onChange={(event) =>
                                        setSaleForm((current) => ({
                                            ...current,
                                            endsAt: event.target.value,
                                        }))
                                    }
                                />
                            </label>
                        </div>

                        <>
                            <p className="price-coupon-help">{saleForm.saleMode === "WITH_COUPON" ? "Set Sale Start to schedule when this coupon becomes available, or leave it blank to start immediately. Leave Sale End blank for no expiration, even with a scheduled start." : "Leave Sale Start blank to activate immediately, or choose a start date to schedule this sale. Set Sale End to choose when it finishes."} Discounts apply to the base price only.</p>
                            {!saleForm.personalCoupon && <label className="price-sale-critical-check">
                                <input type="checkbox" disabled={saleForm.personalCoupon} checked={saleForm.footerDecoration} onChange={event => setSaleForm(current => ({ ...current, footerDecoration: event.target.checked }))} />
                                <div><strong>Footer decoration</strong><span>Show this campaign in the customer-facing sale bar while it is active.</span></div>
                            </label>}
                        </>
                        {saleForm.footerDecoration && !saleForm.personalCoupon && <>
                            <label className="price-sale-critical-check">
                                <input type="checkbox" checked={saleForm.footerTimer} onChange={event => setSaleForm(current => ({ ...current, footerTimer: event.target.checked }))} />
                                <div><strong>Show countdown timer</strong><span>Counts down to Sale End. Without an end date, the bar displays without a timer.</span></div>
                            </label>
                            <SaleBanner preview promotion={{ title: saleForm.title || "Limited time sale", discountPercent: Number(saleForm.discountPercent) || 0, couponCode: saleForm.saleMode === "WITH_COUPON" ? saleForm.couponCode : null, footerTimer: saleForm.footerTimer, endsAt: saleForm.endsAt || null, scope: saleScope, service: selectedService?.service }} />
                        </>}

                        {saleError && (
                            <div className="price-save-error price-confirm-error">
                                {saleError}
                            </div>
                        )}

                        <div className="price-modal-actions">
                            <button
                                type="button"
                                className="price-secondary-btn"
                                onClick={closeSaleModal}
                                disabled={saleSaving}
                            >
                                Cancel
                            </button>

                            <button
                                type="button"
                                className="price-primary-btn"
                                onClick={requestCreateSale}
                                disabled={saleSaving}
                            >
                                {saleSaving
                                    ? "Creating Sale..."
                                    : saleForm.personalCoupon ? "Create Personal Coupon" : saleScope === "GLOBAL"
                                        ? "Create Global Sale"
                                        : "Create Service Sale"}
                            </button>
                        </div>
                    </section>
                </div>
            )}
        </>
    );
}
