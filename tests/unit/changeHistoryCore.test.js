// Change history page helpers (#580).
import {
    changedFields, recordName, formatAuditValue, describeChanges, auditQuery,
    KEYED_AUDIT_TABLES, AUDIT_TABLE_ORDER
} from '../../src/changeHistoryCore.js';

describe('changedFields', () => {
    test('lists only fields whose values differ, sorted, without id', () => {
        expect(changedFields({ id: 1, name: 'A', amount: 5, x: 1 }, { id: 2, name: 'B', amount: 5, x: 2 }))
            .toEqual(['name', 'x']);
    });
    test('compares objects and arrays by value', () => {
        expect(changedFields({ s: [1, 2], o: { a: 1 } }, { s: [1, 2], o: { a: 1 } })).toEqual([]);
        expect(changedFields({ s: [1, 2] }, { s: [2, 1] })).toEqual(['s']);
    });
    test('a field present on one side only counts, undefined equals null', () => {
        expect(changedFields({ a: 1 }, { b: 2 })).toEqual(['a', 'b']);
        expect(changedFields({ a: null }, {})).toEqual([]);
    });
    test('non-object sides are treated as empty', () => {
        expect(changedFields(null, { a: 1 })).toEqual(['a']);
        expect(changedFields('x', 5)).toEqual([]);
    });
});

describe('recordName', () => {
    test('prefers the new name, falls back to the old one and to description', () => {
        expect(recordName({ table: 'debts', before: { name: 'Old' }, after: { name: ' New ' } })).toBe('New');
        expect(recordName({ table: 'debts', before: { name: 'Gone' }, after: null })).toBe('Gone');
        expect(recordName({ table: 'sinking_funds', after: { description: 'Car' } })).toBe('Car');
    });
    test('returns null for keyed tables, blank names and missing entries', () => {
        for (const table of KEYED_AUDIT_TABLES) {
            expect(recordName({ table, after: { name: 'x' } })).toBeNull();
        }
        expect(recordName({ table: 'debts', after: { name: '   ' } })).toBeNull();
        expect(recordName({ table: 'balance_history', after: { balance: 5 } })).toBeNull();
        expect(recordName(null)).toBeNull();
        expect(recordName({ table: 'debts', after: 'oops' })).toBeNull();
    });
});

describe('formatAuditValue', () => {
    test('formats each value type as plain text', () => {
        expect(formatAuditValue(null)).toBe('—');
        expect(formatAuditValue(undefined)).toBe('—');
        expect(formatAuditValue('abc')).toBe('abc');
        expect(formatAuditValue(12.5)).toBe('12.5');
        expect(formatAuditValue(0)).toBe('0');
        expect(formatAuditValue(false)).toBe('false');
        expect(formatAuditValue({ a: 1 })).toBe('{"a":1}');
        expect(formatAuditValue([1, 2])).toBe('[1,2]');
    });
    test('truncates long text with an ellipsis at maxLen', () => {
        expect(formatAuditValue('x'.repeat(60))).toBe('x'.repeat(60));
        const out = formatAuditValue('x'.repeat(61));
        expect(out).toHaveLength(60);
        expect(out.endsWith('…')).toBe(true);
        expect(formatAuditValue('abcdef', 4)).toBe('abc…');
    });
    test('keeps HTML as literal text (the caller uses textContent)', () => {
        expect(formatAuditValue('<img src=x onerror=alert(1)>')).toBe('<img src=x onerror=alert(1)>');
    });
});

describe('describeChanges', () => {
    test('returns field, from and to for an update', () => {
        expect(describeChanges({ op: 'update', before: { id: 1, name: 'A', amount: 1 }, after: { id: 1, name: 'B', amount: 1 } }))
            .toEqual([{ field: 'name', from: 'A', to: 'B' }]);
    });
    test('handles a missing side', () => {
        expect(describeChanges({ op: 'update', before: null, after: { a: 1 } })).toEqual([{ field: 'a', from: '—', to: '1' }]);
        expect(describeChanges({ op: 'update', before: { a: 1 }, after: null })).toEqual([{ field: 'a', from: '1', to: '—' }]);
    });
    test('creates and deletes show no field list', () => {
        expect(describeChanges({ op: 'create', after: { name: 'A' } })).toEqual([]);
        expect(describeChanges({ op: 'delete', before: { name: 'A' } })).toEqual([]);
        expect(describeChanges(null)).toEqual([]);
    });
});

describe('auditQuery', () => {
    test('defaults to the first page of everything', () => {
        expect(auditQuery()).toBe('limit=50');
        expect(auditQuery({ table: 'all' })).toBe('limit=50');
    });
    test('adds the cursor and table, encoded', () => {
        expect(auditQuery({ limit: 10, before: 42, table: 'debts' })).toBe('limit=10&before=42&table=debts');
        expect(auditQuery({ before: 0 })).toBe('limit=50&before=0');
        expect(auditQuery({ table: 'a&b' })).toBe('limit=50&table=a%26b');
        expect(auditQuery({ before: null, table: '' })).toBe('limit=50');
    });
});

test('the filter order lists each table once', () => {
    expect(new Set(AUDIT_TABLE_ORDER).size).toBe(AUDIT_TABLE_ORDER.length);
    for (const table of KEYED_AUDIT_TABLES) expect(AUDIT_TABLE_ORDER).toContain(table);
});

test('every record type and op has an English label', () => {
    const { t } = require('../../src/i18n.js');
    for (const table of AUDIT_TABLE_ORDER) {
        expect(t(`history.table.${table}`)).not.toBe(`history.table.${table}`);
    }
    for (const op of ['create', 'update', 'delete']) {
        expect(t(`history.op.${op}`)).not.toBe(`history.op.${op}`);
    }
});
