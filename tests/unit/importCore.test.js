// Unit tests for the import algorithm (#529): src/importCore.js with an
// in-memory fake store, so ordering, remapping, dedupe and failure behaviour are
// checked without a server. The real store (a database transaction) is covered
// by server/test/import.test.js.
import { runImport, CRUD_RESOURCES, remapFk, toWireJson } from '../../src/importCore.js';

// A store that numbers every created record from 100 and logs each call.
function makeStore({ failOn = null } = {}) {
    const calls = [];
    const created = {};
    const keyed = [];
    const milestones = [];
    let patch = null;
    let next = 100;
    const log = (name, detail) => calls.push(detail === undefined ? name : `${name}:${detail}`);
    const store = {
        async deleteAll() { log('deleteAll'); },
        async create(field, record, index) {
            log('create', field);
            if (failOn && failOn(field, record, index)) throw new Error(`rejected ${field}[${index}]`);
            const row = { ...record, id: next++ };
            (created[field] = created[field] || []).push({ input: record, row, index });
            return row;
        },
        async putKeyed(kind, key, value) { log('putKeyed', kind); keyed.push({ kind, key, value }); return value; },
        async addMilestone(m) { log('addMilestone'); milestones.push(m); },
        async patchPlanSettings(p) { log('patchPlanSettings'); patch = p; },
    };
    return { store, calls, created, keyed, milestones, getPatch: () => patch };
}

const rows = (h, field) => (h.created[field] || []).map(c => c.row);
const inputs = (h, field) => (h.created[field] || []).map(c => c.input);

const baseData = () => ({
    accounts: [{ id: 1, name: 'Checking' }, { id: 2, name: 'Savings' }],
    persons: [{ id: 7, name: 'Sam' }],
    debts: [{ id: 10, name: 'Visa', accountId: 1, personIds: [7] }],
    incomes: [{ id: 20, name: 'Job', accountId: 1, personId: 7 }],
    transfers: [{ id: 30, fromAccountId: 1, toAccountId: 2, amount: 5, date: '2026-01-02' }],
    planHistory: [{ id: 40, createdAt: '2026-01-01T00:00:00.000Z', debts: [{ debtId: 10, name: 'Visa' }, { debtId: 99, name: 'Gone' }] }],
    ledgerAmountOverrides: { 'debt|10|1|2026-01-05': { amount: 9 } },
    ledgerClearedTransactions: { 'income|20|1|2026-01-06': { clearedAt: '2026-01-06T00:00:00.000Z' } },
    monthlySnapshots: [{ date: '2026-01-01', netWorth: 10 }],
    settings: [{ key: 'surplusAccountId', value: 2 }, { key: 'theme', value: 'dark' }],
    netWorthMilestonesAwarded: [5000, 10000],
    perMonthStimulus: [1, 2],
    ledgerSettings: { pageSize: 50 },
    forecastSettings: { rangeMonths: 3 },
    retirementTargetDate: '2050-01-01',
    homePurchasePlan: { targetHomePrice: 300000 },
    budgetCategories: { Food: 400 },
    balanceHistory: [
        { debtId: 10, accountId: null, date: '2026-01-01', balance: 90 },
        { debtId: null, accountId: 2, date: '2026-01-01', balance: 5 },
        { debtId: 55, accountId: null, date: '2026-01-01', balance: 1 },
    ],
});

describe('CRUD_RESOURCES', () => {
    test('keeps the creation order and has no duplicates', () => {
        expect(CRUD_RESOURCES.map(r => r.field)).toEqual([
            'debts', 'incomes', 'bonuses', 'bills', 'expenses', 'recurringTemplates', 'emergencyFunds',
            'sinkingFunds', 'reconciliations', 'planHistory', 'retirementSnapshots', 'transfers', 'manualTransactions',
        ]);
        expect(new Set(CRUD_RESOURCES.map(r => r.path)).size).toBe(CRUD_RESOURCES.length);
    });
});

describe('runImport replace', () => {
    test('wipes first, then creates accounts, persons, collections, keyed, milestones, plan settings, balance history', async () => {
        const h = makeStore();
        await runImport({ mode: 'replace', data: baseData(), strategy: null, store: h.store });
        expect(h.calls[0]).toBe('deleteAll');
        const idx = name => h.calls.indexOf(name);
        const last = name => h.calls.lastIndexOf(name);
        expect(last('create:accounts')).toBeLessThan(idx('create:persons'));
        expect(last('create:persons')).toBeLessThan(idx('create:debts'));
        expect(last('create:debts')).toBeLessThan(idx('create:incomes'));
        expect(last('create:incomes')).toBeLessThan(idx('create:planHistory'));
        expect(last('create:planHistory')).toBeLessThan(idx('create:transfers'));
        expect(last('create:transfers')).toBeLessThan(idx('putKeyed:ledgerOverride'));
        expect(last('putKeyed:ledgerOverride')).toBeLessThan(idx('putKeyed:ledgerCleared'));
        expect(last('putKeyed:ledgerCleared')).toBeLessThan(idx('putKeyed:netWorthSnapshot'));
        expect(last('putKeyed:netWorthSnapshot')).toBeLessThan(idx('putKeyed:setting'));
        expect(last('putKeyed:setting')).toBeLessThan(idx('addMilestone'));
        expect(last('addMilestone')).toBeLessThan(idx('patchPlanSettings'));
        expect(idx('patchPlanSettings')).toBeLessThan(idx('create:balanceHistory'));
    });

    test('remaps account, person and transfer foreign keys to the created ids', async () => {
        const h = makeStore();
        await runImport({ mode: 'replace', data: baseData(), store: h.store });
        const [checking, savings] = rows(h, 'accounts');
        const [sam] = rows(h, 'persons');
        expect(inputs(h, 'debts')[0]).toMatchObject({ accountId: checking.id, personIds: [sam.id] });
        expect(inputs(h, 'incomes')[0]).toMatchObject({ accountId: checking.id, personId: sam.id });
        expect(inputs(h, 'transfers')[0]).toMatchObject({ fromAccountId: checking.id, toAccountId: savings.id });
    });

    test('an unresolved person becomes null on an income', async () => {
        const h = makeStore();
        const data = baseData();
        data.incomes[0].personId = 404;
        await runImport({ mode: 'replace', data, store: h.store });
        expect(inputs(h, 'incomes')[0].personId).toBeNull();
    });

    test('remaps Plan History debt ids and nulls the unknown ones (#312)', async () => {
        const h = makeStore();
        await runImport({ mode: 'replace', data: baseData(), store: h.store });
        const newDebtId = rows(h, 'debts')[0].id;
        expect(inputs(h, 'planHistory')[0].debts.map(d => d.debtId)).toEqual([newDebtId, null]);
    });

    test('rewrites Ledger keys to the created ids (#520)', async () => {
        const h = makeStore();
        const warnings = (await runImport({ mode: 'replace', data: baseData(), store: h.store })).warnings;
        const acct = rows(h, 'accounts')[0].id;
        const debt = rows(h, 'debts')[0].id;
        const income = rows(h, 'incomes')[0].id;
        expect(h.keyed.find(k => k.kind === 'ledgerOverride').key).toBe(`debt|${debt}|${acct}|2026-01-05`);
        expect(h.keyed.find(k => k.kind === 'ledgerCleared').key).toBe(`income|${income}|${acct}|2026-01-06`);
        expect(warnings).toEqual([]);
    });

    test('drops Ledger keys of records not in the file, with one warning each', async () => {
        const h = makeStore();
        const data = baseData();
        data.ledgerAmountOverrides['debt|999|1|2026-02-01'] = { amount: 1 };
        data.ledgerClearedTransactions['bill|888|1|2026-02-01'] = { clearedAt: '2026-02-01T00:00:00.000Z' };
        const { warnings } = await runImport({ mode: 'replace', data, store: h.store });
        expect(h.keyed.filter(k => k.kind === 'ledgerOverride')).toHaveLength(1);
        expect(h.keyed.filter(k => k.kind === 'ledgerCleared')).toHaveLength(1);
        expect(warnings.map(w => w.recordType)).toEqual(['Ledger Override', 'Ledger Cleared Flag']);
        expect(warnings.every(w => w.kind === 'rejected')).toBe(true);
    });

    test('remaps an account-id setting, and warns when its account is not in the file (#651)', async () => {
        const h = makeStore();
        await runImport({ mode: 'replace', data: baseData(), store: h.store });
        const savings = rows(h, 'accounts')[1].id;
        expect(h.keyed.find(k => k.kind === 'setting' && k.key === 'surplusAccountId').value.value).toBe(savings);

        const h2 = makeStore();
        const data = baseData();
        data.settings = [{ key: 'surplusAccountId', value: 404 }];
        const { warnings } = await runImport({ mode: 'replace', data, store: h2.store });
        expect(h2.keyed.filter(k => k.kind === 'setting')).toHaveLength(0);
        expect(warnings).toEqual([{ recordType: 'Setting', recordName: 'surplusAccountId', kind: 'rejected', reason: 'account not in import' }]);
    });

    test('skips a setting the schema does not allow', async () => {
        const h = makeStore();
        const data = baseData();
        data.settings = [{ key: 'notARealSetting', value: 1 }];
        await runImport({ mode: 'replace', data, store: h.store });
        expect(h.keyed.filter(k => k.kind === 'setting')).toHaveLength(0);
    });

    test('creates balance history after debts, remapped to the created owners, dropping unknown owners', async () => {
        const h = makeStore();
        await runImport({ mode: 'replace', data: baseData(), store: h.store });
        const debt = rows(h, 'debts')[0].id;
        const savings = rows(h, 'accounts')[1].id;
        expect(inputs(h, 'balanceHistory')).toEqual([
            { debtId: debt, accountId: null, date: '2026-01-01', balance: 90 },
            { debtId: null, accountId: savings, date: '2026-01-01', balance: 5 },
        ]);
    });

    test('plan settings: strategy normalized, scalars carried, milestones added', async () => {
        const h = makeStore();
        await runImport({ mode: 'replace', data: baseData(), strategy: { paymentStrategy: ' avalanche ', monthlyPayment: '450' }, store: h.store });
        expect(h.getPatch()).toEqual({
            strategy: 'avalanche', monthlyPayment: 450, perMonthStimulus: [1, 2],
            ledgerSettings: { pageSize: 50 }, forecastSettings: { rangeMonths: 3 },
            retirementTargetDate: '2050-01-01', homePurchasePlan: { targetHomePrice: 300000 },
            budgetCategories: { Food: 400 },
        });
        expect(h.milestones).toEqual([5000, 10000]);
    });

    test('an absent or invalid strategy becomes null, a non-numeric payment too', async () => {
        const h = makeStore();
        await runImport({ mode: 'replace', data: baseData(), strategy: { paymentStrategy: '', monthlyPayment: 'abc' }, store: h.store });
        expect(h.getPatch()).toMatchObject({ strategy: null, monthlyPayment: null });
    });

    test('an empty file only wipes and resets plan settings', async () => {
        const h = makeStore();
        const { warnings, skipped } = await runImport({ mode: 'replace', data: {}, store: h.store });
        expect(h.calls).toEqual(['deleteAll', 'patchPlanSettings']);
        expect(warnings).toEqual([]);
        expect(skipped).toEqual({});
        expect(h.getPatch()).toMatchObject({ strategy: null, perMonthStimulus: [], budgetCategories: {} });
    });

    test('replace never dedupes: repeated names are all created', async () => {
        const h = makeStore();
        await runImport({ mode: 'replace', data: { debts: [{ id: 1, name: 'Visa' }, { id: 2, name: 'Visa' }] }, store: h.store });
        expect(rows(h, 'debts')).toHaveLength(2);
    });
});

describe('runImport failures', () => {
    test('a store that throws mid-way rejects the import and nothing later runs', async () => {
        const h = makeStore({ failOn: field => field === 'incomes' });
        await expect(runImport({ mode: 'replace', data: baseData(), store: h.store })).rejects.toThrow('rejected incomes[0]');
        expect(h.calls).not.toContain('patchPlanSettings');
        expect(h.calls).not.toContain('create:balanceHistory');
        expect(h.keyed).toHaveLength(0);
    });

    test('the same in merge mode', async () => {
        const h = makeStore({ failOn: field => field === 'debts' });
        await expect(runImport({ mode: 'merge', data: baseData(), existing: {}, store: h.store })).rejects.toThrow('rejected debts[0]');
        expect(h.calls).not.toContain('patchPlanSettings');
    });

    test('a failing keyed put rejects too', async () => {
        const h = makeStore();
        h.store.putKeyed = async () => { throw new Error('boom'); };
        await expect(runImport({ mode: 'replace', data: baseData(), store: h.store })).rejects.toThrow('boom');
    });

    test('an unknown mode is refused before the store is touched', async () => {
        const h = makeStore();
        await expect(runImport({ mode: 'append', data: {}, store: h.store })).rejects.toThrow('Unknown import mode');
        expect(h.calls).toEqual([]);
    });

    test('passes the incoming index so a rejection can name the record', async () => {
        const h = makeStore();
        await runImport({ mode: 'replace', data: { accounts: [{ id: 1, name: 'A' }, { id: 2, name: 'B' }] }, store: h.store });
        expect(h.created.accounts.map(c => c.index)).toEqual([0, 1]);
    });
});

describe('runImport merge', () => {
    const existingState = () => ({
        accounts: [{ id: 5, name: 'checking' }],
        persons: [{ id: 6, name: 'SAM' }],
        debts: [{ id: 7, name: 'Visa' }],
        balanceHistory: [{ debtId: 7, accountId: null, date: '2026-01-01', balance: 1 }],
        budgetCategories: { Rent: 1000, Food: 100 },
        retirementTargetDate: '2060-06-01',
        homePurchasePlan: { targetHomePrice: 1 },
    });

    test('never wipes, and creates only records whose natural key is new', async () => {
        const h = makeStore();
        const { skipped } = await runImport({ mode: 'merge', data: baseData(), existing: existingState(), store: h.store });
        expect(h.calls).not.toContain('deleteAll');
        expect(inputs(h, 'accounts').map(a => a.name)).toEqual(['Savings']);
        expect(created(h, 'persons')).toBe(0);
        expect(created(h, 'debts')).toBe(0);
        expect(skipped).toEqual({ accounts: 1, persons: 1, debts: 1 });
    });

    test('a matched account resolves references to the existing id', async () => {
        const h = makeStore();
        await runImport({ mode: 'merge', data: baseData(), existing: existingState(), store: h.store });
        expect(inputs(h, 'incomes')[0]).toMatchObject({ accountId: 5, personId: 6 });
        const savings = rows(h, 'accounts')[0].id;
        expect(inputs(h, 'transfers')[0]).toMatchObject({ fromAccountId: 5, toAccountId: savings });
    });

    test('Ledger keys of a matched record attach to the surviving record', async () => {
        const h = makeStore();
        await runImport({ mode: 'merge', data: baseData(), existing: existingState(), store: h.store });
        expect(h.keyed.find(k => k.kind === 'ledgerOverride').key).toBe('debt|7|5|2026-01-05');
    });

    test('in-file repeats are created once and later references follow the first (#478)', async () => {
        const h = makeStore();
        const data = {
            accounts: [{ id: 1, name: 'Main' }, { id: 2, name: 'main' }],
            debts: [{ id: 10, name: 'Card', accountId: 2 }],
            ledgerAmountOverrides: { 'interest|2|2|2026-03-01': { amount: 1 } },
        };
        const { skipped } = await runImport({ mode: 'merge', data, existing: {}, store: h.store });
        expect(rows(h, 'accounts')).toHaveLength(1);
        expect(skipped).toEqual({ accounts: 1 });
        const id = rows(h, 'accounts')[0].id;
        expect(inputs(h, 'debts')[0].accountId).toBe(id);
        expect(h.keyed[0].key).toBe(`interest|${id}|${id}|2026-03-01`);
    });

    test('balance history follows debts by name and leaves out entries the user already has', async () => {
        const h = makeStore();
        const data = {
            debts: [{ id: 10, name: 'visa' }, { id: 11, name: 'Loan' }],
            balanceHistory: [
                { debtId: 10, accountId: null, date: '2026-01-01', balance: 5 },
                { debtId: 10, accountId: null, date: '2026-02-01', balance: 4 },
                { debtId: 11, accountId: null, date: '2026-01-01', balance: 9 },
            ],
        };
        await runImport({ mode: 'merge', data, existing: existingState(), store: h.store });
        const loan = rows(h, 'debts')[0].id;
        expect(inputs(h, 'balanceHistory')).toEqual([
            { debtId: 7, accountId: null, date: '2026-02-01', balance: 4 },
            { debtId: loan, accountId: null, date: '2026-01-01', balance: 9 },
        ]);
    });

    test('plan settings: budget categories merge key by key, optional plan fields only when present', async () => {
        const h = makeStore();
        const data = { budgetCategories: { Food: 400, Fun: 50 }, ledgerSettings: { pageSize: 10 }, perMonthStimulus: [3] };
        await runImport({ mode: 'merge', data, existing: existingState(), strategy: { paymentStrategy: 'snowball', monthlyPayment: 300 }, store: h.store });
        expect(h.getPatch()).toEqual({
            strategy: 'snowball', monthlyPayment: 300, perMonthStimulus: [3],
            ledgerSettings: { pageSize: 10 }, forecastSettings: undefined,
            retirementTargetDate: '2060-06-01', homePurchasePlan: { targetHomePrice: 1 },
            budgetCategories: { Rent: 1000, Food: 400, Fun: 50 },
        });
    });

    test('plan settings: a date or plan in the file replaces the existing one', async () => {
        const h = makeStore();
        await runImport({ mode: 'merge', data: { retirementTargetDate: '2045-01-01', homePurchasePlan: { targetHomePrice: 9 } }, existing: existingState(), store: h.store });
        expect(h.getPatch()).toMatchObject({ retirementTargetDate: '2045-01-01', homePurchasePlan: { targetHomePrice: 9 } });
    });

    test('plan settings: nothing in the file and nothing existing stays null', async () => {
        const h = makeStore();
        await runImport({ mode: 'merge', data: {}, existing: {}, store: h.store });
        expect(h.getPatch()).toMatchObject({ retirementTargetDate: null, homePurchasePlan: null, budgetCategories: {} });
    });

    test('keyed entries and milestones are still applied', async () => {
        const h = makeStore();
        await runImport({ mode: 'merge', data: baseData(), existing: existingState(), store: h.store });
        expect(h.keyed.map(k => k.kind)).toEqual(['ledgerOverride', 'ledgerCleared', 'netWorthSnapshot', 'setting']);
        expect(h.milestones).toEqual([5000, 10000]);
    });

    test('the existing state is not modified', async () => {
        const h = makeStore();
        const existing = existingState();
        const before = JSON.stringify(existing);
        await runImport({ mode: 'merge', data: baseData(), existing, store: h.store });
        expect(JSON.stringify(existing)).toBe(before);
    });

    test('a record without a natural key is always created', async () => {
        const h = makeStore();
        const data = { debts: [{ id: 1, name: '' }, { id: 2, name: '' }] };
        await runImport({ mode: 'merge', data, existing: { debts: [{ id: 7, name: '' }] }, store: h.store });
        expect(rows(h, 'debts')).toHaveLength(2);
    });
});

describe('remapFk', () => {
    test('leaves an id it has no mapping for untouched', () => {
        expect(remapFk({ accountId: 3, targetAccountId: 4 }, { 3: 30 })).toEqual({ accountId: 30, targetAccountId: 4 });
    });
});

function created(h, field) {
    return (h.created[field] || []).length;
}

describe('toWireJson', () => {
    test('writes a local-midnight Date (an expense date) as its calendar date, in any time zone', () => {
        const json = JSON.parse(toWireJson({ expenses: [{ date: new Date(2026, 7, 1) }, { date: new Date(2026, 0, 31) }] }));
        expect(json.expenses.map(e => e.date)).toEqual(['2026-08-01', '2026-01-31']);
    });

    test('a Date that is not local midnight keeps its full ISO instant', () => {
        const d = new Date(Date.UTC(2026, 7, 1, 13, 45, 6, 7));
        expect(JSON.parse(toWireJson({ at: d })).at).toBe(d.toISOString());
    });

    test('an invalid Date stays null like JSON.stringify writes it, and other values are untouched', () => {
        expect(JSON.parse(toWireJson({ bad: new Date('nope'), n: 1, s: 'x', nested: { list: [1, null] }, u: undefined })))
            .toEqual({ bad: null, n: 1, s: 'x', nested: { list: [1, null] } });
    });

    test('a string that merely looks like a date is not changed', () => {
        expect(JSON.parse(toWireJson({ d: '2026-08-01T00:00:00.000Z' })).d).toBe('2026-08-01T00:00:00.000Z');
    });
});
