// Sanitizers for persisted/imported record shapes — run on both load and import.

import { normalizeText, sanitizeFiniteNumber, sanitizeInteger, sanitizeDateISO, todayISO } from './utils.js';

export function sanitizeAccount(record, idFallback) {
    return {
        id: sanitizeInteger(record?.id, idFallback),
        name: normalizeText(record?.name, 80),
        type: normalizeText(record?.type, 30) || 'Other',
        startingBalance: sanitizeFiniteNumber(record?.startingBalance, 0),
        interestRate: sanitizeFiniteNumber(record?.interestRate, 0, { min: 0, max: 100 })
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
        ...record,
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
        fixedEndDate: sanitizeDateISO(record?.fixedEndDate)
    };
}

export function sanitizeIncome(record, idFallback) {
    const frequency = record?.frequency === 'monthly' ? 'monthly' : 'biweekly';
    return {
        id: sanitizeInteger(record?.id, idFallback),
        name: normalizeText(record?.name, 80),
        amount: sanitizeFiniteNumber(record?.amount, 0, { min: 0 }),
        firstPayDate: sanitizeDateISO(record?.firstPayDate || record?.firstDate),
        frequency,
        accountId: sanitizeInteger(record?.accountId, null)
    };
}

export function sanitizeBonus(record, idFallback) {
    return {
        id: sanitizeInteger(record?.id, idFallback),
        name: normalizeText(record?.name, 80),
        amount: sanitizeFiniteNumber(record?.amount, 0, { min: 0 }),
        date: sanitizeDateISO(record?.date),
        category: normalizeText(record?.category, 40) || 'Other',
        accountId: sanitizeInteger(record?.accountId, null)
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

export function sanitizeLedgerOverrides(overrides) {
    const out = {};
    if (!overrides || typeof overrides !== 'object') return out;
    for (const [key, value] of Object.entries(overrides)) {
        if (!key || typeof key !== 'string') continue;
        const amount = sanitizeFiniteNumber(value?.amount, NaN);
        if (!Number.isFinite(amount)) continue;
        out[key] = {
            amount,
            originalAmount: sanitizeFiniteNumber(value?.originalAmount, null),
            transactionName: normalizeText(value?.transactionName, 120) || null,
            accountId: sanitizeInteger(value?.accountId, null),
            date: sanitizeDateISO(value?.date),
            updatedAt: sanitizeDateISO(value?.updatedAt) || new Date().toISOString()
        };
    }
    return out;
}

export function sanitizeRecurringTemplate(record, idFallback) {
    const skippedMonths = Array.isArray(record?.skippedMonths) ? record.skippedMonths.filter(m => /^\d{4}-\d{2}$/.test(m)) : [];
    const paidMonths = Array.isArray(record?.paidMonths) ? record.paidMonths.filter(m => /^\d{4}-\d{2}$/.test(m)) : [];
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
        skippedMonths,
        paidMonths
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
        notes: normalizeText(record?.notes, 200)
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
    return {
        id: sanitizeInteger(record?.id, idFallback),
        accountId: sanitizeInteger(record?.accountId, null),
        date: sanitizeDateISO(record?.date) || todayISO(),
        previousBalance: sanitizeFiniteNumber(record?.previousBalance, 0),
        statementBalance: sanitizeFiniteNumber(record?.statementBalance, NaN),
        difference: sanitizeFiniteNumber(record?.difference, 0),
        note: normalizeText(record?.note, 200),
        createdAt
    };
}

export function sanitizeParsedState(parsed = {}) {
    const now = Date.now();
    return {
        debts: (Array.isArray(parsed.debts) ? parsed.debts : []).map((d, i) => sanitizeDebt(d, now + i)).filter(d => !!d.name),
        accounts: (Array.isArray(parsed.accounts) ? parsed.accounts : []).map((a, i) => sanitizeAccount(a, now + 500 + i)).filter(a => !!a.name),
        incomes: (Array.isArray(parsed.incomes) ? parsed.incomes : []).map((inc, i) => sanitizeIncome(inc, now + 1000 + i)).filter(i => !!i.name && !!i.firstPayDate),
        bonuses: (Array.isArray(parsed.bonuses) ? parsed.bonuses : []).map((b, i) => sanitizeBonus(b, now + 1500 + i)).filter(b => !!b.name && !!b.date),
        bills: (Array.isArray(parsed.bills) ? parsed.bills : []).map((b, i) => sanitizeBill(b, now + 2000 + i)).filter(b => !!b.name),
        expenses: (Array.isArray(parsed.expenses) ? parsed.expenses : []).map((e, i) => sanitizeExpense(e, now + 3000 + i)).filter(e => !!e.name && !!e.date),
        ledgerAmountOverrides: sanitizeLedgerOverrides(parsed.ledgerAmountOverrides || {}),
        recurringTemplates: (Array.isArray(parsed.recurringTemplates) ? parsed.recurringTemplates : []).map((r, i) => sanitizeRecurringTemplate(r, now + 4000 + i)).filter(r => !!r.name),
        emergencyFunds: (Array.isArray(parsed.emergencyFunds) ? parsed.emergencyFunds : []).map((e, i) => sanitizeEmergencyFund(e, now + 4500 + i)).filter(e => !!e.accountId),
        sinkingFunds: (Array.isArray(parsed.sinkingFunds) ? parsed.sinkingFunds : []).map((s, i) => sanitizeSinkingFund(s, now + 5000 + i)).filter(s => !!s.name && !!s.accountId),
        monthlySnapshots: (Array.isArray(parsed.monthlySnapshots) ? parsed.monthlySnapshots : []).map(sanitizeNetWorthSnapshot).filter(Boolean),
        netWorthMilestonesAwarded: (Array.isArray(parsed.netWorthMilestonesAwarded) ? parsed.netWorthMilestonesAwarded : []).map(v => sanitizeInteger(v, null, { min: 5000 })).filter(v => Number.isFinite(v)),
        perMonthStimulus: (Array.isArray(parsed.perMonthStimulus) ? parsed.perMonthStimulus : []).map(v => sanitizeFiniteNumber(v, 0, { min: 0 })),
        monthlyPayment: sanitizeFiniteNumber(parsed.monthlyPayment, null, { min: 0 }),
        strategy: normalizeText(parsed.strategy, 30) || null,
        ledgerSettings: {
            accountFilter: normalizeText(parsed?.ledgerSettings?.accountFilter, 20) || 'all',
            dateRange: normalizeText(parsed?.ledgerSettings?.dateRange, 20) || 'all',
            sortKey: normalizeText(parsed?.ledgerSettings?.sortKey, 20) || 'date',
            sortDir: parsed?.ledgerSettings?.sortDir === 'asc' ? 'asc' : 'desc'
        },
        forecastSettings: sanitizeForecastSettings(parsed?.forecastSettings),
        reconciliations: (Array.isArray(parsed.reconciliations) ? parsed.reconciliations : []).map((r, i) => sanitizeReconciliation(r, now + 5500 + i)).filter(r => r.accountId !== null && Number.isFinite(r.statementBalance)),
        settings: (Array.isArray(parsed.settings) ? parsed.settings : []).map(sanitizeSetting).filter(Boolean)
    };
}
