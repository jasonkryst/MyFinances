// Unit tests for the refresh decisions (issues #575, #565).
const {
    SYNC_CHANNEL, DEFAULT_REFRESH_ON_FOCUS_SECONDS, parseRefreshSeconds, shouldRefreshOnReturn,
    refreshBlockReason, hasOpenInlineEdit, VIEW_STATE_FIELDS, withoutViewState,
} = require('../../src/refreshPolicy.js');

describe('constants', () => {
    test('channel name and default', () => {
        expect(SYNC_CHANNEL).toBe('myfinances-sync');
        expect(DEFAULT_REFRESH_ON_FOCUS_SECONDS).toBe(60);
    });
});

describe('parseRefreshSeconds', () => {
    test.each([
        [0, 0], [90, 90], [1.5, 1.5], ['120', 120], [' 30 ', 30], ['0', 0], ['2.5', 2.5], ['2.25', 2.25], ['007', 7],
    ])('accepts %j as %j', (raw, expected) => {
        expect(parseRefreshSeconds(raw)).toBe(expected);
    });

    test.each([
        [undefined], [null], [''], ['  '], ['abc'], ['-5'], [-5], ['5s'], ['1e3'], ['.5'], ['5.'],
        [NaN], [Infinity], [-Infinity], [true], [{}], [[]], ['0x10'],
    ])('falls back to 60 for %j', (raw) => {
        expect(parseRefreshSeconds(raw)).toBe(60);
    });
});

describe('shouldRefreshOnReturn', () => {
    test('refreshes once hidden for at least the threshold', () => {
        expect(shouldRefreshOnReturn(1000, 61000, 60)).toBe(true);
        expect(shouldRefreshOnReturn(1000, 70000, 60)).toBe(true);
    });

    test('not before the threshold', () => {
        expect(shouldRefreshOnReturn(1000, 60999, 60)).toBe(false);
        expect(shouldRefreshOnReturn(1000, 1000, 60)).toBe(false);
    });

    test('a threshold of 0 refreshes on every return', () => {
        expect(shouldRefreshOnReturn(1000, 1000, 0)).toBe(true);
    });

    test('never hidden, or bad timestamps, never refreshes', () => {
        expect(shouldRefreshOnReturn(null, 5000, 0)).toBe(false);
        expect(shouldRefreshOnReturn(undefined, 5000, 0)).toBe(false);
        expect(shouldRefreshOnReturn(NaN, 5000, 0)).toBe(false);
        expect(shouldRefreshOnReturn(1000, NaN, 0)).toBe(false);
        expect(shouldRefreshOnReturn('1000', 5000, 0)).toBe(false);
        expect(shouldRefreshOnReturn(1000, Infinity, 0)).toBe(false);
    });
});

describe('refreshBlockReason', () => {
    test('null when nothing is in progress', () => {
        expect(refreshBlockReason({})).toBeNull();
        expect(refreshBlockReason()).toBeNull();
        expect(refreshBlockReason({ pendingWrites: 0, editing: false, modalOpen: false, typing: false })).toBeNull();
    });

    test('each reason on its own', () => {
        expect(refreshBlockReason({ pendingWrites: 1 })).toBe('pending-writes');
        expect(refreshBlockReason({ editing: true })).toBe('editing');
        expect(refreshBlockReason({ modalOpen: true })).toBe('modal-open');
        expect(refreshBlockReason({ typing: true })).toBe('typing');
    });

    test('pending writes win, then editing, then modal, then typing', () => {
        expect(refreshBlockReason({ pendingWrites: 2, editing: true, modalOpen: true, typing: true })).toBe('pending-writes');
        expect(refreshBlockReason({ editing: true, modalOpen: true, typing: true })).toBe('editing');
        expect(refreshBlockReason({ modalOpen: true, typing: true })).toBe('modal-open');
    });

    test('a negative pending count does not block', () => {
        expect(refreshBlockReason({ pendingWrites: -1 })).toBeNull();
    });
});

describe('hasOpenInlineEdit', () => {
    test('true when any editing…Id holds an id', () => {
        expect(hasOpenInlineEdit({ editingDebtId: 5 })).toBe(true);
        expect(hasOpenInlineEdit({ editingRecurringId: 0 })).toBe(true);
        expect(hasOpenInlineEdit({ editingPersonId: 'abc', editingDebtId: null })).toBe(true);
    });

    test('false when none is set', () => {
        expect(hasOpenInlineEdit({ editingDebtId: null, editingIncomeId: undefined })).toBe(false);
        expect(hasOpenInlineEdit({})).toBe(false);
        expect(hasOpenInlineEdit(null)).toBe(false);
        expect(hasOpenInlineEdit('app')).toBe(false);
    });

    test('only editing<Name>Id keys count', () => {
        expect(hasOpenInlineEdit({ editing: 1, editingId: 1, editingdebtId: 1, xeditingDebtId: 1, editingDebtIds: 1, _editingDebtId: 1 })).toBe(false);
    });
});

describe('withoutViewState', () => {
    test('drops exactly the view-state fields and copies the rest', () => {
        const loaded = { debts: [1], _ledgerSortDir: 'asc', _forecastRangeMonths: 3, _savedStrategy: 'snowball' };
        const out = withoutViewState(loaded);
        expect(out).toEqual({ debts: [1], _savedStrategy: 'snowball' });
        expect(loaded._ledgerSortDir).toBe('asc');
    });

    test('covers every ledger and forecast view field loadFromPostgres sets', () => {
        expect(VIEW_STATE_FIELDS).toEqual([
            '_ledgerAccountFilter', '_ledgerDateRange', '_ledgerSortKey', '_ledgerSortDir', '_ledgerClearedFilter',
            '_forecastRangeMonths', '_forecastAccountId', '_forecastNotableThresholdPct',
        ]);
        const all = Object.fromEntries(VIEW_STATE_FIELDS.map(k => [k, 1]));
        expect(withoutViewState(all)).toEqual({});
    });

    test('guard: matches every _ledger*/_forecast* field loadFromPostgres assigns', () => {
        const src = require('fs').readFileSync(require('path').join(__dirname, '../../src/storage.js'), 'utf8');
        const body = src.slice(src.indexOf('export async function loadFromPostgres'));
        const assigned = [...new Set([...body.slice(0, body.indexOf('\n}\n')).matchAll(/app\.(_(?:ledger|forecast)\w+)\s*=/g)].map(m => m[1]))];
        expect(assigned.length).toBeGreaterThan(0);
        expect(assigned.sort()).toEqual([...VIEW_STATE_FIELDS].sort());
    });

    test('non-object input yields an empty object', () => {
        expect(withoutViewState(null)).toEqual({});
        expect(withoutViewState('x')).toEqual({});
    });
});
