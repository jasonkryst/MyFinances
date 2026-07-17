// JSON/CSV export and import.

import { normalizeText, sanitizeFiniteNumber } from './utils.js';
import { getFilteredSortedLedgerTransactions } from './ledger.js';
import { sanitizeParsedState } from './sanitizers.js';

const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

// Export a full app backup as JSON.
export function exportAllJSON(app) {
    const normalisedDebts = app.debts.map(d => ({
        ...d,
        accountBalance: d.accountBalance ?? 0,
        originalBalance: d.originalBalance ?? d.accountBalance ?? 0
    }));

    const payload = {
        version: '4.0.0',
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
        reconciliations: app.reconciliations || [],
        settings: app.settings || [],
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
        },
        forecastSettings: {
            rangeMonths: app._forecastRangeMonths || 1,
            accountId: app._forecastAccountId || 'total',
            notableThresholdPct: app._forecastNotableThresholdPct || 130
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

// Quote a CSV field per RFC 4180, doubling any embedded quotes.
export function csvField(value) {
    return `"${String(value).replace(/"/g, '""')}"`;
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

    let csv = 'Month,' + debtNames.map(csvField).join(',') + ',Stimulus Applied,Total Paid\n';

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
        csv += `${csvField(debtName)},"${summary.totalPaid.toFixed(2)}","${summary.principalPaid.toFixed(2)}","${summary.interestPaid.toFixed(2)}","${payoffDate}"\n`;
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

const LEDGER_EXPORT_COLUMN_LABELS = {
    date: 'Date',
    account: 'Account',
    name: 'Transaction',
    amount: 'Amount',
    category: 'Category',
    balance: 'Running Balance',
    type: 'Type'
};
export const LEDGER_EXPORT_COLUMN_KEYS = Object.keys(LEDGER_EXPORT_COLUMN_LABELS);

function ledgerExportCellValue(tx, key) {
    switch (key) {
        case 'date': return tx.date ? new Date(tx.date).toISOString().slice(0, 10) : '';
        case 'account': return tx.account || '';
        case 'name': return tx.name || '';
        case 'amount': return Number(tx.amount || 0).toFixed(2);
        case 'category': return tx.category || '';
        case 'balance': return Number(tx.balance || 0).toFixed(2);
        case 'type': return tx.type || '';
        default: return '';
    }
}

// Export the currently filtered/sorted Ledger view to CSV with user-selected columns.
export function exportLedgerToCSV(app, columns) {
    const selectedColumns = (Array.isArray(columns) ? columns : []).filter(c => LEDGER_EXPORT_COLUMN_KEYS.includes(c));
    if (selectedColumns.length === 0) return;

    const transactions = getFilteredSortedLedgerTransactions(app);

    let csv = selectedColumns.map(c => csvField(LEDGER_EXPORT_COLUMN_LABELS[c])).join(',') + '\n';
    for (const tx of transactions) {
        csv += selectedColumns.map(c => csvField(ledgerExportCellValue(tx, c))).join(',') + '\n';
    }

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ledger-export-${new Date().toISOString().split('T')[0]}.csv`;
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
        const incomingReconciliations = clean.reconciliations;
        const incomingSettings = clean.settings;
        const incomingMonthlySnapshots = clean.monthlySnapshots;
        const incomingNetWorthMilestones = clean.netWorthMilestonesAwarded;
        const incomingStrategy = payload?.strategy || null;
        const incomingLedgerSettings = clean.ledgerSettings;
        const incomingForecastSettings = clean.forecastSettings;

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
            app.reconciliations = incomingReconciliations.map((r, i) => ({ ...r, id: Date.now() + 5500 + i }));
            app.settings = incomingSettings || [];
            app.ledgerAmountOverrides = incomingLedgerAmountOverrides || {};
            app.monthlySnapshots = incomingMonthlySnapshots || [];
            app.netWorthMilestonesAwarded = incomingNetWorthMilestones || [];
            if (incomingLedgerSettings) {
                app._ledgerAccountFilter = incomingLedgerSettings.accountFilter || 'all';
                app._ledgerDateRange = incomingLedgerSettings.dateRange || 'all';
                app._ledgerSortKey = incomingLedgerSettings.sortKey || 'date';
                app._ledgerSortDir = incomingLedgerSettings.sortDir || 'desc';
            }
            if (incomingForecastSettings) {
                app._forecastRangeMonths = incomingForecastSettings.rangeMonths || 1;
                app._forecastAccountId = incomingForecastSettings.accountId || 'total';
                app._forecastNotableThresholdPct = incomingForecastSettings.notableThresholdPct || 130;
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
            app.reconciliations = incomingReconciliations.map((r, i) => ({ ...r, id: Date.now() + 5500 + i }));
            app.settings = incomingSettings || [];
            app.ledgerAmountOverrides = incomingLedgerAmountOverrides || {};
            app.monthlySnapshots = incomingMonthlySnapshots || [];
            app.netWorthMilestonesAwarded = incomingNetWorthMilestones || [];
            if (incomingLedgerSettings) {
                app._ledgerAccountFilter = incomingLedgerSettings.accountFilter || 'all';
                app._ledgerDateRange = incomingLedgerSettings.dateRange || 'all';
                app._ledgerSortKey = incomingLedgerSettings.sortKey || 'date';
                app._ledgerSortDir = incomingLedgerSettings.sortDir || 'desc';
            }
            if (incomingForecastSettings) {
                app._forecastRangeMonths = incomingForecastSettings.rangeMonths || 1;
                app._forecastAccountId = incomingForecastSettings.accountId || 'total';
                app._forecastNotableThresholdPct = incomingForecastSettings.notableThresholdPct || 130;
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
