const titleCase = value => value.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]/g, ' ').replace(/^./, char => char.toUpperCase());
const hasUsername = value => typeof value?.username === 'string' && Boolean(value.username.trim());

export function activityLogFields(value, prefix = '') {
    if (value == null) return [];
    return Object.entries(value).flatMap(([key, item]) => {
        // Use the username saved with this event, including inside assignments.
        // Keep IDs when older snapshots or deleted accounts have no recorded name.
        if (key === 'id' && hasUsername(value)) return [];
        if (key.endsWith('Id') && hasUsername(value[key.slice(0, -2)])) return [];
        const label = prefix ? `${prefix} · ${titleCase(key)}` : titleCase(key);
        if (item && typeof item === 'object' && !Array.isArray(item)) return activityLogFields(item, label);
        const display = item == null ? 'Not set' : typeof item === 'boolean' ? (item ? 'Yes' : 'No') : Array.isArray(item)
            ? (item.length ? item.map(entry => typeof entry === 'object' ? activityLogFields(entry).map(([name, text]) => `${name}: ${text}`).join(', ') : String(entry)).join('\n') : 'None')
            : String(item);
        return [[label, display]];
    });
}
