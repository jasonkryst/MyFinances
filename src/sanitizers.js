// Sanitizers for persisted/imported record shapes — run on both load and import.

import { normalizeText, sanitizeFiniteNumber, sanitizeInteger, sanitizeDateISO, sanitizeTimestampISO, todayISO } from './utils.js';

const RETIREMENT_SUBTYPES = ['401k', 'Traditional IRA', 'Roth IRA', 'HSA', 'Pension', 'Other'];

// --- Import warning collection (issue #291) -------------------------------
// sanitizeParsedState's warnings param is opt-in and defaults to undefined so
// the normal load/import path (and every individual sanitizeX export above)
// stays exactly as pure/side-effect-free as before when a caller doesn't ask
// for warnings. These helpers live here (not scattered through dataExport.js)
// because only the per-collection map/filter call sites know *why* a record
// was dropped; that information doesn't survive the filter.
function _valuesDiffer(a, b) {
    if (a === b) return false;
    try { return JSON.stringify(a) !== JSON.stringify(b); } catch { return true; }
}

// Diffs every key present on the raw input against the sanitized output,
// pushing one 'coerced' warning per differing field. Keys absent from `raw`
// are never visited, so fields that were merely defaulted (not supplied at
// all) never produce a false-positive warning.
function _diffFields(warnings, recordType, recordName, raw, sanitized, skip = ['id']) {
    if (!warnings || !raw || typeof raw !== 'object' || !sanitized || typeof sanitized !== 'object') return;
    for (const field of Object.keys(raw)) {
        if (skip.includes(field) || !(field in sanitized)) continue;
        const from = raw[field], to = sanitized[field];
        if (_valuesDiffer(from, to)) {
            warnings.push({ recordType, recordName, kind: 'coerced', field, from, to });
        }
    }
}

function _warnLabel(raw, i, nameFieldOrFn) {
    if (typeof nameFieldOrFn === 'function') return nameFieldOrFn(raw, i);
    const value = raw && typeof raw === 'object' ? raw[nameFieldOrFn] : null;
    return value ? String(value) : `Record #${i + 1}`;
}

// Shared by every id-bearing record array (debts, accounts, incomes, ...).
// `sanitizeFn` takes (record, idFallback); `keepFn` mirrors the original
// post-map .filter() predicate so behavior is unchanged when warnings is
// omitted.
function _sanitizeRecordArray(rawList, sanitizeFn, idBase, keepFn, recordType, nameFieldOrFn, warnings, skip) {
    const rawArr = Array.isArray(rawList) ? rawList : [];
    const out = [];
    rawArr.forEach((raw, i) => {
        const sanitized = sanitizeFn(raw, idBase + i);
        const label = _warnLabel(raw, i, nameFieldOrFn);
        if (sanitized && keepFn(sanitized)) {
            out.push(sanitized);
            _diffFields(warnings, recordType, label, raw, sanitized, skip);
        } else if (warnings) {
            warnings.push({ recordType, recordName: label, kind: 'rejected', reason: 'Missing or invalid required field(s) — record was not imported.' });
        }
    });
    return out;
}

// Shared by value-only arrays with no idFallback (settings, snapshots,
// milestones, per-month stimulus). `sanitizeFn` takes (record) only.
function _sanitizeValueArray(rawList, sanitizeFn, keepFn, recordType, labelFn, warnings, skip) {
    const rawArr = Array.isArray(rawList) ? rawList : [];
    const out = [];
    rawArr.forEach((raw, i) => {
        const sanitized = sanitizeFn(raw);
        const label = labelFn(raw, i);
        if (keepFn(sanitized)) {
            out.push(sanitized);
            if (sanitized !== null && typeof sanitized === 'object') {
                _diffFields(warnings, recordType, label, raw, sanitized, skip);
            } else if (warnings && _valuesDiffer(raw, sanitized)) {
                warnings.push({ recordType, recordName: label, kind: 'coerced', field: 'value', from: raw, to: sanitized });
            }
        } else if (warnings) {
            warnings.push({ recordType, recordName: label, kind: 'rejected', reason: 'Invalid value — not imported.' });
        }
    });
    return out;
}

export function sanitizePerson(record, idFallback) {
    return {
        id: sanitizeInteger(record?.id, idFallback),
        name: normalizeText(record?.name, 80)
    };
}

export function sanitizeAccount(record, idFallback) {
    return {
        id: sanitizeInteger(record?.id, idFallback),
        name: normalizeText(record?.name, 80),
        type: normalizeText(record?.type, 30) || 'Other',
        startingBalance: sanitizeFiniteNumber(record?.startingBalance, 0),
        interestRate: sanitizeFiniteNumber(record?.interestRate, 0, { min: 0, max: 100 }),
        retirementSubtype: RETIREMENT_SUBTYPES.includes(record?.retirementSubtype) ? record.retirementSubtype : 'Other',
        rateOfReturn: sanitizeFiniteNumber(record?.rateOfReturn, 0, { min: 0, max: 100 }),
        employerMatchPercent: sanitizeFiniteNumber(record?.employerMatchPercent, 0, { min: 0, max: 100 }),
        pensionAnnualSalary: sanitizeFiniteNumber(record?.pensionAnnualSalary, 0, { min: 0 }),
        pensionContributionRatePct: sanitizeFiniteNumber(record?.pensionContributionRatePct, 0, { min: 0, max: 100 }),
        pensionVestingYears: sanitizeInteger(record?.pensionVestingYears, 0, { min: 0 }),
        pensionEstimatedMonthlyBenefit: sanitizeFiniteNumber(record?.pensionEstimatedMonthlyBenefit, 0, { min: 0 }),
        pensionYearsOfService: sanitizeInteger(record?.pensionYearsOfService, 0, { min: 0 }),
        minimumPayment: sanitizeFiniteNumber(record?.minimumPayment, 0, { min: 0 }),
        catchUpEligible: Boolean(record?.catchUpEligible ?? false),
        hsaCoverageType: ['selfOnly', 'family'].includes(record?.hsaCoverageType) ? record.hsaCoverageType : 'selfOnly',
        archived: Boolean(record?.archived ?? false)
    };
}

export function sanitizeDebt(record, idFallback) {
    const debtType = record?.debtType === 'fixedAmount' ? 'fixedAmount' : 'creditCard';
    const dueDate = sanitizeInteger(record?.dueDate, null, { min: 1, max: 31 });
    const accountBalance = sanitizeFiniteNumber(record?.accountBalance, 0, { min: 0 });
    const minimumPayment = sanitizeFiniteNumber(record?.minimumPayment, 0, { min: 0 });
    const originalBalance = sanitizeFiniteNumber(record?.originalBalance, accountBalance, { min: 0 });
    const originalMinimumPayment = sanitizeFiniteNumber(record?.originalMinimumPayment, minimumPayment, { min: 0 });

    return {
        id: sanitizeInteger(record?.id, idFallback),
        name: normalizeText(record?.name, 80),
        category: normalizeText(record?.category, 40),
        debtType,
        priority: sanitizeInteger(record?.priority, null, { min: 1, max: 100 }),
        accountId: sanitizeInteger(record?.accountId, null),
        accountBalance,
        originalBalance,
        interestRate: sanitizeFiniteNumber(record?.interestRate, 0, { min: 0, max: 100 }),
        minimumPayment,
        originalMinimumPayment,
        dueDate,
        debtStartDate: sanitizeDateISO(record?.debtStartDate),
        fixedAmount: sanitizeFiniteNumber(record?.fixedAmount, minimumPayment, { min: 0 }),
        fixedStartDate: sanitizeDateISO(record?.fixedStartDate),
        fixedEndDate: sanitizeDateISO(record?.fixedEndDate),
        creditLimit: record?.creditLimit != null ? sanitizeFiniteNumber(record.creditLimit, null, { min: 0 }) : null,
        updatedAt: sanitizeDateISO(record?.updatedAt),
        archived: Boolean(record?.archived ?? false),
        personIds: Array.isArray(record?.personIds)
            ? record.personIds.map(id => sanitizeInteger(id, null)).filter(id => id !== null)
            : [],
        notes: normalizeText(record?.notes ?? '', 500),
        nextPaymentDue: sanitizeDateISO(record?.nextPaymentDue)
    };
}

const INCOME_CATEGORIES = ['Salary', 'Freelance', 'Rental', 'Investment', 'Other'];

export function sanitizeIncome(record, idFallback) {
    const rawFreq = record?.frequency;
    const frequency = ['weekly', 'biweekly', 'bi-weekly', 'twice_monthly', 'monthly'].includes(rawFreq)
        ? (rawFreq === 'bi-weekly' ? 'biweekly' : rawFreq)
        : 'monthly';
    return {
        id: sanitizeInteger(record?.id, idFallback),
        name: normalizeText(record?.name, 80),
        amount: sanitizeFiniteNumber(record?.amount, 0, { min: 0 }),
        firstPayDate: sanitizeDateISO(record?.firstPayDate || record?.firstDate),
        frequency,
        category: INCOME_CATEGORIES.includes(record?.category) ? record.category : 'Salary',
        isVariable: Boolean(record?.isVariable ?? false),
        accountId: sanitizeInteger(record?.accountId, null),
        personId: sanitizeInteger(record?.personId, null),
        updatedAt: sanitizeDateISO(record?.updatedAt)
    };
}

export function sanitizeBonus(record, idFallback) {
    return {
        id: sanitizeInteger(record?.id, idFallback),
        name: normalizeText(record?.name, 80),
        amount: sanitizeFiniteNumber(record?.amount, 0, { min: 0 }),
        date: sanitizeDateISO(record?.date),
        category: normalizeText(record?.category, 40) || 'Other',
        accountId: sanitizeInteger(record?.accountId, null),
        purpose: (record?.purpose === 'cashFlow' || record?.purpose === 'savings') ? record.purpose : null
    };
}

export function sanitizeBill(record, idFallback) {
    return {
        id: sanitizeInteger(record?.id, idFallback),
        name: normalizeText(record?.name, 80),
        amount: sanitizeFiniteNumber(record?.amount, 0, { min: 0 }),
        dueDay: sanitizeInteger(record?.dueDay, null, { min: 1, max: 31 }),
        category: normalizeText(record?.category, 40) || 'Other',
        accountId: sanitizeInteger(record?.accountId, null)
    };
}

export function sanitizeExpense(record, idFallback) {
    const date = sanitizeDateISO(record?.date);
    return {
        id: sanitizeInteger(record?.id, idFallback),
        name: normalizeText(record?.name, 80),
        budgetAmount: sanitizeFiniteNumber(record?.budgetAmount, 0, { min: 0 }),
        date: date ? new Date(`${date}T00:00:00`) : null,
        category: normalizeText(record?.category, 40) || 'Other',
        accountId: sanitizeInteger(record?.accountId, null)
    };
}

export function sanitizeLedgerOverrides(overrides, warnings) {
    const out = {};
    if (!overrides || typeof overrides !== 'object') return out;
    for (const [key, value] of Object.entries(overrides)) {
        if (!key || typeof key !== 'string') continue;
        const amount = sanitizeFiniteNumber(value?.amount, NaN);
        if (!Number.isFinite(amount)) {
            if (warnings) warnings.push({ recordType: 'Ledger Override', recordName: key, kind: 'rejected', reason: 'Missing or invalid amount — override was not imported.' });
            continue;
        }
        const sanitized = {
            amount,
            originalAmount: sanitizeFiniteNumber(value?.originalAmount, null),
            transactionName: normalizeText(value?.transactionName, 120) || null,
            accountId: sanitizeInteger(value?.accountId, null),
            date: sanitizeDateISO(value?.date),
            updatedAt: sanitizeTimestampISO(value?.updatedAt) || new Date().toISOString(),
            memo: normalizeText(value?.memo, 500) || ''
        };
        out[key] = sanitized;
        // updatedAt is always reformatted/regenerated, not a user-fixable coercion — excluded from diffing.
        _diffFields(warnings, 'Ledger Override', key, value, sanitized, ['updatedAt']);
    }
    return out;
}

export function sanitizeLedgerClearedTransactions(entries, warnings) {
    const out = {};
    if (!entries || typeof entries !== 'object') return out;
    for (const [key, value] of Object.entries(entries)) {
        if (!key || typeof key !== 'string') continue;
        const clearedAt = sanitizeTimestampISO(value?.clearedAt);
        if (!clearedAt) {
            if (warnings) warnings.push({ recordType: 'Ledger Cleared Flag', recordName: key, kind: 'rejected', reason: 'Missing or invalid clearedAt — flag was not imported.' });
            continue;
        }
        out[key] = { clearedAt };
    }
    return out;
}

export function sanitizeRecurringTemplate(record, idFallback) {
    const skippedMonths = Array.isArray(record?.skippedMonths) ? record.skippedMonths.filter(m => /^\d{4}-\d{2}$/.test(m)) : [];
    const paidMonths = Array.isArray(record?.paidMonths) ? record.paidMonths.filter(m => /^\d{4}-\d{2}$/.test(m)) : [];
    const paidAmounts = {};
    if (record?.paidAmounts && typeof record.paidAmounts === 'object' && !Array.isArray(record.paidAmounts)) {
        for (const [k, v] of Object.entries(record.paidAmounts)) {
            if (/^\d{4}-\d{2}$/.test(k)) {
                const amt = sanitizeFiniteNumber(v, null, { min: 0 });
                if (amt !== null && !isNaN(amt)) paidAmounts[k] = amt;
            }
        }
    }
    const frequency = ['weekly', 'biweekly', 'monthly', 'quarterly', 'yearly'].includes(record?.frequency) ? record.frequency : 'monthly';
    const type = ['subscription', 'reimbursement', 'transfer'].includes(record?.type) ? record.type : 'subscription';
    return {
        id: sanitizeInteger(record?.id, idFallback),
        name: normalizeText(record?.name, 80),
        type,
        amount: sanitizeFiniteNumber(record?.amount, 0, { min: 0 }),
        frequency,
        dayOfMonth: sanitizeInteger(record?.dayOfMonth, null, { min: 1, max: 31 }),
        category: normalizeText(record?.category, 40) || 'Other',
        accountId: sanitizeInteger(record?.accountId, null),
        targetAccountId: sanitizeInteger(record?.targetAccountId, null),
        startDate: sanitizeDateISO(record?.startDate),
        endDate: sanitizeDateISO(record?.endDate),
        paused: Boolean(record?.paused),
        archived: Boolean(record?.archived),
        skippedMonths,
        paidMonths,
        paidAmounts
    };
}

export function sanitizeEmergencyFund(record, idFallback) {
    return {
        id: sanitizeInteger(record?.id, idFallback),
        accountId: sanitizeInteger(record?.accountId, null),
        targetAmount: sanitizeFiniteNumber(record?.targetAmount, 0, { min: 0 }),
        currentAmount: sanitizeFiniteNumber(record?.currentAmount, 0, { min: 0 }),
        monthlyContribution: sanitizeFiniteNumber(record?.monthlyContribution, 0, { min: 0 }),
        autoContribute: Boolean(record?.autoContribute),
        autoSyncBalance: Boolean(record?.autoSyncBalance),
        notes: normalizeText(record?.notes, 200)
    };
}

export function sanitizeSinkingFund(record, idFallback) {
    const allocationMethod = ['fixed', 'annual', 'target_date'].includes(record?.allocationMethod) ? record.allocationMethod : 'fixed';
    return {
        id: sanitizeInteger(record?.id, idFallback),
        name: normalizeText(record?.name, 80),
        allocationMethod,
        monthlyAllocation: sanitizeFiniteNumber(record?.monthlyAllocation, 0, { min: 0 }),
        targetAmount: sanitizeFiniteNumber(record?.targetAmount, 0, { min: 0 }),
        currentAmount: sanitizeFiniteNumber(record?.currentAmount, 0, { min: 0 }),
        autoContribute: Boolean(record?.autoContribute),
        accountId: sanitizeInteger(record?.accountId, null),
        notes: normalizeText(record?.notes, 200),
        order: sanitizeInteger(record?.order, 0),
        archived: Boolean(record?.archived),
        completedDate: sanitizeDateISO(record?.completedDate)
    };
}

export function sanitizeNetWorthSnapshot(record) {
    const date = sanitizeDateISO(record?.date);
    if (!date) return null;
    const totalAssets = sanitizeFiniteNumber(record?.totalAssets, 0);
    const totalLiabilities = sanitizeFiniteNumber(record?.totalLiabilities, 0);
    const netWorth = sanitizeFiniteNumber(record?.netWorth, totalAssets - totalLiabilities);
    return {
        date,
        totalAssets,
        totalLiabilities,
        netWorth,
        debtPaymentMade: sanitizeFiniteNumber(record?.debtPaymentMade, 0, { min: 0 }),
        incomeReceived: sanitizeFiniteNumber(record?.incomeReceived, 0, { min: 0 }),
        source: record?.source === 'manual' ? 'manual' : 'auto'
    };
}

export function sanitizeForecastSettings(record) {
    const rawRange = sanitizeInteger(record?.rangeMonths, 1);
    return {
        rangeMonths: [1, 2, 3, 6, 12].includes(rawRange) ? rawRange : 1,
        accountId: record?.accountId === 'total' ? 'total' : (normalizeText(record?.accountId, 30) || 'total'),
        notableThresholdPct: sanitizeFiniteNumber(record?.notableThresholdPct, 130, { min: 100, max: 500 })
    };
}

export function sanitizeSetting(record) {
    const key = normalizeText(record?.key, 60);
    if (!key) return null;
    const rawValue = record?.value;
    let value;
    if (typeof rawValue === 'boolean' || typeof rawValue === 'number') {
        value = rawValue;
    } else if (typeof rawValue === 'string') {
        value = normalizeText(rawValue, 200);
    } else {
        return null;
    }
    return { key, value };
}

export function sanitizeReconciliation(record, idFallback) {
    const createdAt = typeof record?.createdAt === 'string' && !Number.isNaN(new Date(record.createdAt).getTime())
        ? record.createdAt
        : new Date().toISOString();
    // Statement range (issue #275) is null on legacy records; an inverted range drops the start.
    const statementEndDate = sanitizeDateISO(record?.statementEndDate);
    const rawStart = sanitizeDateISO(record?.statementStartDate);
    const statementStartDate = rawStart && statementEndDate && rawStart > statementEndDate ? null : rawStart;
    return {
        id: sanitizeInteger(record?.id, idFallback),
        accountId: sanitizeInteger(record?.accountId, null),
        date: sanitizeDateISO(record?.date) || todayISO(),
        statementStartDate,
        statementEndDate,
        previousBalance: sanitizeFiniteNumber(record?.previousBalance, 0),
        statementBalance: sanitizeFiniteNumber(record?.statementBalance, NaN),
        difference: sanitizeFiniteNumber(record?.difference, 0),
        note: normalizeText(record?.note, 200),
        createdAt
    };
}

export function sanitizePlanHistoryEntry(record, idFallback) {
    const createdAt = typeof record?.createdAt === 'string' && !Number.isNaN(new Date(record.createdAt).getTime())
        ? record.createdAt
        : new Date().toISOString();
    return {
        id: sanitizeInteger(record?.id, idFallback),
        monthlyPayment: sanitizeFiniteNumber(record?.monthlyPayment, 0, { min: 0 }),
        strategy: normalizeText(record?.strategy, 30) || null,
        totalInterest: sanitizeFiniteNumber(record?.totalInterest, 0, { min: 0 }),
        monthsToPayOff: sanitizeInteger(record?.monthsToPayOff, 0, { min: 0 }),
        payoffDate: sanitizeDateISO(record?.payoffDate),
        totalDebt: sanitizeFiniteNumber(record?.totalDebt, 0, { min: 0 }),
        createdAt
    };
}

export function sanitizeRetirementSnapshot(record, idFallback) {
    return {
        id: sanitizeInteger(record?.id, idFallback),
        accountId: sanitizeInteger(record?.accountId, null),
        date: sanitizeDateISO(record?.date) || todayISO(),
        balance: sanitizeFiniteNumber(record?.balance, 0, { min: 0 }),
        contribution: sanitizeFiniteNumber(record?.contribution, 0, { min: 0 }),
        annualSalary: sanitizeFiniteNumber(record?.annualSalary, null, { min: 0 })
    };
}

// Exactly one of debtId / accountId must be set; returns null (filtered out
// by callers, 400 on the server) otherwise. balance is null for Fixed Amount
// debts and may be negative for Credit Card / Loan accounts.
export function sanitizeBalanceHistoryEntry(record, idFallback) {
    const debtId = sanitizeInteger(record?.debtId, null);
    const accountId = sanitizeInteger(record?.accountId, null);
    const date = sanitizeDateISO(record?.date);
    if ((debtId === null) === (accountId === null) || !date) return null;
    const rawBalance = record?.balance;
    return {
        id: sanitizeInteger(record?.id, idFallback),
        debtId,
        accountId,
        date,
        balance: rawBalance === null || rawBalance === undefined || rawBalance === '' ? null : sanitizeFiniteNumber(rawBalance, null),
        minimumPayment: sanitizeFiniteNumber(record?.minimumPayment, 0, { min: 0 })
    };
}

// `warnings`, if passed, is an array that gets {recordType, recordName,
// kind: 'coerced'|'rejected', ...} entries pushed into it for every field
// that was coerced to a default and every record dropped entirely (issue
// #291). Omitting it (the normal load-from-storage/migration path) costs
// nothing extra and behaves exactly as before.
export function sanitizeParsedState(parsed = {}, warnings) {
    const now = Date.now();
    const state = {
        persons: _sanitizeRecordArray(parsed.persons, sanitizePerson, now + 7000, p => !!p.name, 'Person', 'name', warnings),
        debts: _sanitizeRecordArray(parsed.debts, sanitizeDebt, now, d => !!d.name, 'Debt', 'name', warnings),
        accounts: _sanitizeRecordArray(parsed.accounts, sanitizeAccount, now + 500, a => !!a.name, 'Account', 'name', warnings),
        incomes: _sanitizeRecordArray(parsed.incomes, sanitizeIncome, now + 1000, i => !!i.name && !!i.firstPayDate, 'Income', 'name', warnings),
        bonuses: _sanitizeRecordArray(parsed.bonuses, sanitizeBonus, now + 1500, b => !!b.name && !!b.date, 'Bonus', 'name', warnings),
        bills: _sanitizeRecordArray(parsed.bills, sanitizeBill, now + 2000, b => !!b.name, 'Bill', 'name', warnings),
        // 'date' is excluded from diffing: sanitizeExpense rewraps a valid ISO
        // string into a Date object, which would always "differ" from the raw
        // string and falsely read as a coercion on every successful import.
        expenses: _sanitizeRecordArray(parsed.expenses, sanitizeExpense, now + 3000, e => !!e.name && !!e.date, 'Expense', 'name', warnings, ['id', 'date']),
        ledgerAmountOverrides: sanitizeLedgerOverrides(parsed.ledgerAmountOverrides || {}, warnings),
        ledgerClearedTransactions: sanitizeLedgerClearedTransactions(parsed.ledgerClearedTransactions || {}, warnings),
        recurringTemplates: _sanitizeRecordArray(parsed.recurringTemplates, sanitizeRecurringTemplate, now + 4000, r => !!r.name, 'Recurring Template', 'name', warnings),
        emergencyFunds: _sanitizeRecordArray(parsed.emergencyFunds, sanitizeEmergencyFund, now + 4500, e => !!e.accountId, 'Emergency Fund',
            (raw, i) => raw?.accountId != null ? `Emergency Fund (account ${raw.accountId})` : `Emergency Fund #${i + 1}`, warnings),
        sinkingFunds: _sanitizeRecordArray(parsed.sinkingFunds, sanitizeSinkingFund, now + 5000, s => !!s.name && !!s.accountId, 'Sinking Fund', 'name', warnings),
        monthlySnapshots: _sanitizeValueArray(parsed.monthlySnapshots, sanitizeNetWorthSnapshot, Boolean, 'Net Worth Snapshot',
            (raw, i) => raw?.date ? `Net Worth Snapshot ${raw.date}` : `Net Worth Snapshot #${i + 1}`, warnings),
        netWorthMilestonesAwarded: _sanitizeValueArray(parsed.netWorthMilestonesAwarded, v => sanitizeInteger(v, null, { min: 5000 }), Number.isFinite,
            'Net Worth Milestone', (raw, i) => `Milestone #${i + 1}`, warnings),
        perMonthStimulus: _sanitizeValueArray(parsed.perMonthStimulus, v => sanitizeFiniteNumber(v, 0, { min: 0 }), () => true,
            'Per-Month Stimulus', (raw, i) => `Month ${i + 1}`, warnings),
        monthlyPayment: sanitizeFiniteNumber(parsed.monthlyPayment, null, { min: 0 }),
        strategy: normalizeText(parsed.strategy, 30) || null,
        ledgerSettings: {
            accountFilter: normalizeText(parsed?.ledgerSettings?.accountFilter, 20) || 'all',
            dateRange: normalizeText(parsed?.ledgerSettings?.dateRange, 20) || 'around7',
            sortKey: normalizeText(parsed?.ledgerSettings?.sortKey, 20) || 'date',
            sortDir: parsed?.ledgerSettings?.sortDir === 'asc' ? 'asc' : 'desc',
            clearedFilter: ['all', 'uncleared', 'cleared'].includes(parsed?.ledgerSettings?.clearedFilter) ? parsed.ledgerSettings.clearedFilter : 'all'
        },
        forecastSettings: sanitizeForecastSettings(parsed?.forecastSettings),
        reconciliations: _sanitizeRecordArray(parsed.reconciliations, sanitizeReconciliation, now + 5500, r => r.accountId !== null && Number.isFinite(r.statementBalance),
            'Reconciliation', (raw, i) => raw?.date ? `Reconciliation ${raw.date}` : `Reconciliation #${i + 1}`, warnings),
        planHistory: _sanitizeRecordArray(parsed.planHistory, sanitizePlanHistoryEntry, now + 6000, h => h.monthlyPayment > 0 && !!h.strategy,
            'Plan History', (raw, i) => raw?.strategy ? `Plan (${raw.strategy})` : `Plan History #${i + 1}`, warnings),
        retirementSnapshots: _sanitizeRecordArray(parsed.retirementSnapshots, sanitizeRetirementSnapshot, now + 6500, s => s.accountId !== null,
            'Retirement Snapshot', (raw, i) => raw?.date ? `Retirement Snapshot ${raw.date}` : `Retirement Snapshot #${i + 1}`, warnings),
        retirementTargetDate: sanitizeDateISO(parsed.retirementTargetDate),
        settings: _sanitizeValueArray(parsed.settings, sanitizeSetting, Boolean, 'Setting', (raw, i) => raw?.key ? String(raw.key) : `Setting #${i + 1}`, warnings),
        balanceHistory: _sanitizeRecordArray(parsed.balanceHistory, sanitizeBalanceHistoryEntry, now + 8000, Boolean,
            'Balance History', (raw, i) => raw?.date ? `Balance History ${raw.date}` : `Balance History #${i + 1}`, warnings)
    };
    if (warnings && parsed.retirementTargetDate && !state.retirementTargetDate) {
        warnings.push({ recordType: 'Settings', recordName: 'retirementTargetDate', kind: 'coerced', field: 'retirementTargetDate', from: parsed.retirementTargetDate, to: null });
    }
    const debtIds = new Set(state.debts.map(d => d.id));
    const accountIds = new Set(state.accounts.map(a => a.id));
    state.balanceHistory = state.balanceHistory.filter((h, idx) => {
        const keep = h.debtId !== null ? debtIds.has(h.debtId) : accountIds.has(h.accountId);
        if (!keep && warnings) {
            warnings.push({
                recordType: 'Balance History',
                recordName: h.date ? `Balance History ${h.date}` : `Balance History #${idx + 1}`,
                kind: 'rejected',
                reason: 'References a debt/account that no longer exists after import — not imported.'
            });
        }
        return keep;
    });
    return state;
}
