// #587: in-progress reconciliations and Ledger hidden columns move to the server.
const {
    sanitizeReconDraft, sanitizeReconDrafts,
    RECON_DRAFTS_MAX_ACCOUNTS, RECON_DRAFT_MAX_CLEARED, RECON_DRAFT_KEY_MAX,
} = require('../../src/sanitizers.js');
const {
    isValidLedgerHiddenColumns, isAllowedSetting, validateExportedSetting,
    LEDGER_TABLE_COLUMNS, LEDGER_HIDDEN_COLUMNS,
} = require('../../src/settingsSchema.js');
const { buildPlanSettingsPatch, PLAN_SETTINGS_FIELDS } = require('../../src/planSettingsPatch.js');

describe('sanitizeReconDraft', () => {
    const full = {
        statementBalance: '1234.56', statementStartDate: '2026-06-01', statementEndDate: '2026-06-30',
        note: 'Checked bank app', clearedTxIds: ['debt|1|9|2026-06-05'], savedAt: '2026-06-15T00:00:00.000Z',
    };

    test('a valid draft round-trips', () => {
        expect(sanitizeReconDraft(full)).toEqual(full);
    });

    test('a numeric balance is kept as its string form', () => {
        expect(sanitizeReconDraft({ statementBalance: 12.5 }).statementBalance).toBe('12.5');
        expect(sanitizeReconDraft({ statementBalance: NaN }).statementBalance).toBe('');
        expect(sanitizeReconDraft({ statementBalance: Infinity }).statementBalance).toBe('');
        expect(sanitizeReconDraft({ statementBalance: { a: 1 } }).statementBalance).toBe('');
        expect(sanitizeReconDraft({ statementBalance: 'x'.repeat(50) }).statementBalance).toHaveLength(30);
    });

    test('missing fields get safe defaults', () => {
        expect(sanitizeReconDraft({})).toEqual({
            statementBalance: '', statementStartDate: null, statementEndDate: null,
            note: '', clearedTxIds: [], savedAt: null,
        });
    });

    test('bad dates and savedAt become null; savedAt is normalized', () => {
        const d = sanitizeReconDraft({ statementStartDate: '2026-13-45', statementEndDate: 'soon', savedAt: 'never' });
        expect(d.statementStartDate).toBeNull();
        expect(d.statementEndDate).toBeNull();
        expect(d.savedAt).toBeNull();
        expect(sanitizeReconDraft({ savedAt: '2026-06-15T10:00:00+02:00' }).savedAt).toBe('2026-06-15T08:00:00.000Z');
    });

    test('the note is normalized and capped at 200', () => {
        expect(sanitizeReconDraft({ note: '<b>hi</b>' }).note).toBe('bhi/b');
        expect(sanitizeReconDraft({ note: 'n'.repeat(500) }).note).toHaveLength(200);
    });

    test('cleared keys: strings only, deduped, unaltered, capped', () => {
        const d = sanitizeReconDraft({ clearedTxIds: ['a', 'a', 5, null, '', ' b', 'c<', 'k'.repeat(RECON_DRAFT_KEY_MAX + 1), 'd'] });
        expect(d.clearedTxIds).toEqual(['a', 'd']);
        const many = Array.from({ length: RECON_DRAFT_MAX_CLEARED + 10 }, (_, i) => `k${i}`);
        expect(sanitizeReconDraft({ clearedTxIds: many }).clearedTxIds).toHaveLength(RECON_DRAFT_MAX_CLEARED);
        expect(sanitizeReconDraft({ clearedTxIds: 'a,b' }).clearedTxIds).toEqual([]);
    });

    test.each([[null], [undefined], ['x'], [5], [[]], [true]])('non-object %p is null', v => {
        expect(sanitizeReconDraft(v)).toBeNull();
    });
});

describe('sanitizeReconDrafts', () => {
    test('keeps positive integer account keys with object values', () => {
        const out = sanitizeReconDrafts({ 7: { note: 'a' }, 12: { note: 'b' } });
        expect(Object.keys(out)).toEqual(['7', '12']);
        expect(out[7].note).toBe('a');
    });

    test('drops bad keys and bad values', () => {
        const input = JSON.parse('{"0":{},"-1":{},"1.5":{},"abc":{},"__proto__":{},"07":{},"99999999999999999":{},"5":"x","6":[1],"8":{}}');
        expect(Object.keys(sanitizeReconDrafts(input))).toEqual(['8']);
        expect(Object.getPrototypeOf(sanitizeReconDrafts(input))).toBe(Object.prototype);
    });

    test('caps the number of accounts', () => {
        const input = Object.fromEntries(Array.from({ length: RECON_DRAFTS_MAX_ACCOUNTS + 5 }, (_, i) => [String(i + 1), {}]));
        expect(Object.keys(sanitizeReconDrafts(input))).toHaveLength(RECON_DRAFTS_MAX_ACCOUNTS);
    });

    test.each([[null], [undefined], ['x'], [5], [[{}]]])('non-object %p is {}', v => {
        expect(sanitizeReconDrafts(v)).toEqual({});
    });
});

describe('ledgerHiddenColumns setting', () => {
    test('the table columns are the six the Ledger renders', () => {
        expect(LEDGER_TABLE_COLUMNS).toEqual(['date', 'account', 'name', 'amount', 'balance', 'cleared']);
        expect(LEDGER_HIDDEN_COLUMNS).toBe('ledgerHiddenColumns');
    });

    test.each(['', 'account', 'account,cleared', 'date,account,name,amount,balance'])('%p is valid', v => {
        expect(isValidLedgerHiddenColumns(v)).toBe(true);
        expect(validateExportedSetting(LEDGER_HIDDEN_COLUMNS, v)).toBe(true);
        expect(isAllowedSetting(LEDGER_HIDDEN_COLUMNS, v)).toBe(true);
    });

    test.each([
        ['date,account,name,amount,balance,cleared'], // nothing left visible
        ['account,account'], ['bogus'], ['account,'], [',account'], ['Account'],
        [null], [undefined], [3], [['account']],
    ])('%p is invalid', v => {
        expect(isValidLedgerHiddenColumns(v)).toBe(false);
        expect(isAllowedSetting(LEDGER_HIDDEN_COLUMNS, v)).toBe(false);
    });
});

describe('buildPlanSettingsPatch reconDrafts', () => {
    test('is a plan-settings field', () => {
        expect(PLAN_SETTINGS_FIELDS).toContain('reconDrafts');
    });

    test('sends the whole map, or {} when unset', () => {
        const drafts = { 7: { note: 'a' } };
        expect(buildPlanSettingsPatch({ reconDrafts: drafts }, ['reconDrafts']).body).toEqual({ reconDrafts: drafts });
        expect(buildPlanSettingsPatch({}, ['reconDrafts']).body).toEqual({ reconDrafts: {} });
    });

    test('is never sent unless named', () => {
        expect(buildPlanSettingsPatch({ reconDrafts: { 7: {} } }, ['budgetCategories']).body).toEqual({ budgetCategories: {} });
    });
});
