// Bell filters (#649) and pure-module fixes (#647).
const {
    filtersFromSettings, filtersToSettings, filtersToQuery, normalizeNotificationFilters,
    notificationAccountId, summarizeNotifications, groupNotificationsByDay, typesForCategory,
} = require('../../src/notificationsFilter.js');
const SS = require('../../src/settingsSchema.js');

describe('filtersFromSettings / filtersToSettings', () => {
    test('defaults', () => {
        expect(filtersFromSettings({})).toEqual({ category: 'all', status: 'unread', accountId: 'all', from: null, to: null });
        expect(filtersFromSettings(null).status).toBe('unread');
    });
    test('valid values', () => {
        expect(filtersFromSettings({ type: 'bill', status: 'read', account: 5 }))
            .toEqual({ category: 'bill', status: 'read', accountId: 5, from: null, to: null });
    });
    test.each([[0], [-3], [2.5], ['x'], [null], [undefined], [99999999999999999999]])('account %j -> all', a => {
        expect(filtersFromSettings({ account: a }).accountId).toBe('all');
    });
    test('junk type/status fall back', () => {
        const f = filtersFromSettings({ type: 'zzz', status: 'zzz' });
        expect(f.category).toBe('all');
        expect(f.status).toBe('unread');
    });
    test('toSettings round-trips and maps all to 0', () => {
        expect(filtersToSettings({ category: 'projected', status: 'all', accountId: 4 }))
            .toEqual({ type: 'projected', status: 'all', account: 4 });
        expect(filtersToSettings({})).toEqual({ type: 'all', status: 'unread', account: 0 });
        const s = { type: 'overdrawn', status: 'resolved', account: 9 };
        expect(filtersToSettings(filtersFromSettings(s))).toEqual(s);
    });
});

describe('filtersToQuery', () => {
    test('empty when everything is all', () => {
        expect(filtersToQuery({ category: 'all', status: 'all', accountId: 'all' })).toBe('');
    });
    test('includes the unread default explicitly (bell sends status=unread)', () => {
        expect(filtersToQuery({})).toBe('status=unread');
    });
    test('full query, omitting all parts', () => {
        expect(filtersToQuery({ category: 'bill', status: 'unread', accountId: 3 }))
            .toBe('type=bill&status=unread&account=3');
        expect(filtersToQuery({ category: 'bill', status: 'all', accountId: 'all' })).toBe('type=bill');
        expect(filtersToQuery({ category: 'all', status: 'all', accountId: 7 })).toBe('account=7');
    });
});

describe('notify filter settings keys', () => {
    test('constants', () => {
        expect(SS.NOTIFY_FILTER_TYPE).toBe('notifyFilterType');
        expect(SS.NOTIFY_FILTER_STATUS).toBe('notifyFilterStatus');
        expect(SS.NOTIFY_FILTER_ACCOUNT).toBe('notifyFilterAccount');
    });
    test('isAllowedSetting accepts and rejects', () => {
        for (const v of ['all', 'bill', 'lowBalance', 'overdrawn', 'projected']) expect(SS.isAllowedSetting('notifyFilterType', v)).toBe(true);
        for (const v of ['unread', 'read', 'active', 'resolved', 'all']) expect(SS.isAllowedSetting('notifyFilterStatus', v)).toBe(true);
        for (const v of [0, 1, 42]) expect(SS.isAllowedSetting('notifyFilterAccount', v)).toBe(true);
        for (const v of ['zzz', '', 5, null, 'unread']) expect(SS.isAllowedSetting('notifyFilterType', v)).toBe(false);
        for (const v of ['bill', '', 1, null]) expect(SS.isAllowedSetting('notifyFilterStatus', v)).toBe(false);
        for (const v of [-1, 1.5, '3', null, NaN, 99999999999999999999]) expect(SS.isAllowedSetting('notifyFilterAccount', v)).toBe(false);
    });
    test('not exportable', () => {
        for (const k of ['notifyFilterType', 'notifyFilterStatus', 'notifyFilterAccount']) {
            expect(SS.SETTINGS_EXPORT_SCHEMA).not.toHaveProperty(k);
            expect(SS.validateExportedSetting(k, k === 'notifyFilterAccount' ? 1 : 'all')).toBe(false);
        }
    });
    test('value lists match the filter module', () => {
        for (const t of SS.NOTIFY_FILTER_TYPES) {
            expect(filtersFromSettings({ type: t }).category).toBe(t);
            if (t !== 'all') expect(typesForCategory(t)).not.toBeNull();
        }
        for (const s of SS.NOTIFY_FILTER_STATUSES) expect(filtersFromSettings({ status: s }).status).toBe(s);
        expect(SS.NOTIFY_FILTER_TYPES).toHaveLength(5);
        expect(SS.NOTIFY_FILTER_STATUSES).toHaveLength(5);
    });
});

describe('#647 pure fixes', () => {
    test('unsafe integer account id is all', () => {
        expect(normalizeNotificationFilters({ accountId: '99999999999999999999' }).accountId).toBe('all');
        expect(notificationAccountId({ params: { accountId: '99999999999999999999' } })).toBeNull();
    });
    test('summarize uses max(total, loaded)', () => {
        const s = summarizeNotifications([{ id: 1 }, { id: 2 }, { id: 3 }], 1);
        expect(s.total).toBe(3);
        expect(s.truncated).toBe(false);
        expect(summarizeNotifications([{ id: 1 }], 5)).toMatchObject({ total: 5, truncated: true });
    });
    test('unparseable createdAt groups as earlier', () => {
        const items = [{ id: 1, createdAt: 'garbage' }, { id: 2 }];
        expect(groupNotificationsByDay(items, new Date(2026, 10, 18))).toEqual([{ key: 'earlier', items }]);
    });
});
