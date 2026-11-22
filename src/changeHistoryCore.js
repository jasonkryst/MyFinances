// Change history (#580): pure helpers for the Settings > Change history page.
// No imports and no DOM, so Jest and Stryker can exercise every branch.

// Tables whose entries are identified by a key (setting name, Ledger key or
// snapshot date) rather than a numeric id and a name.
export const KEYED_AUDIT_TABLES = ['settings', 'ledger_amount_overrides', 'ledger_cleared_transactions', 'net_worth_snapshots', 'plan_settings'];

// The record types, in the order the filter lists them.
export const AUDIT_TABLE_ORDER = [
    'accounts', 'debts', 'incomes', 'bonuses', 'recurring_templates', 'expenses', 'bills', 'transfers',
    'manual_transactions', 'emergency_funds', 'sinking_funds', 'reconciliations', 'balance_history',
    'net_worth_snapshots', 'retirement_snapshots', 'plan_history', 'persons', 'ledger_amount_overrides',
    'ledger_cleared_transactions', 'plan_settings', 'settings'
];

const NAME_FIELDS = ['name', 'description'];

function stable(value) {
    return JSON.stringify(value === undefined ? null : value);
}

// Field names whose values differ between before and after, in a stable
// order. The id never changes and is left out.
export function changedFields(before, after) {
    const b = before && typeof before === 'object' ? before : {};
    const a = after && typeof after === 'object' ? after : {};
    const keys = new Set([...Object.keys(b), ...Object.keys(a)]);
    keys.delete('id');
    return [...keys].filter(k => stable(b[k]) !== stable(a[k])).sort();
}

// The record's own name for display, or null when it has none (keyed rows,
// balance history, snapshots).
export function recordName(entry) {
    if (!entry || KEYED_AUDIT_TABLES.includes(entry.table)) return null;
    for (const source of [entry.after, entry.before]) {
        if (!source || typeof source !== 'object') continue;
        for (const field of NAME_FIELDS) {
            const v = source[field];
            if (typeof v === 'string' && v.trim()) return v.trim();
        }
    }
    return null;
}

// A short, plain-text rendering of one stored value. Never HTML: the caller
// puts it in a text node.
export function formatAuditValue(value, maxLen = 60) {
    if (value === null || value === undefined) return '—';
    let text;
    if (typeof value === 'string') text = value;
    else if (typeof value === 'number' || typeof value === 'boolean') text = String(value);
    else text = JSON.stringify(value);
    return text.length > maxLen ? `${text.slice(0, Math.max(0, maxLen - 1))}…` : text;
}

// The list of { field, from, to } rows an update shows.
export function describeChanges(entry) {
    if (!entry || entry.op !== 'update') return [];
    return changedFields(entry.before, entry.after).map(field => ({
        field,
        from: formatAuditValue(entry.before ? entry.before[field] : null),
        to: formatAuditValue(entry.after ? entry.after[field] : null)
    }));
}

// Query string for GET /api/audit-log.
export function auditQuery({ limit = 50, before = null, table = 'all' } = {}) {
    const params = [`limit=${encodeURIComponent(limit)}`];
    if (before !== null && before !== undefined) params.push(`before=${encodeURIComponent(before)}`);
    if (table && table !== 'all') params.push(`table=${encodeURIComponent(table)}`);
    return params.join('&');
}
