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

export default function PriceManagementPage() {
    const [pricingServices, setPricingServices] = useState([]);
    const [pricesLoading, setPricesLoading] = useState(true);
    const [pricesError, setPricesError] = useState("");

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

            const token = localStorage.getItem("token");

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

                    </aside>
                </section>
            </main>

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
                                    : `Apply ${selectedPriceChangeIds.size} Selected Change${
                                        selectedPriceChangeIds.size === 1 ? "" : "s"
                                    }`}
                            </button>
                        </div>
                    </section>
                </div>
            )}

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