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

// Bookkeeping and derived fields: they change on every write or are rebuilt
// from the Ledger, so listing them only buries the change the person made.
export const HIDDEN_AUDIT_FIELDS = ['updatedAt', 'createdAt', 'rowVersion', 'paidMonths'];

// Ledger key `type` -> the app collection holding that source's records.
export const LEDGER_SOURCE_COLLECTIONS = {
    income: 'incomes', bonus: 'bonuses', debt: 'debts', bill: 'bills', expense: 'expenses',
    transfer: 'transfers', manual: 'manualTransactions', recurring: 'recurringTemplates', interest: 'accounts'
};

// `type|sourceId|accountId|date` -> its parts, or null when malformed.
export function parseLedgerKey(key) {
    const parts = String(key ?? '').split('|');
    if (parts.length !== 4 || !parts[0] || !parts[1] || !parts[3]) return null;
    const [type, sourceId, accountId, date] = parts;
    return { type, sourceId, accountId: /^\d+$/.test(accountId) ? accountId : null, date };
}

// "notifyFilterStatus" -> "Notify filter status": the fallback label for a
// setting that has no translation of its own.
export function humanizeKey(key) {
    const words = String(key ?? '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim().toLowerCase();
    return words ? words.charAt(0).toUpperCase() + words.slice(1) : '';
}

function nonBlank(v) {
    return typeof v === 'string' && v.trim() ? v.trim() : null;
}

// What to show for a keyed row (Ledger mark or override, setting, snapshot)
// instead of its raw key; null when nothing readable can be built.
// `ctx`: { sourceName(type, id), accountName(id), formatDate(iso), settingLabel(key) },
// every member optional.
export function keyedEntryLabel(entry, ctx = {}) {
    if (!entry) return null;
    const { table, rowId } = entry;
    if (table === 'settings') return nonBlank(ctx.settingLabel ? ctx.settingLabel(rowId) : humanizeKey(rowId));
    if (table === 'net_worth_snapshots') {
        return nonBlank(ctx.formatDate ? ctx.formatDate(rowId) : String(rowId ?? ''));
    }
    if (table !== 'ledger_amount_overrides' && table !== 'ledger_cleared_transactions') return null;
    const key = parseLedgerKey(rowId);
    if (!key) return null;
    const snap = (entry.after && typeof entry.after === 'object' ? entry.after : null)
        || (entry.before && typeof entry.before === 'object' ? entry.before : {});
    const name = nonBlank(snap.transactionName) || nonBlank(ctx.sourceName && ctx.sourceName(key.type, key.sourceId));
    const account = key.accountId && ctx.accountName ? nonBlank(ctx.accountName(key.accountId)) : null;
    const date = ctx.formatDate ? nonBlank(ctx.formatDate(key.date)) : key.date;
    const parts = [name, date, account].filter(Boolean);
    return name ? parts.join(' · ') : null;
}

function isPrimitiveList(v) {
    return Array.isArray(v) && v.every(x => x === null || ['string', 'number', 'boolean'].includes(typeof x));
}

// The list of { field, from, to } rows an update shows. A list of plain values
// (paid months, hidden columns) also carries `added`/`removed` so the page can
// say what changed instead of printing both whole lists.
export function describeChanges(entry) {
    if (!entry || entry.op !== 'update') return [];
    return changedFields(entry.before, entry.after)
        .filter(field => !HIDDEN_AUDIT_FIELDS.includes(field))
        .map(field => {
            const b = entry.before ? entry.before[field] : null;
            const a = entry.after ? entry.after[field] : null;
            const row = { field, from: formatAuditValue(b), to: formatAuditValue(a) };
            if (isPrimitiveList(b ?? []) && isPrimitiveList(a ?? []) && (Array.isArray(b) || Array.isArray(a))) {
                const bl = (b ?? []).map(String);
                const al = (a ?? []).map(String);
                row.added = al.filter(x => !bl.includes(x));
                row.removed = bl.filter(x => !al.includes(x));
            }
            return row;
        });
}

// Query string for GET /api/audit-log.
export function auditQuery({ limit = 50, before = null, table = 'all' } = {}) {
    const params = [`limit=${encodeURIComponent(limit)}`];
    if (before !== null && before !== undefined) params.push(`before=${encodeURIComponent(before)}`);
    if (table && table !== 'all') params.push(`table=${encodeURIComponent(table)}`);
    return params.join('&');
}
