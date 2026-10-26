const titleCase = value => value.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]/g, ' ').replace(/^./, char => char.toUpperCase());
const identifierField = key => key === 'id' || key === 'ID' || /(?:Id|Ids|ID|IDs|_id|_ids)$/.test(key);
export const isOpaqueIdentifier = value => typeof value === 'string' && (
    /^c[a-z0-9]{20,}$/i.test(value) ||
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) ||
    /^[a-z]+_[a-z0-9]{12,}$/i.test(value)
);
const displayValue = value => value == null ? 'Not set' : typeof value === 'boolean' ? (value ? 'Yes' : 'No')
    : isOpaqueIdentifier(value) ? 'Reference unavailable' : String(value);

function arrayValue(values) {
    if (!values.length) return 'None';
    return values.map(value => {
        if (!value || typeof value !== 'object') return displayValue(value);
        if (Array.isArray(value)) return arrayValue(value);
        const fields = activityLogFields(value);
        if (fields.length) return fields.map(([name, text]) => `${name}: ${text}`).join(', ');
        return Object.keys(value).some(key => /(?:user|booster|customer|provider|recipient|sender|actor|reviewer).*Ids?$/i.test(key))
            ? 'Unknown user' : 'Reference unavailable';
    }).join('\n');
}

export function activityLogFields(value, prefix = '') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    return Object.entries(value).flatMap(([key, item]) => {
        // Stable IDs remain in audit records for linking and filtering, but the
        // owner-facing details only show names and meaningful changed values.
        if (identifierField(key)) return [];
        const label = prefix ? `${prefix} · ${titleCase(key)}` : titleCase(key);
        if (item && typeof item === 'object' && !Array.isArray(item)) return activityLogFields(item, label);
        return [[label, key === 'username' && !String(item ?? '').trim() ? 'Unknown user'
            : Array.isArray(item) ? arrayValue(item) : displayValue(item)]];
    });
}
