// LocalStorage import/export

import { normalizeText, sanitizeFiniteNumber, sanitizeInteger, sanitizeDateISO } from './utils.js';

const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

function sanitizeAccount(record, idFallback) {
    return {
        id: sanitizeInteger(record?.id, idFallback),
        name: normalizeText(record?.name, 80),
        type: normalizeText(record?.type, 30) || 'Other',
        startingBalance: sanitizeFiniteNumber(record?.startingBalance, 0)
    };
}

function sanitizeDebt(record, idFallback) {
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

function sanitizeIncome(record, idFallback) {
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

function sanitizeBonus(record, idFallback) {
    return {
        id: sanitizeInteger(record?.id, idFallback),
        name: normalizeText(record?.name, 80),
        amount: sanitizeFiniteNumber(record?.amount, 0, { min: 0 }),
        date: sanitizeDateISO(record?.date),
        category: normalizeText(record?.category, 40) || 'Other',
        accountId: sanitizeInteger(record?.accountId, null)
    };
}

function sanitizeBill(record, idFallback) {
    return {
        id: sanitizeInteger(record?.id, idFallback),
        name: normalizeText(record?.name, 80),
        amount: sanitizeFiniteNumber(record?.amount, 0, { min: 0 }),
        dueDay: sanitizeInteger(record?.dueDay, null, { min: 1, max: 31 }),
        category: normalizeText(record?.category, 40) || 'Other',
        accountId: sanitizeInteger(record?.accountId, null)
    };
}

function sanitizeExpense(record, idFallback) {
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

function sanitizeLedgerOverrides(overrides) {
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

function sanitizeRecurringTemplate(record, idFallback) {
    const skippedMonths = Array.isArray(record?.skippedMonths) ? record.skippedMonths.filter(m => /^\d{4}-\d{2}$/.test(m)) : [];
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
        skippedMonths
    };
}

function sanitizeEmergencyFund(record, idFallback) {
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

function sanitizeSinkingFund(record, idFallback) {
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

function sanitizeNetWorthSnapshot(record) {
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

function sanitizeParsedState(parsed = {}) {
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
        }
    };
}


// Persist current state to localStorage under app.storageKey
export function saveToStorage(app) {
    try {
        const data = {
            debts: app.debts,
            accounts: app.accounts || [],
            incomes: app.incomes || [],
            bonuses: app.bonuses || [],
            bills: app.bills || [],
            expenses: app.expenses || [],
            ledgerAmountOverrides: app.ledgerAmountOverrides || {},
            recurringTemplates: app.recurringTemplates || [],
            emergencyFunds: app.emergencyFunds || [],
            sinkingFunds: app.sinkingFunds || [],
            monthlySnapshots: app.monthlySnapshots || [],
            netWorthMilestonesAwarded: app.netWorthMilestonesAwarded || [],
            perMonthStimulus: app.perMonthStimulus || [],
            monthlyPayment: parseFloat(document.getElementById('monthlyPayment')?.value) || null,
            strategy: document.getElementById('paymentStrategy')?.value || null,
            ledgerSettings: {
                accountFilter: app._ledgerAccountFilter || 'all',
                dateRange: app._ledgerDateRange || 'all',
                sortKey: app._ledgerSortKey || 'date',
                sortDir: app._ledgerSortDir || 'desc'
            },
            timestamp: new Date().toISOString()
        };
        localStorage.setItem(app.storageKey, JSON.stringify(data));
    } catch (error) {
        console.error('Error saving to localStorage:', error);
    }
}

// Restore state from localStorage
export function loadFromStorage(app) {
    try {
        const data = localStorage.getItem(app.storageKey);
        if (data) {
            const parsed = JSON.parse(data);
            const clean = sanitizeParsedState(parsed);
            app.debts = clean.debts;
            app.accounts = clean.accounts;
            app.incomes = clean.incomes;
            app.bonuses = clean.bonuses;
            app.bills = clean.bills;
            app.expenses = clean.expenses;
            app.ledgerAmountOverrides = clean.ledgerAmountOverrides;
            app.recurringTemplates = clean.recurringTemplates;
            app.emergencyFunds = clean.emergencyFunds;
            app.sinkingFunds = clean.sinkingFunds;
            app.monthlySnapshots = clean.monthlySnapshots;
            app.netWorthMilestonesAwarded = clean.netWorthMilestonesAwarded;
            app.perMonthStimulus = clean.perMonthStimulus;
            app._savedMonthlyPayment = clean.monthlyPayment;
            app._savedStrategy = clean.strategy;
            // Restore ledger settings if present
            app._ledgerAccountFilter = clean.ledgerSettings.accountFilter;
            app._ledgerDateRange = clean.ledgerSettings.dateRange;
            app._ledgerSortKey = clean.ledgerSettings.sortKey;
            app._ledgerSortDir = clean.ledgerSettings.sortDir;
        }
    } catch (error) {
        console.error('Error loading from localStorage:', error);
    }
}

// Export a full app backup as JSON.
export function exportAllJSON(app) {
    const normalisedDebts = app.debts.map(d => ({
        ...d,
        accountBalance: d.accountBalance ?? 0,
        originalBalance: d.originalBalance ?? d.accountBalance ?? 0
    }));

    const payload = {
        version: '3.0',
        exportedAt: new Date().toISOString(),
        accounts: app.accounts || [],
        debts: normalisedDebts,
        incomes: app.incomes || [],
        bonuses: app.bonuses || [],
        bills: app.bills || [],
        expenses: app.expenses || [],
        ledgerAmountOverrides: app.ledgerAmountOverrides || {},
        recurringTemplates: app.recurringTemplates || [],
        emergencyFunds: app.emergencyFunds || [],
        sinkingFunds: app.sinkingFunds || [],
        monthlySnapshots: app.monthlySnapshots || [],
        netWorthMilestonesAwarded: app.netWorthMilestonesAwarded || [],
        strategy: {
            monthlyPayment: parseFloat(document.getElementById('monthlyPayment')?.value) || null,
            paymentStrategy: document.getElementById('paymentStrategy')?.value || null
        },
        ledgerSettings: {
            accountFilter: app._ledgerAccountFilter || 'all',
            dateRange: app._ledgerDateRange || 'all',
            sortKey: app._ledgerSortKey || 'date',
            sortDir: app._ledgerSortDir || 'desc'
        }
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `debt-tracker-backup-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// Export the current payment plan to a downloadable CSV file.
export function exportToCSV(app, options = {}) {
    const { onMissingPlan } = options;
    if (!app.lastPaymentPlan) {
        if (typeof onMissingPlan === 'function') {
            onMissingPlan();
        }
        return;
    }

    const debtNames = [];
    const debtNameSet = new Set();
    for (const monthData of app.lastPaymentPlan) {
        for (const payment of monthData.payments) {
            if (!debtNameSet.has(payment.debtName)) {
                debtNames.push(payment.debtName);
                debtNameSet.add(payment.debtName);
            }
        }
    }

    let csv = 'Month,' + debtNames.join(',') + ',Stimulus Applied,Total Paid\n';

    for (const monthData of app.lastPaymentPlan) {
        const monthName = DebtCalculator.getMonthName(monthData.month - 1);

        const monthPaymentMap = {};
        for (const payment of monthData.payments) {
            monthPaymentMap[payment.debtName] = payment.payment;
        }

        let monthStimulusTotal = 0;
        if (monthData.stimulusApplied) {
            for (const debtName of debtNames) {
                monthStimulusTotal += monthData.stimulusApplied[debtName] || 0;
            }
        }

        csv += `"${monthName}"`;
        for (const debtName of debtNames) {
            const payment = monthPaymentMap[debtName] || 0;
            csv += `,"${payment > 0 ? payment.toFixed(2) : ''}"`;
        }
        csv += `,"${monthStimulusTotal > 0 ? monthStimulusTotal.toFixed(2) : ''}"`;
        const monthTotal = monthData.payments.reduce((sum, payment) => sum + (payment.payment || 0), 0);
        csv += `,"${monthTotal.toFixed(2)}"`;
        csv += '\n';
    }

    csv += '\n\nDebt Summary\n';
    csv += 'Debt Name,Total Amount Paid,Principal Paid,Interest Paid,Estimated Payoff Date\n';

    const debtOrderMap = {};
    const debtSummaryMap = {};
    let orderIndex = 0;

    const originalDebts = {};
    for (const debt of app.debts) {
        originalDebts[debt.name] = debt;
    }

    for (const monthData of app.lastPaymentPlan) {
        for (const payment of monthData.payments) {
            if (!debtSummaryMap[payment.debtName]) {
                debtOrderMap[payment.debtName] = orderIndex++;
                const orig = originalDebts[payment.debtName] || {};
                debtSummaryMap[payment.debtName] = {
                    totalPaid: 0,
                    principalPaid: 0,
                    interestPaid: 0,
                    isFixedAmount: orig.debtType === 'fixedAmount',
                    payoffDate: null,
                    lastPaymentDate: null
                };
            }

            debtSummaryMap[payment.debtName].totalPaid += payment.payment;
            debtSummaryMap[payment.debtName].principalPaid += payment.principal;
            debtSummaryMap[payment.debtName].interestPaid += payment.interest;

            if (debtSummaryMap[payment.debtName].isFixedAmount) {
                debtSummaryMap[payment.debtName].lastPaymentDate = DebtCalculator.formatDate(monthData.date);
            }

            if (payment.paidOff) {
                debtSummaryMap[payment.debtName].payoffDate = DebtCalculator.formatDate(monthData.date);
            }
        }
    }

    const sortedDebts = Object.entries(debtSummaryMap).sort((left, right) => debtOrderMap[left[0]] - debtOrderMap[right[0]]);

    for (const [debtName, summary] of sortedDebts) {
        const payoffDate = summary.isFixedAmount ? (summary.lastPaymentDate || '') : (summary.payoffDate || '');
        csv += `"${debtName}","${summary.totalPaid.toFixed(2)}","${summary.principalPaid.toFixed(2)}","${summary.interestPaid.toFixed(2)}","${payoffDate}"\n`;
    }

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `debt-plan-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
}

// Import a full backup JSON file.
export function importAllJSON(app, file, options = {}) {
    const {
        onInvalidJSON,
        onNoData,
        requestImportMode,
        onMergeDuplicates,
        onReadError,
        onTooLarge
    } = options;

    if (file?.size > MAX_IMPORT_BYTES) {
        if (typeof onTooLarge === 'function') {
            onTooLarge(MAX_IMPORT_BYTES);
        }
        return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
        let parsed;
        try {
            parsed = JSON.parse(e.target.result);
        } catch {
            if (typeof onInvalidJSON === 'function') {
                onInvalidJSON();
            }
            return;
        }

        const payload = Array.isArray(parsed) ? { debts: parsed } : parsed;
        const clean = sanitizeParsedState(payload);
        const incomingDebts = clean.debts;
        const incomingAccounts = clean.accounts;
        const incomingIncomes = clean.incomes;
        const incomingBonuses = clean.bonuses;
        const incomingBills = clean.bills;
        const incomingExpenses = clean.expenses;
        const incomingLedgerAmountOverrides = clean.ledgerAmountOverrides;
        const incomingRecurringTemplates = clean.recurringTemplates;
        const incomingEmergencyFunds = clean.emergencyFunds;
        const incomingSinkingFunds = clean.sinkingFunds;
        const incomingMonthlySnapshots = clean.monthlySnapshots;
        const incomingNetWorthMilestones = clean.netWorthMilestonesAwarded;
        const incomingStrategy = payload?.strategy || null;
        const incomingLedgerSettings = clean.ledgerSettings;

        const validDebts = incomingDebts.filter(d => d && d.name);

        if (validDebts.length === 0 && incomingIncomes.length === 0 && !incomingStrategy
            && incomingBills.length === 0 && incomingExpenses.length === 0
            && incomingRecurringTemplates.length === 0) {
            if (typeof onNoData === 'function') {
                onNoData();
            }
            return;
        }

        const parts = [];
        if (incomingAccounts.length) parts.push(`${incomingAccounts.length} account(s)`);
        if (validDebts.length) parts.push(`${validDebts.length} debt(s)`);
        if (incomingIncomes.length) parts.push(`${incomingIncomes.length} income source(s)`);
        if (incomingBills.length) parts.push(`${incomingBills.length} bill(s)`);
        if (incomingExpenses.length) parts.push(`${incomingExpenses.length} expense budget(s)`);
        if (incomingRecurringTemplates.length) parts.push(`${incomingRecurringTemplates.length} recurring item(s)`);
        if (incomingStrategy?.monthlyPayment || incomingStrategy?.paymentStrategy) parts.push('strategy settings');

        const shouldReplace = typeof requestImportMode === 'function'
            ? requestImportMode(parts)
            : true;

        if (shouldReplace) {
            app.accounts = incomingAccounts;
            app.debts = validDebts.map((d, i) => ({ ...d, id: Date.now() + i }));
            app.incomes = incomingIncomes.map((inc, i) => ({ ...inc, id: Date.now() + 1000 + i }));
            app.bonuses = incomingBonuses.map((b, i) => ({ ...b, id: Date.now() + 1500 + i }));
            app.bills = incomingBills.map((b, i) => ({ ...b, id: Date.now() + 2000 + i }));
            app.expenses = incomingExpenses.map((e, i) => ({ ...e, id: Date.now() + 3000 + i }));
            app.recurringTemplates = incomingRecurringTemplates.map((r, i) => ({ ...r, id: Date.now() + 4000 + i }));
            app.emergencyFunds = incomingEmergencyFunds.map((f, i) => ({ ...f, id: Date.now() + 4500 + i }));
            app.sinkingFunds = incomingSinkingFunds.map((s, i) => ({ ...s, id: Date.now() + 5000 + i }));
            app.ledgerAmountOverrides = incomingLedgerAmountOverrides || {};
            app.monthlySnapshots = incomingMonthlySnapshots || [];
            app.netWorthMilestonesAwarded = incomingNetWorthMilestones || [];
            if (incomingLedgerSettings) {
                app._ledgerAccountFilter = incomingLedgerSettings.accountFilter || 'all';
                app._ledgerDateRange = incomingLedgerSettings.dateRange || 'all';
                app._ledgerSortKey = incomingLedgerSettings.sortKey || 'date';
                app._ledgerSortDir = incomingLedgerSettings.sortDir || 'desc';
            }
        } else {
            const existingNames = new Set(app.debts.map(d => d.name.toLowerCase()));
            let skipped = 0;
            const toAdd = [];
            for (const d of validDebts) {
                if (existingNames.has(d.name.toLowerCase())) {
                    skipped++;
                } else {
                    toAdd.push({
                        ...d,
                        id: Date.now() + toAdd.length
                    });
                    existingNames.add(d.name.toLowerCase());
                }
            }
            app.debts = [...app.debts, ...toAdd];
            if (skipped > 0 && typeof onMergeDuplicates === 'function') {
                onMergeDuplicates(toAdd.length, skipped);
            }
            app.accounts = incomingAccounts;
            app.incomes = incomingIncomes.map((inc, i) => ({ ...inc, id: Date.now() + 1000 + i }));
            app.bonuses = incomingBonuses.map((b, i) => ({ ...b, id: Date.now() + 1500 + i }));
            app.bills = incomingBills.map((b, i) => ({ ...b, id: Date.now() + 2000 + i }));
            app.expenses = incomingExpenses.map((e, i) => ({ ...e, id: Date.now() + 3000 + i }));
            app.recurringTemplates = incomingRecurringTemplates.map((r, i) => ({ ...r, id: Date.now() + 4000 + i }));
            app.emergencyFunds = incomingEmergencyFunds.map((f, i) => ({ ...f, id: Date.now() + 4500 + i }));
            app.sinkingFunds = incomingSinkingFunds.map((s, i) => ({ ...s, id: Date.now() + 5000 + i }));
            app.ledgerAmountOverrides = incomingLedgerAmountOverrides || {};
            app.monthlySnapshots = incomingMonthlySnapshots || [];
            app.netWorthMilestonesAwarded = incomingNetWorthMilestones || [];
            if (incomingLedgerSettings) {
                app._ledgerAccountFilter = incomingLedgerSettings.accountFilter || 'all';
                app._ledgerDateRange = incomingLedgerSettings.dateRange || 'all';
                app._ledgerSortKey = incomingLedgerSettings.sortKey || 'date';
                app._ledgerSortDir = incomingLedgerSettings.sortDir || 'desc';
            }
        }

        if (incomingStrategy) {
            const mpEl = document.getElementById('monthlyPayment');
            const psEl = document.getElementById('paymentStrategy');
            const payment = sanitizeFiniteNumber(incomingStrategy.monthlyPayment, null, { min: 0 });
            const strategy = normalizeText(incomingStrategy.paymentStrategy, 30);
            if (mpEl && payment !== null) mpEl.value = payment;
            if (psEl && strategy) psEl.value = strategy;
        }

        app.saveToStorage();
        app.updateUI();
    };

    reader.onerror = () => {
        if (typeof onReadError === 'function') {
            onReadError();
        }
    };
    reader.readAsText(file);
}

// Wipe all user data and reset the visible UI state.
export function clearAllData(app, options = {}) {
    const { onCleared } = options;

    app.debts = [];
    app.accounts = [];
    app.incomes = [];
    app.bills = [];
    app.expenses = [];
    app.lastPaymentPlan = null;
    app.lastSummary = null;
    app.perMonthStimulus = [];
    app.bonuses = [];
    app.ledgerAmountOverrides = {};

    app.editingDebtId = null;
    app.editingIncomeId = null;
    app.editingAccountId = null;
    app._savedMonthlyPayment = null;
    app._savedStrategy = null;
    app._reportMonthOffset = 0;

    app._ledgerAccountFilter = 'all';
    app._ledgerDateRange = 'all';
    app._ledgerSortKey = 'date';
    app._ledgerSortDir = 'desc';
    app._ledgerPage = 1;
    app._ledgerPageSize = 25;

    localStorage.removeItem(app.storageKey);
    localStorage.removeItem('debtTrackerTheme');

    app.updateUI();

    const resultsSection = document.getElementById('resultsSection');
    if (resultsSection) {
        resultsSection.classList.add('hidden');
        resultsSection.classList.remove('visible');
    }

    const monthlyPaymentInput = document.getElementById('monthlyPayment');
    if (monthlyPaymentInput) monthlyPaymentInput.value = '';

    const strategySelect = document.getElementById('paymentStrategy');
    if (strategySelect) strategySelect.selectedIndex = 0;

    if (typeof onCleared === 'function') {
        onCleared();
    }
}
