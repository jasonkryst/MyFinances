// Unit tests for the Notifications page core (#643).
const {
    notificationAccountId, notificationCategory, normalizeNotificationFilters,
    filterNotifications, groupNotificationsByDay, summarizeNotifications,
    notificationViewTarget, pruneSelection, typesForCategory,
} = require('../../src/notificationsFilter.js');

const at = (y, m, d, h = 0, mi = 0) => new Date(y, m - 1, d, h, mi).toISOString();
const mk = (id, type, extra = {}) => ({
    id, type, params: { accountId: 1 }, createdAt: at(2026, 11, 10, 12), readAt: null, resolvedAt: null, ...extra,
});
const ids = arr => arr.map(n => n.id);

describe('notificationAccountId', () => {
    test.each([
        [{ params: { accountId: 3 } }, 3],
        [{ params: { accountId: '7' } }, 7],
        [{}, null], [null, null], [{ params: {} }, null],
        [{ params: { accountId: 'abc' } }, null],
        [{ params: { accountId: 0 } }, null],
        [{ params: { accountId: 2.5 } }, null],
        [{ params: { accountId: -1 } }, null],
        [{ params: { accountId: null } }, null],
    ])('%j -> %j', (n, expected) => {
        expect(notificationAccountId(n)).toBe(expected);
    });
});

describe('notificationCategory', () => {
    test.each([
        ['billDueSoon', 'bill'], ['billDueToday', 'bill'], ['lowBalance', 'lowBalance'],
        ['zeroBalance', 'overdrawn'], ['projectedLow', 'projected'], ['promoEnding', 'promo'], ['sinkingBehind', 'sinking'],
        ['nope', 'other'], [undefined, 'other'], ['toString', 'other'],
    ])('%s -> %s', (t, c) => expect(notificationCategory(t)).toBe(c));
});

describe('typesForCategory', () => {
    test.each([
        ['bill', ['billDueSoon', 'billDueToday']],
        ['lowBalance', ['lowBalance']],
        ['overdrawn', ['zeroBalance']],
        ['projected', ['projectedLow']],
        ['sinking', ['sinkingBehind']],
    ])('%s -> %j', (c, expected) => expect(typesForCategory(c)).toEqual(expected));

    test.each(['all', 'other', 'nope', undefined, null, 'toString'])('%s -> null', c => {
        expect(typesForCategory(c)).toBeNull();
    });

    test('agrees with notificationCategory for every returned type', () => {
        for (const c of ['bill', 'lowBalance', 'overdrawn', 'projected', 'sinking']) {
            for (const t of typesForCategory(c)) expect(notificationCategory(t)).toBe(c);
        }
    });
});

describe('normalizeNotificationFilters', () => {
    const defaults = { category: 'all', status: 'unread', accountId: 'all', from: null, to: null };
    test('defaults for empty and junk', () => {
        expect(normalizeNotificationFilters()).toEqual(defaults);
        expect(normalizeNotificationFilters(null)).toEqual(defaults);
        expect(normalizeNotificationFilters({
            category: 'other', status: 'bogus', accountId: -1, from: '2026-13-99', to: 'x',
        })).toEqual(defaults);
        expect(normalizeNotificationFilters({ accountId: 'abc', from: '2026-02-30' })).toEqual(defaults);
        expect(normalizeNotificationFilters({ accountId: 1.5 }).accountId).toBe('all');
        expect(normalizeNotificationFilters({ accountId: 0 }).accountId).toBe('all');
    });
    test('valid values kept', () => {
        expect(normalizeNotificationFilters({
            category: 'overdrawn', status: 'resolved', accountId: '2', from: '2026-11-01', to: '2026-11-30',
        })).toEqual({ category: 'overdrawn', status: 'resolved', accountId: 2, from: '2026-11-01', to: '2026-11-30' });
        expect(normalizeNotificationFilters({ accountId: 4 }).accountId).toBe(4);
        expect(normalizeNotificationFilters({ status: 'all' }).status).toBe('all');
    });
});

describe('filterNotifications', () => {
    const items = [
        mk(1, 'billDueSoon'), mk(2, 'lowBalance'), mk(3, 'zeroBalance'), mk(4, 'projectedLow'),
        mk(5, 'billDueToday', { readAt: 'x' }),
    ];
    const all = { status: 'all' };
    test('category', () => {
        expect(ids(filterNotifications(items, { ...all, category: 'bill' }))).toEqual([1, 5]);
        expect(ids(filterNotifications(items, { ...all, category: 'lowBalance' }))).toEqual([2]);
        expect(ids(filterNotifications(items, { ...all, category: 'overdrawn' }))).toEqual([3]);
        expect(ids(filterNotifications(items, { ...all, category: 'projected' }))).toEqual([4]);
        expect(ids(filterNotifications(items, { ...all, category: 'bogus' }))).toEqual([1, 2, 3, 4, 5]);
    });
    test('status', () => {
        const s = [mk(1, 'lowBalance'), mk(2, 'lowBalance', { readAt: 'r' }),
            mk(3, 'lowBalance', { resolvedAt: 'z' }), mk(4, 'lowBalance', { readAt: 'r', resolvedAt: 'z' })];
        expect(ids(filterNotifications(s, { status: 'unread' }))).toEqual([1, 3]);
        expect(ids(filterNotifications(s, { status: 'read' }))).toEqual([2, 4]);
        expect(ids(filterNotifications(s, { status: 'active' }))).toEqual([1, 2]);
        expect(ids(filterNotifications(s, { status: 'resolved' }))).toEqual([3, 4]);
        expect(ids(filterNotifications(s, { status: 'all' }))).toEqual([1, 2, 3, 4]);
        expect(ids(filterNotifications(s, undefined))).toEqual([1, 3]);
    });
    test('accountId as number or string, rows without one excluded', () => {
        const a = [mk(1, 'lowBalance', { params: { accountId: 2 } }), mk(2, 'lowBalance'),
            mk(3, 'billDueSoon', { params: { accountId: null } })];
        expect(ids(filterNotifications(a, { ...all, accountId: 2 }))).toEqual([1]);
        expect(ids(filterNotifications(a, { ...all, accountId: '2' }))).toEqual([1]);
        expect(ids(filterNotifications(a, { ...all, accountId: 'all' }))).toEqual([1, 2, 3]);
    });
    test('from/to inclusive at both ends on local date', () => {
        const d = [
            mk(1, 'lowBalance', { createdAt: at(2026, 11, 9, 23, 59) }),
            mk(2, 'lowBalance', { createdAt: at(2026, 11, 10, 0, 0) }),
            mk(3, 'lowBalance', { createdAt: at(2026, 11, 12, 23, 59) }),
            mk(4, 'lowBalance', { createdAt: at(2026, 11, 13, 0, 0) }),
        ];
        expect(ids(filterNotifications(d, { ...all, from: '2026-11-10', to: '2026-11-12' }))).toEqual([2, 3]);
        expect(ids(filterNotifications(d, { ...all, from: '2026-11-10' }))).toEqual([2, 3, 4]);
        expect(ids(filterNotifications(d, { ...all, to: '2026-11-10' }))).toEqual([1, 2]);
        expect(ids(filterNotifications([mk(9, 'lowBalance', { createdAt: 'junk' })], { ...all, from: '2026-01-01' }))).toEqual([]);
        expect(ids(filterNotifications([mk(9, 'lowBalance', { createdAt: 'junk' })], all))).toEqual([9]);
    });
    test('junk filters fall back to defaults and null items', () => {
        expect(ids(filterNotifications(items, { status: 'bogus', from: '2026-13-99', accountId: -1 }))).toEqual([1, 2, 3, 4]);
        expect(filterNotifications(null, null)).toEqual([]);
    });
});

describe('groupNotificationsByDay', () => {
    const now = new Date(2026, 10, 17, 15, 0);
    const n = (id, y, m, d, h, mi) => mk(id, 'lowBalance', { createdAt: at(y, m, d, h, mi) });
    test('buckets and boundaries', () => {
        const items = [
            n(1, 2026, 11, 17, 0, 0), n(2, 2026, 11, 16, 23, 59), n(3, 2026, 11, 15, 12, 0),
            n(4, 2026, 11, 11, 0, 0), n(5, 2026, 11, 10, 23, 59), n(6, 2026, 10, 1, 0, 0),
        ];
        const g = groupNotificationsByDay(items, now);
        expect(g.map(x => x.key)).toEqual(['today', 'yesterday', 'thisWeek', 'earlier']);
        expect(g.map(x => ids(x.items))).toEqual([[1], [2], [3, 4], [5, 6]]);
    });
    test('empty groups omitted, order kept, future is today, empty input', () => {
        const g = groupNotificationsByDay([n(1, 2026, 11, 1, 0, 0), n(2, 2026, 10, 1, 0, 0), n(3, 2026, 11, 18, 9, 0)], now);
        expect(g.map(x => x.key)).toEqual(['today', 'earlier']);
        expect(ids(g[1].items)).toEqual([1, 2]);
        expect(groupNotificationsByDay([], now)).toEqual([]);
        expect(groupNotificationsByDay(null, now)).toEqual([]);
    });
    test('exactly 2 days ago is thisWeek', () => {
        expect(groupNotificationsByDay([n(1, 2026, 11, 15, 0, 0)], now)[0].key).toBe('thisWeek');
    });
});

describe('summarizeNotifications', () => {
    const items = [mk(1, 'lowBalance'), mk(2, 'lowBalance', { readAt: 'r', resolvedAt: 'z' }), mk(3, 'lowBalance', { readAt: 'r' })];
    test('counts and truncated', () => {
        expect(summarizeNotifications(items, 10)).toEqual({ loaded: 3, total: 10, unread: 1, active: 2, truncated: true });
        expect(summarizeNotifications(items, 3).truncated).toBe(false);
        expect(summarizeNotifications(items, undefined)).toEqual({ loaded: 3, total: 3, unread: 1, active: 2, truncated: false });
        expect(summarizeNotifications(null, 0)).toEqual({ loaded: 0, total: 0, unread: 0, active: 0, truncated: false });
    });
});

describe('notificationViewTarget', () => {
    test('bills to ledger, others to accounts', () => {
        expect(notificationViewTarget(mk(1, 'billDueSoon', { params: { accountId: 5 } }))).toEqual({ page: 'ledger', accountId: 5 });
        expect(notificationViewTarget(mk(1, 'billDueToday', { params: {} }))).toEqual({ page: 'ledger', accountId: null });
        expect(notificationViewTarget(mk(1, 'lowBalance', { params: { accountId: 2 } }))).toEqual({ page: 'accounts', accountId: 2 });
        expect(notificationViewTarget(mk(1, 'zeroBalance'))).toEqual({ page: 'accounts', accountId: 1 });
        expect(notificationViewTarget(mk(1, 'sinkingBehind', { params: {} }))).toEqual({ page: 'savings', accountId: null });
        expect(notificationViewTarget(null)).toEqual({ page: 'accounts', accountId: null });
    });
});

describe('pruneSelection', () => {
    test('drops gone ids', () => {
        const out = pruneSelection(new Set([1, 2, 9]), [{ id: 1 }, { id: 2 }, { id: 3 }]);
        expect(out).toEqual(new Set([1, 2]));
        expect(pruneSelection(new Set(), [{ id: 1 }]).size).toBe(0);
        expect(pruneSelection(new Set([1]), null).size).toBe(0);
    });
});
