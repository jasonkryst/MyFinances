// #526: the pure ICS helpers shared by the .ics download and the webcal feed.
const {
    icsEscape, icsFold, isoDateStr, nextDayStr, dateStrToIso, buildDesc, vevent, buildIcs, recurringTypeLabel,
} = require('../../src/calendarCore.js');

const NOW = new Date(2026, 10, 24, 12);

test('icsEscape escapes backslash, semicolon, comma and newlines', () => {
    expect(icsEscape('a,b;c\\d\ne')).toBe('a\\,b\\;c\\\\d\\ne');
    expect(icsEscape('x\r\ny')).toBe('x\\ny');
    expect(icsEscape(undefined)).toBe('');
});

test('icsFold folds at 75 characters and leaves shorter lines alone', () => {
    expect(icsFold('a'.repeat(75))).toBe('a'.repeat(75) + '\r\n');
    const folded = icsFold('a'.repeat(160)).split('\r\n').filter(Boolean);
    expect(folded.map(l => l.length)).toEqual([75, 75, 12]);
    expect(folded[1].startsWith(' ')).toBe(true);
});

test('date helpers', () => {
    expect(isoDateStr(2026, 0, 5)).toBe('20260105');
    expect(nextDayStr('20261231')).toBe('20270101');
    expect(nextDayStr('20240228')).toBe('20240229');
    expect(dateStrToIso('20260105')).toBe('2026-01-05');
});

test('buildDesc and vevent', () => {
    expect(buildDesc(0, null, null, null)).toBe('');
    expect(buildDesc(12.5, 'Food', 'Main', 'http://x', 'Amount')).toBe('Amount: $12.50\nCategory: Food\nAccount: Main\nView in MyFinances: http://x');
    const ev = vevent('u@x', 'A, B', '20260105', '');
    expect(ev).toBe('BEGIN:VEVENT\r\nUID:u@x\r\nDTSTART;VALUE=DATE:20260105\r\nDTEND;VALUE=DATE:20260106\r\nSUMMARY:A\\, B\r\nEND:VEVENT\r\n');
});

test('recurringTypeLabel defaults to Subscription', () => {
    expect(recurringTypeLabel('income')).toBe('Income');
    expect(recurringTypeLabel('reimbursement')).toBe('Reimbursement');
    expect(recurringTypeLabel('transfer')).toBe('Transfer');
    expect(recurringTypeLabel('subscription')).toBe('Subscription');
    expect(recurringTypeLabel(undefined)).toBe('Subscription');
});

test('buildIcs: empty data is a valid empty calendar; archived templates and unshown archived debts are skipped', () => {
    const empty = buildIcs({ now: NOW });
    expect(empty.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(empty.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(empty).not.toContain('BEGIN:VEVENT');

    const data = {
        now: NOW,
        recurringTemplates: [{ id: 1, name: 'Gone', type: 'subscription', amount: 5, frequency: 'monthly', dayOfMonth: 3, archived: true }],
        debts: [{ id: 2, name: 'Old', dueDate: 10, minimumPayment: 5, archived: true }],
    };
    expect(buildIcs(data)).not.toContain('BEGIN:VEVENT');
    expect(buildIcs({ ...data, showArchived: true })).toContain('SUMMARY:Debt (Archived) - Old');
});

test('buildIcs uses a debt\'s typed next-payment date in its month', () => {
    const ics = buildIcs({ now: NOW, debts: [{ id: 9, name: 'D', dueDate: 28, nextPaymentDue: '2026-12-09', minimumPayment: 5 }] });
    expect(ics).toContain('UID:debt-9-20261209@myfinances');
    expect(ics).toContain('UID:debt-9-20261128@myfinances');
    expect(ics).not.toContain('UID:debt-9-20261228@myfinances');
});
