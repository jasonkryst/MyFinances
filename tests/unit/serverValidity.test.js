// #568 / #569: the validity predicates and the settings allowlist shared by
// import (sanitizeParsedState) and the server routes.
import {
    sanitizeTransfer, sanitizeReconciliation, sanitizeRecurringTemplate,
    isValidTransfer, isValidReconciliation, isValidRecurringTemplate, sanitizeParsedState
} from '../../src/sanitizers.js';
import { isAllowedSetting, validateExportedSetting } from '../../src/settingsSchema.js';

const transfer = (o) => sanitizeTransfer({ fromAccountId: 1, toAccountId: 2, amount: 10, ...o }, 1);
const recon = (o) => sanitizeReconciliation({ accountId: 1, statementBalance: 100, ...o }, 1);
const tmpl = (o) => sanitizeRecurringTemplate({ name: 'N', type: 'transfer', amount: 5, accountId: 1, targetAccountId: 2, ...o }, 1);

describe('isValidTransfer', () => {
    test('accepts a positive amount between two different accounts', () => {
        expect(isValidTransfer(transfer({}))).toBe(true);
        expect(isValidTransfer(transfer({ amount: 0.01 }))).toBe(true);
        expect(isValidTransfer(transfer({ amount: 1e9 }))).toBe(true);
    });
    test.each([
        ['same account', { toAccountId: 1 }],
        ['no from account', { fromAccountId: null }],
        ['no to account', { toAccountId: null }],
        ['zero amount', { amount: 0 }],
        ['negative amount', { amount: -50 }],
        ['missing amount', { amount: undefined }],
        ['non-numeric amount', { amount: 'abc' }],
        ['amount over 1e9', { amount: 1e9 + 1 }],
    ])('rejects %s', (_l, o) => {
        expect(isValidTransfer(transfer(o))).toBe(false);
    });
    test('rejects null/undefined', () => {
        expect(isValidTransfer(null)).toBe(false);
        expect(isValidTransfer(undefined)).toBe(false);
    });
});

describe('isValidReconciliation', () => {
    test.each([[0], [-250.5], [100]])('accepts statementBalance %p', (b) => {
        expect(isValidReconciliation(recon({ statementBalance: b }))).toBe(true);
    });
    test.each([
        ['missing balance', { statementBalance: undefined }],
        ['non-numeric balance', { statementBalance: 'abc' }],
        ['null balance', { statementBalance: null }],
        ['no account', { accountId: null }],
    ])('rejects %s', (_l, o) => {
        expect(isValidReconciliation(recon(o))).toBe(false);
    });
    test('rejects null', () => expect(isValidReconciliation(null)).toBe(false));
});

describe('isValidRecurringTemplate', () => {
    test('accepts a valid transfer', () => expect(isValidRecurringTemplate(tmpl({}))).toBe(true));
    test.each([
        ['no target', { targetAccountId: null }],
        ['target equals account', { targetAccountId: 1 }],
        ['zero amount', { amount: 0 }],
        ['missing amount', { amount: undefined }],
        ['blank name', { name: '  ' }],
    ])('rejects a transfer with %s', (_l, o) => {
        expect(isValidRecurringTemplate(tmpl(o))).toBe(false);
    });
    test.each(['subscription', 'income', 'reimbursement'])('keeps allowing a $0 %s with no target (zeroAmountPolicy is client-side)', (type) => {
        expect(isValidRecurringTemplate(tmpl({ type, amount: 0, targetAccountId: null }))).toBe(true);
    });
    test('a non-transfer still needs a name', () => {
        expect(isValidRecurringTemplate(tmpl({ type: 'subscription', name: '' }))).toBe(false);
    });
    test('an unlinked transfer (no account) with a target is allowed', () => {
        expect(isValidRecurringTemplate(tmpl({ accountId: null }))).toBe(true);
    });
    test('rejects null', () => expect(isValidRecurringTemplate(null)).toBe(false));
});

describe('isAllowedSetting', () => {
    test.each([
        ['showArchivedDebts', true], ['reconciliationAdjustsBalance', false], ['zeroAmountPolicy', 'block'],
        ['fireMultiplier', 25], ['surplusWindowDays', 90], ['surplusCushionPct', 0], ['retirementWithdrawalRate', 4],
        ['retirementCoastTarget', 0], ['healthHousingCostOverride', 1500], ['ledgerExportColumns', 'date,amount'],
        ['bct:groceries:healthy', 50], ['bct:groceries:warn', 100], ['surplusAccountId', 7],
    ])('allows %s=%p', (k, v) => expect(isAllowedSetting(k, v)).toBe(true));

    test.each([
        ['totallyUnknown', 'x'], ['debtTrackerStorageBackend', 'postgres'], ['__proto__', 1], ['constructor', 1],
        ['fireMultiplier', 5000], ['fireMultiplier', 0], ['zeroAmountPolicy', 'nope'], ['surplusWindowDays', 3],
        ['surplusWindowDays', 30.5], ['showArchivedDebts', 'yes'], ['ledgerExportColumns', 'date,bogus'],
        ['bct:groceries:healthy', 150], ['bct:groceries:other', 5], ['bct:' + 'a'.repeat(61) + ':warn', 5],
        ['surplusAccountId', 0], ['surplusAccountId', -1], ['surplusAccountId', 1.5], ['surplusAccountId', '3'],
        ['surplusAccountId', null], ['zeroAmountPolicy', 'a'.repeat(5000)], ['junk', 'a'.repeat(5000)], [5, 5],
    ])('rejects %s=%p', (k, v) => expect(isAllowedSetting(k, v)).toBe(false));

    test('delegates to the export schema', () => {
        expect(validateExportedSetting('surplusAccountId', 7)).toBe(false);
        expect(isAllowedSetting('surplusAccountId', 7)).toBe(true);
    });
});

describe('sanitizeParsedState drops what the server would reject, with a rejected warning', () => {
    const rejected = (warnings, type) => warnings.filter(w => w.kind === 'rejected' && w.recordType === type);
    const base = { accounts: [{ id: 1, name: 'A', type: 'checking' }, { id: 2, name: 'B', type: 'savings' }] };

    test('transfers', () => {
        const warnings = [];
        const state = sanitizeParsedState({ ...base, transfers: [
            { id: 1, fromAccountId: 1, toAccountId: 1, amount: 5, date: '2026-01-01' },
            { id: 2, fromAccountId: 1, toAccountId: 2, amount: -5, date: '2026-01-01' },
            { id: 3, fromAccountId: 1, toAccountId: 2, amount: 5, date: '2026-01-01' },
        ] }, warnings);
        expect(state.transfers.map(t => t.id)).toEqual([3]);
        expect(rejected(warnings, 'Transfer')).toHaveLength(2);
    });

    test('recurring templates: targetless transfer rejected, $0 subscription kept', () => {
        const warnings = [];
        const state = sanitizeParsedState({ ...base, recurringTemplates: [
            { id: 1, name: 'Bad', type: 'transfer', amount: 5, accountId: 1 },
            { id: 2, name: 'Good', type: 'transfer', amount: 5, accountId: 1, targetAccountId: 2 },
            { id: 3, name: 'Free', type: 'subscription', amount: 0, accountId: 1 },
        ] }, warnings);
        expect(state.recurringTemplates.map(t => t.name)).toEqual(['Good', 'Free']);
        expect(rejected(warnings, 'Recurring Template')).toHaveLength(1);
    });

    test('reconciliations without a finite statementBalance', () => {
        const warnings = [];
        const state = sanitizeParsedState({ ...base, reconciliations: [
            { id: 1, accountId: 1, date: '2026-01-01' },
            { id: 2, accountId: 1, date: '2026-01-01', statementBalance: 0 },
        ] }, warnings);
        expect(state.reconciliations.map(r => r.id)).toEqual([2]);
        expect(rejected(warnings, 'Reconciliation')).toHaveLength(1);
    });

    test('settings: unknown keys and out-of-range values dropped, valid kept', () => {
        const warnings = [];
        const state = sanitizeParsedState({ settings: [
            { key: 'debtTrackerStorageBackend', value: 'postgres' },
            { key: 'fireMultiplier', value: 5000 },
            { key: 'fireMultiplier', value: 30 },
            { key: 'surplusAccountId', value: 4 },
            { key: 'showArchivedDebts', value: true },
        ] }, warnings);
        expect(state.settings).toEqual([
            { key: 'fireMultiplier', value: 30 },
            { key: 'surplusAccountId', value: 4 },
            { key: 'showArchivedDebts', value: true },
        ]);
        expect(rejected(warnings, 'Setting')).toHaveLength(2);
    });
});
