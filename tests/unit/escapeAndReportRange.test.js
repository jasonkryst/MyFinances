// #547: pure logic moved out of the Playwright suite (test_report_range_utils.py).
const {
    escapeHtml,
    getReportRangeMonths,
    reportRangeMonthsList,
    getPriorEquivalentRangeEnd,
    formatReportRangeLabel,
} = require('../../src/utils.js');

describe('escapeHtml', () => {
    test('escapes all five special characters', () => {
        expect(escapeHtml('&')).toBe('&amp;');
        expect(escapeHtml('<')).toBe('&lt;');
        expect(escapeHtml('>')).toBe('&gt;');
        expect(escapeHtml('"')).toBe('&quot;');
        expect(escapeHtml("'")).toBe('&#39;');
    });

    test('escapes every occurrence, not just the first', () => {
        expect(escapeHtml('a&b&c<<>>""\'\'')).toBe('a&amp;b&amp;c&lt;&lt;&gt;&gt;&quot;&quot;&#39;&#39;');
    });

    test('escapes & first so existing entities are not interpreted', () => {
        expect(escapeHtml('&lt;')).toBe('&amp;lt;');
        expect(escapeHtml('<script>alert("x")</script>')).toBe('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
    });

    test('leaves safe text untouched', () => {
        expect(escapeHtml('Plain text 123 - ok')).toBe('Plain text 123 - ok');
        expect(escapeHtml('')).toBe('');
    });

    test('null and undefined become an empty string', () => {
        expect(escapeHtml(null)).toBe('');
        expect(escapeHtml(undefined)).toBe('');
    });

    test('other values are stringified (0 and false are kept)', () => {
        expect(escapeHtml(0)).toBe('0');
        expect(escapeHtml(42.5)).toBe('42.5');
        expect(escapeHtml(false)).toBe('false');
        expect(escapeHtml(NaN)).toBe('NaN');
        expect(escapeHtml({ toString() { return '<b>'; } })).toBe('&lt;b&gt;');
    });
});

describe('getReportRangeMonths', () => {
    test('defaults to 1 when unset, zero, negative, one or not a number', () => {
        expect(getReportRangeMonths({})).toBe(1);
        expect(getReportRangeMonths({ _reportRangeMonths: 0 })).toBe(1);
        expect(getReportRangeMonths({ _reportRangeMonths: -3 })).toBe(1);
        expect(getReportRangeMonths({ _reportRangeMonths: 1 })).toBe(1);
        expect(getReportRangeMonths({ _reportRangeMonths: null })).toBe(1);
        expect(getReportRangeMonths({ _reportRangeMonths: NaN })).toBe(1);
    });

    test('returns a valid range as is', () => {
        expect(getReportRangeMonths({ _reportRangeMonths: 2 })).toBe(2);
        expect(getReportRangeMonths({ _reportRangeMonths: 6 })).toBe(6);
        expect(getReportRangeMonths({ _reportRangeMonths: 12 })).toBe(12);
    });
});

describe('reportRangeMonthsList', () => {
    test('a single month is just that month', () => {
        expect(reportRangeMonthsList(2026, 5, 1)).toEqual([{ year: 2026, month: 5 }]);
    });

    test('is oldest-first and ends at the given month', () => {
        expect(reportRangeMonthsList(2026, 8, 3)).toEqual([
            { year: 2026, month: 6 }, { year: 2026, month: 7 }, { year: 2026, month: 8 },
        ]);
    });

    test('crosses a year boundary', () => {
        expect(reportRangeMonthsList(2026, 1, 3)).toEqual([
            { year: 2025, month: 11 }, { year: 2026, month: 0 }, { year: 2026, month: 1 },
        ]);
    });

    test('a range ending in January reaches into the prior year', () => {
        expect(reportRangeMonthsList(2026, 0, 2)).toEqual([
            { year: 2025, month: 11 }, { year: 2026, month: 0 },
        ]);
    });

    test('a 12-month range ending in December is the calendar year', () => {
        const list = reportRangeMonthsList(2026, 11, 12);
        expect(list).toHaveLength(12);
        expect(list[0]).toEqual({ year: 2026, month: 0 });
        expect(list[11]).toEqual({ year: 2026, month: 11 });
    });

    test('a range longer than a year spans two year boundaries', () => {
        const list = reportRangeMonthsList(2026, 1, 26);
        expect(list).toHaveLength(26);
        expect(list[0]).toEqual({ year: 2024, month: 0 });
        expect(list[25]).toEqual({ year: 2026, month: 1 });
    });

    test('zero or negative range gives an empty list', () => {
        expect(reportRangeMonthsList(2026, 5, 0)).toEqual([]);
        expect(reportRangeMonthsList(2026, 5, -2)).toEqual([]);
    });
});

describe('getPriorEquivalentRangeEnd', () => {
    test('within the same year', () => {
        expect(getPriorEquivalentRangeEnd(2026, 8, 3)).toEqual({ year: 2026, month: 5 });
    });

    test('crosses a year boundary', () => {
        expect(getPriorEquivalentRangeEnd(2026, 1, 6)).toEqual({ year: 2025, month: 7 });
    });

    test('a 1-month range is the previous month, wrapping from January', () => {
        expect(getPriorEquivalentRangeEnd(2026, 5, 1)).toEqual({ year: 2026, month: 4 });
        expect(getPriorEquivalentRangeEnd(2026, 0, 1)).toEqual({ year: 2025, month: 11 });
    });

    test('a 12-month range lands on the same month a year earlier', () => {
        expect(getPriorEquivalentRangeEnd(2026, 4, 12)).toEqual({ year: 2025, month: 4 });
    });

    test('a range longer than a year wraps more than once', () => {
        expect(getPriorEquivalentRangeEnd(2026, 1, 26)).toEqual({ year: 2023, month: 11 });
    });

    test('the prior range is adjacent to the current one', () => {
        const prior = getPriorEquivalentRangeEnd(2026, 1, 3);
        const priorList = reportRangeMonthsList(prior.year, prior.month, 3);
        expect(priorList).toEqual([
            { year: 2025, month: 8 }, { year: 2025, month: 9 }, { year: 2025, month: 10 },
        ]);
    });
});

describe('formatReportRangeLabel', () => {
    test('a single month (or less) uses the full month name and year', () => {
        expect(formatReportRangeLabel(2026, 8, 1)).toBe('September 2026');
        expect(formatReportRangeLabel(2026, 8, 0)).toBe('September 2026');
    });

    test('a range inside one year shows the start month without a year', () => {
        expect(formatReportRangeLabel(2026, 8, 3)).toBe('Jul – Sep 2026');
    });

    test('a range crossing a year boundary spells out both years', () => {
        expect(formatReportRangeLabel(2026, 1, 3)).toBe('Dec 2025 – Feb 2026');
    });

    test('a 12-month range ending in December stays in one year', () => {
        expect(formatReportRangeLabel(2026, 11, 12)).toBe('Jan – Dec 2026');
    });
});
