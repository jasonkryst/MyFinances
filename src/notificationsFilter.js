// Notifications page filtering, grouping and selection (#643). Pure and
// DOM-free, no imports (Jest + Stryker scope).

const BILL_TYPES = ['billDueSoon', 'billDueToday'];
const CATEGORY_BY_TYPE = {
    billDueSoon: 'bill',
    billDueToday: 'bill',
    lowBalance: 'lowBalance',
    zeroBalance: 'overdrawn',
    projectedLow: 'projected',
};
const FILTER_CATEGORIES = ['bill', 'lowBalance', 'overdrawn', 'projected'];
const FILTER_STATUSES = ['unread', 'read', 'active', 'resolved', 'all'];
const DAY_MS = 86400000;

// Positive integer account id from params.accountId (number or digit string), else null.
export function notificationAccountId(n) {
    const raw = n?.params?.accountId;
    let id = null;
    if (typeof raw === 'number') id = raw;
    else if (typeof raw === 'string' && /^\d+$/.test(raw.trim())) id = Number(raw.trim());
    return Number.isInteger(id) && id > 0 ? id : null;
}

export function notificationCategory(type) {
    return Object.prototype.hasOwnProperty.call(CATEGORY_BY_TYPE, type)
        ? CATEGORY_BY_TYPE[type]
        : 'other';
}

function isoDateOrNull(v) {
    if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
    const [y, m, d] = v.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
    return v;
}

export function normalizeNotificationFilters(f) {
    const src = f && typeof f === 'object' ? f : {};
    const category = FILTER_CATEGORIES.includes(src.category) ? src.category : 'all';
    const status = FILTER_STATUSES.includes(src.status) ? src.status : 'unread';
    let accountId = 'all';
    const rawId = typeof src.accountId === 'string' && /^\d+$/.test(src.accountId.trim())
        ? Number(src.accountId.trim())
        : src.accountId;
    if (Number.isInteger(rawId) && rawId > 0) accountId = rawId;
    return { category, status, accountId, from: isoDateOrNull(src.from), to: isoDateOrNull(src.to) };
}

function localDateKey(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${mm}-${dd}`;
}

export function filterNotifications(items, filters) {
    const f = normalizeNotificationFilters(filters);
    return (items || []).filter(n => {
        if (f.category !== 'all' && notificationCategory(n.type) !== f.category) return false;
        if (f.status === 'unread' && n.readAt) return false;
        if (f.status === 'read' && !n.readAt) return false;
        if (f.status === 'active' && n.resolvedAt) return false;
        if (f.status === 'resolved' && !n.resolvedAt) return false;
        if (f.accountId !== 'all' && notificationAccountId(n) !== f.accountId) return false;
        if (f.from || f.to) {
            const key = localDateKey(n.createdAt);
            if (key === null) return false;
            if (f.from && key < f.from) return false;
            if (f.to && key > f.to) return false;
        }
        return true;
    });
}

export function groupNotificationsByDay(items, now) {
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const order = ['today', 'yesterday', 'thisWeek', 'earlier'];
    const buckets = { today: [], yesterday: [], thisWeek: [], earlier: [] };
    for (const n of items || []) {
        const d = new Date(n.createdAt);
        const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
        const diff = Math.round((today.getTime() - day.getTime()) / DAY_MS);
        let key = 'earlier';
        if (diff <= 0) key = 'today';
        else if (diff === 1) key = 'yesterday';
        else if (diff <= 6) key = 'thisWeek';
        buckets[key].push(n);
    }
    return order.filter(k => buckets[k].length > 0).map(k => ({ key: k, items: buckets[k] }));
}

export function summarizeNotifications(items, total) {
    const list = items || [];
    const loaded = list.length;
    const t = Number.isFinite(total) ? total : loaded;
    return {
        loaded,
        total: t,
        unread: list.filter(n => !n.readAt).length,
        active: list.filter(n => !n.resolvedAt).length,
        truncated: t > loaded,
    };
}

export function notificationViewTarget(n) {
    const accountId = notificationAccountId(n);
    return BILL_TYPES.includes(n?.type)
        ? { page: 'ledger', accountId }
        : { page: 'accounts', accountId };
}

export function pruneSelection(selectedIds, items) {
    const present = new Set((items || []).map(n => n.id));
    const out = new Set();
    for (const id of selectedIds || []) if (present.has(id)) out.add(id);
    return out;
}
