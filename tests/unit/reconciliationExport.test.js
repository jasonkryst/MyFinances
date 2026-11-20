// Unit tests for the reconciliation report export builders (#318).
import {
    csvTextField,
    effectiveStatementStart,
    selectClearedTransactions,
    buildReconciliationReport,
    buildReconciliationCsv,
    reconciliationFilename
} from '../../src/reconciliationExport.js';

const cleared = new Map([['a', '2026-11-05T10:00:00Z'], ['b', '2026-11-30T09:00:00Z'], ['c', '2026-11-01T08:00:00Z'], ['far', 'x']]);
const isClearedFn = id => cleared.has(id);
const clearedAtFn = id => cleared.get(id) || null;

const txs = [
    { transactionId: 'a', date: '2026-11-05', name: 'Rent', amount: -1200 },
    { transactionId: 'u', date: '2026-11-06', name: 'Uncleared', amount: -5 },
    { transactionId: 'b', date: '2026-11-30', name: 'Last day', amount: 10 },
    { transactionId: 'c', date: '2026-11-01', name: 'First day', amount: 20 },
    { transactionId: 'far', date: '2026-12-01', name: 'After range', amount: 1 },
    { transactionId: 'old', date: '2026-10-31', name: 'Before range', amount: 1 }
];

describe('selectClearedTransactions', () => {
    test('keeps only cleared rows, range inclusive, sorted by date', () => {
        const out = selectClearedTransactions(txs, '2026-11-01', '2026-11-30', isClearedFn, clearedAtFn);
        expect(out.map(r => r.name)).toEqual(['First day', 'Rent', 'Last day']);
        expect(out[1]).toEqual({ date: '2026-11-05', name: 'Rent', amount: -1200, clearedAt: '2026-11-05T10:00:00Z' });
    });
    test('no cleared transactions gives an empty list', () => {
        expect(selectClearedTransactions(txs, '2026-11-01', '2026-11-30', () => false, () => null)).toEqual([]);
    });
    test('missing range or non-array input is safe', () => {
        expect(selectClearedTransactions(txs, '', '2026-11-30', isClearedFn, clearedAtFn)).toEqual([]);
        expect(selectClearedTransactions(null, '2026-11-01', '2026-11-30', isClearedFn, clearedAtFn)).toEqual([]);
    });
});

describe('effectiveStatementStart', () => {
    test('uses the stored start date', () => {
        expect(effectiveStatementStart({ statementStartDate: '2026-11-03', statementEndDate: '2026-11-30' })).toBe('2026-11-03');
    });
    test('legacy entry with null start falls back to the first of the end month', () => {
        expect(effectiveStatementStart({ statementStartDate: null, statementEndDate: null, date: '2026-09-17' })).toBe('2026-09-01');
    });
    test('no dates at all gives an empty string', () => {
        expect(effectiveStatementStart({})).toBe('');
        expect(effectiveStatementStart(null)).toBe('');
    });
});

describe('csvTextField', () => {
    test('quotes and doubles embedded quotes', () => {
        expect(csvTextField('say "hi", ok')).toBe('"say ""hi"", ok"');
    });
    test.each(['=HYPERLINK("http://evil","x")', '+1+1', '-2+3', '@SUM(A1)', '\tcmd'])('guards formula start %j', v => {
        expect(csvTextField(v).startsWith('"\'')).toBe(true);
    });
    test('plain text and null are untouched', () => {
        expect(csvTextField('Rent')).toBe('"Rent"');
        expect(csvTextField(null)).toBe('""');
    });
});

describe('buildReconciliationCsv', () => {
    const account = { id: 1, name: 'Checking' };
    const entry = {
        id: 9, accountId: 1, date: '2026-11-30', statementStartDate: '2026-11-01', statementEndDate: '2026-11-30',
        previousBalance: 1000, statementBalance: 1250.5, difference: 250.5, note: '=HYPERLINK("http://evil","click")'
    };
    const history = [
        entry,
        { id: 3, accountId: 1, date: '2026-10-31', statementBalance: 900, difference: -100, note: 'earlier' },
        { id: 4, accountId: 2, date: '2026-10-31', statementBalance: 5, difference: 0, note: 'other account' }
    ];
    const report = buildReconciliationReport({ account, entry, transactions: txs, history, isClearedFn, clearedAtFn });
    const csv = buildReconciliationCsv(report);

    test('has summary, cleared rows and only this account\'s history, oldest first', () => {
        expect(csv).toContain('"Account","Checking"');
        expect(csv).toContain('"Statement Start","2026-11-01"');
        expect(csv).toContain('"Statement Balance","1250.50"');
        expect(csv).toContain('"Difference","250.50"');
        expect(csv).toContain('"2026-11-05","Rent","-1200.00","2026-11-05T10:00:00Z"');
        expect(csv).toContain('"2026-11-30","Last day","10.00"');
        expect(csv).not.toContain('Uncleared');
        expect(csv).not.toContain('After range');
        expect(csv).not.toContain('Before range');
        expect(csv).not.toContain('other account');
        expect(csv.indexOf('"2026-10-31","900.00"')).toBeLessThan(csv.indexOf('"2026-11-30","1250.50"'));
    });
    test('malicious note is neutralised as a formula', () => {
        expect(csv).toContain('"\'=HYPERLINK(""http://evil"",""click"")"');
        expect(csv).not.toMatch(/,"=HYPERLINK/);
    });
    test('header rows stay English', () => {
        expect(csv).toContain('"Date","Name","Amount","Cleared At"');
        expect(csv).toContain('"Date","Statement Balance","Difference","Note"');
    });
    test('legacy record with null start and an unknown account does not throw', () => {
        const legacy = { id: 1, accountId: 99, date: '2026-11-30', statementStartDate: null, statementEndDate: null, previousBalance: 0, statementBalance: 5, difference: 5, note: '' };
        const r = buildReconciliationReport({ account: null, entry: legacy, transactions: txs, history: [legacy], isClearedFn, clearedAtFn });
        expect(r.start).toBe('2026-11-01');
        expect(r.accountName).toBe('');
        expect(buildReconciliationCsv(r)).toContain('"Account",""');
    });
    test('no cleared transactions leaves only the header row in that section', () => {
        const r = buildReconciliationReport({ account, entry, transactions: txs, history: [], isClearedFn: () => false, clearedAtFn: () => null });
        expect(r.cleared).toEqual([]);
        expect(buildReconciliationCsv(r)).not.toContain('"Rent"');
    });
});

describe('reconciliationFilename', () => {
    test('makes the account name filename-safe', () => {
        expect(reconciliationFilename('Chase / Checking: "Main"', '2026-11-30')).toBe('reconciliation-chase-checking-main-2026-11-30.csv');
    });
    test('strips accents and falls back for empty or hostile names', () => {
        expect(reconciliationFilename('Crédito Ñandú', '2026-11-30')).toBe('reconciliation-credito-nandu-2026-11-30.csv');
        expect(reconciliationFilename('../../etc', '2026-11-30')).toBe('reconciliation-etc-2026-11-30.csv');
        expect(reconciliationFilename('???', '2026-11-30')).toBe('reconciliation-account-2026-11-30.csv');
    });
});
