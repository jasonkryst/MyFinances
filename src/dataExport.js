// JSON/CSV export and import.

import { APP_VERSION, normalizeText, sanitizeFiniteNumber } from './utils.js';
import { getFilteredSortedLedgerTransactions } from './ledgerTransactions.js';
import { sanitizeParsedState, remapDebtPersonRefs, remapIncomePersonRef } from './sanitizers.js';
import { replaceForPostgres, mergeForPostgres } from './postgresImport.js';
import { PLAN_HISTORY_CAP } from './strategyPlanCalculation.js';
import { remapHistoryOwners, excludeExistingHistory } from './balanceHistoryCore.js';
import { seedMissingBalanceHistory } from './balanceHistory.js';

const MAX_IMPORT_BYTES = 2 * 1024 * 1024;


// Merge incoming items into existing by name, skipping duplicates.
function _mergeByName(existing, incoming, idOffset = 0) {
    const names = new Set(existing.map(x => x.name?.toLowerCase()).filter(Boolean));
    const toAdd = incoming.filter(x => x.name && !names.has(x.name.toLowerCase()));
    return [...existing, ...toAdd.map((x, i) => ({ ...x, id: Date.now() + idOffset + i }))];
}
// Export a full app backup as JSON.
export function exportAllJSON(app) {
    const normalisedDebts = app.debts.map(d => ({
        ...d,
        accountBalance: d.accountBalance ?? 0,
        originalBalance: d.originalBalance ?? d.accountBalance ?? 0
    }));

    const payload = {
        version: APP_VERSION,
        exportedAt: new Date().toISOString(),
        accounts: app.accounts || [],
        persons: app.persons || [],
        debts: normalisedDebts,
        incomes: app.incomes || [],
        bonuses: app.bonuses || [],
        bills: app.bills || [],
        expenses: app.expenses || [],
        ledgerAmountOverrides: app.ledgerAmountOverrides || {},
        ledgerClearedTransactions: app.ledgerClearedTransactions || {},
        recurringTemplates: app.recurringTemplates || [],
        emergencyFunds: app.emergencyFunds || [],
        sinkingFunds: app.sinkingFunds || [],
        reconciliations: app.reconciliations || [],
        planHistory: app.planHistory || [],
        retirementSnapshots: app.retirementSnapshots || [],
        transfers: app.transfers || [],
        balanceHistory: app.balanceHistory || [],
        retirementTargetDate: app.retirementTargetDate || null,
        homePurchasePlan: app.homePurchasePlan || null,
        budgetCategories: app.budgetCategories || {},
        settings: app.settings || [],
        monthlySnapshots: app.monthlySnapshots || [],
        netWorthMilestonesAwarded: app.netWorthMilestonesAwarded || [],
        perMonthStimulus: app.perMonthStimulus || [],
        strategy: {
            monthlyPayment: parseFloat(document.getElementById('monthlyPayment')?.value) || null,
            paymentStrategy: document.getElementById('paymentStrategy')?.value || null
        },
        ledgerSettings: {
            accountFilter: app._ledgerAccountFilter || 'all',
            dateRange: app._ledgerDateRange || 'around7',
            sortKey: app._ledgerSortKey || 'date',
            sortDir: app._ledgerSortDir || 'desc',
            clearedFilter: app._ledgerClearedFilter || 'all'
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

// Export the detailed payment schedule (by debt per month) to CSV.
// Columns: Month, Debt Name, Payment, Principal, Interest, Remaining Balance
export function exportPaymentScheduleCSV(app) {
    if (!app.lastPaymentPlan || app.lastPaymentPlan.length === 0) {
        return;
    }

    const rows = [];
    rows.push(['Month', 'Debt Name', 'Payment', 'Principal', 'Interest', 'Remaining Balance']);

    // Keep a running balance map for each debt
    const debtBalances = {};
    for (const debt of app.debts) {
        debtBalances[debt.name] = debt.accountBalance || 0;
    }

    for (const monthData of app.lastPaymentPlan) {
        const monthName = DebtCalculator.getMonthName(monthData.month - 1);

        for (const payment of monthData.payments) {
            const remainingBalance = debtBalances[payment.debtName] || 0;
            rows.push([
                monthName,
                payment.debtName,
                payment.payment.toFixed(2),
                payment.principal.toFixed(2),
                payment.interest.toFixed(2),
                remainingBalance.toFixed(2)
            ]);
            // Update the running balance
            debtBalances[payment.debtName] = Math.max(0, remainingBalance - payment.principal);
        }
    }

    // Build CSV
    let csv = rows.map(row => row.map(csvField).join(',')).join('\n') + '\n';

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `payment-schedule-${new Date().toISOString().split('T')[0]}.csv`;
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
    type: 'Type',
    cleared: 'Cleared',
    clearedAt: 'Cleared At'
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
        case 'cleared': return tx.cleared ? 'Yes' : 'No';
        case 'clearedAt': return tx.clearedAt || '';
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

// Export every currently-visible Chart.js canvas as a PNG download (#271).
// "Visible" = offsetParent !== null, i.e. not inside a display:none
// page-section/tab-panel - a raw canvas.toDataURL() works regardless of
// which module drew it, so no Chart instance registry is needed. Downloads
// are triggered sequentially with a short stagger (not bundled into a ZIP)
// to stay dependency-free, matching the rest of this file; this feature was
// previously shipped as a per-chart overlay button and rolled back same-day
// for cluttering the chart views (see ROADMAP.md), so this entry point lives
// only in the Backup & Restore modal - no chart page markup changes at all.
export function exportChartsAsPng(app) {
    const canvases = Array.from(document.querySelectorAll('canvas'))
        .filter(c => c.id && c.offsetParent !== null);
    if (canvases.length === 0) return 0;

    const dateSuffix = new Date().toISOString().split('T')[0];
    canvases.forEach((canvas, index) => {
        setTimeout(() => {
            const a = document.createElement('a');
            a.href = canvas.toDataURL('image/png');
            a.download = `${_chartCanvasIdToSlug(canvas.id)}-${dateSuffix}.png`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        }, index * 150);
    });
    return canvases.length;
}

function _chartCanvasIdToSlug(id) {
    return id.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

// Import a full backup JSON file.
export function importAllJSON(app, file, options = {}) {
    const {
        onInvalidJSON,
        onNoData,
        requestImportMode,
        onMergeDuplicates,
        onImported,
        onReadError,
        onTooLarge,
        onImportError
    } = options;

    if (file?.size > MAX_IMPORT_BYTES) {
        if (typeof onTooLarge === 'function') {
            onTooLarge(MAX_IMPORT_BYTES);
        }
        return;
    }

    const reader = new FileReader();
    reader.onload = async (e) => {
        let parsed;
        try {
            parsed = JSON.parse(e.target.result);
        } catch (err) {
            // Modern V8 (Chromium/Node) JSON.parse errors already include a
            // position, and often a line/column, e.g. "Unexpected token u in
            // JSON at position 4" or "... at position 1 (line 1 column 2)" —
            // pass it straight through rather than re-deriving line/col.
            if (typeof onInvalidJSON === 'function') {
                onInvalidJSON(err?.message || 'The file is not valid JSON.');
            }
            return;
        }

        const payload = Array.isArray(parsed) ? { debts: parsed } : parsed;
        const warnings = [];
        const clean = sanitizeParsedState(payload, warnings);
        // Cap a pathologically large import file at the same limit new plan
        // submissions are trimmed to (issue #162) -- merge mode may still push
        // the combined total slightly over this until the next Calculate run.
        if (clean.planHistory.length > PLAN_HISTORY_CAP) {
            const droppedCount = clean.planHistory.length - PLAN_HISTORY_CAP;
            warnings.push({
                recordType: 'Plan History', recordName: `${droppedCount} oldest entr${droppedCount === 1 ? 'y' : 'ies'}`,
                kind: 'rejected', reason: `File exceeded the ${PLAN_HISTORY_CAP}-entry plan history cap — oldest entries were dropped.`
            });
            clean.planHistory = clean.planHistory.slice(-PLAN_HISTORY_CAP);
        }
        const incomingPersons = clean.persons || [];
        const incomingDebts = clean.debts;
        const incomingAccounts = clean.accounts;
        const incomingIncomes = clean.incomes;
        const incomingBonuses = clean.bonuses;
        const incomingBills = clean.bills;
        const incomingExpenses = clean.expenses;
        const incomingLedgerAmountOverrides = clean.ledgerAmountOverrides;
        const incomingLedgerClearedTransactions = clean.ledgerClearedTransactions;
        const incomingRecurringTemplates = clean.recurringTemplates;
        const incomingEmergencyFunds = clean.emergencyFunds;
        const incomingSinkingFunds = clean.sinkingFunds;
        const incomingReconciliations = clean.reconciliations;
        const incomingPlanHistory = clean.planHistory;
        const incomingRetirementSnapshots = clean.retirementSnapshots;
        const incomingTransfers = clean.transfers || [];
        const incomingBalanceHistory = clean.balanceHistory || [];
        const incomingRetirementTargetDate = clean.retirementTargetDate;
        const incomingHomePurchasePlan = clean.homePurchasePlan;
        const incomingBudgetCategories = clean.budgetCategories || {};
        const incomingSettings = clean.settings;
        const incomingMonthlySnapshots = clean.monthlySnapshots;
        const incomingNetWorthMilestones = clean.netWorthMilestonesAwarded;
        const incomingPerMonthStimulus = clean.perMonthStimulus || [];
        const incomingStrategy = payload?.strategy || null;
        const incomingLedgerSettings = clean.ledgerSettings;
        const incomingForecastSettings = clean.forecastSettings;

        const validDebts = incomingDebts.filter(d => d && d.name);
        let mergeDuplicatesReported = false;

        const hasData = incomingAccounts.length > 0 || validDebts.length > 0
            || incomingIncomes.length > 0 || incomingBonuses.length > 0
            || incomingBills.length > 0 || incomingExpenses.length > 0
            || incomingRecurringTemplates.length > 0 || incomingEmergencyFunds.length > 0
            || incomingSinkingFunds.length > 0 || incomingReconciliations.length > 0
            || incomingPlanHistory.length > 0
            || incomingMonthlySnapshots.length > 0 || incomingNetWorthMilestones.length > 0
            || incomingRetirementSnapshots.length > 0 || incomingTransfers.length > 0 || !!incomingRetirementTargetDate || !!incomingHomePurchasePlan
            || !!incomingStrategy?.monthlyPayment || !!incomingStrategy?.paymentStrategy;
        if (!hasData) {
            if (typeof onNoData === 'function') onNoData();
            return;
        }

        const parts = [];
        if (incomingAccounts.length) parts.push(`${incomingAccounts.length} account(s)`);
        if (validDebts.length) parts.push(`${validDebts.length} debt(s)`);
        if (incomingIncomes.length) parts.push(`${incomingIncomes.length} income source(s)`);
        if (incomingBills.length) parts.push(`${incomingBills.length} bill(s)`);
        if (incomingExpenses.length) parts.push(`${incomingExpenses.length} expense budget(s)`);
        if (incomingRecurringTemplates.length) parts.push(`${incomingRecurringTemplates.length} recurring item(s)`);
        if (incomingRetirementSnapshots.length) parts.push(`${incomingRetirementSnapshots.length} retirement snapshot(s)`);
        if (incomingTransfers.length) parts.push(`${incomingTransfers.length} transfer(s)`);
        if (incomingStrategy?.monthlyPayment || incomingStrategy?.paymentStrategy) parts.push('strategy settings');

        const shouldReplace = typeof requestImportMode === 'function'
            ? await requestImportMode(parts)
            : true;

        if (app._storageBackendKind === 'postgres') {
            try {
                if (shouldReplace) {
                    await replaceForPostgres(app, clean, incomingStrategy);
                } else {
                    await mergeForPostgres(app, clean, incomingStrategy);
                }
            } catch {
                if (typeof onImportError === 'function') onImportError();
                return;
            }
            if (incomingStrategy) {
                const mpEl = document.getElementById('monthlyPayment');
                const psEl = document.getElementById('paymentStrategy');
                const payment = sanitizeFiniteNumber(incomingStrategy.monthlyPayment, null, { min: 0 });
                const strategy = normalizeText(incomingStrategy.paymentStrategy, 30);
                if (mpEl && payment !== null) mpEl.value = payment;
                if (psEl && strategy) psEl.value = strategy;
            }
            await seedMissingBalanceHistory(app);
            app.updateUI();
            app.refreshCurrentPageData();
            if (!mergeDuplicatesReported && typeof onImported === 'function') {
                onImported(parts, warnings);
            }
            return;
        }

        if (shouldReplace) {
            app.persons = incomingPersons.map((p, i) => ({ ...p, id: Date.now() + 7000 + i }));
            // #272: persons get fresh ids, so debts' personIds and ownershipSplit
            // keys are remapped through the same old->new person id map.
            const personIdMap = Object.fromEntries(incomingPersons.map((p, i) => [p.id, app.persons[i].id]));
            app.accounts = incomingAccounts;
            app.debts = validDebts.map((d, i) => ({ ...remapDebtPersonRefs(d, personIdMap), id: Date.now() + i }));
            app.incomes = incomingIncomes.map((inc, i) => ({ ...remapIncomePersonRef(inc, personIdMap), id: Date.now() + 1000 + i }));
            app.bonuses = incomingBonuses.map((b, i) => ({ ...b, id: Date.now() + 1500 + i }));
            app.bills = incomingBills.map((b, i) => ({ ...b, id: Date.now() + 2000 + i }));
            app.expenses = incomingExpenses.map((e, i) => ({ ...e, id: Date.now() + 3000 + i }));
            app.recurringTemplates = incomingRecurringTemplates.map((r, i) => ({ ...r, id: Date.now() + 4000 + i }));
            app.emergencyFunds = incomingEmergencyFunds.map((f, i) => ({ ...f, id: Date.now() + 4500 + i }));
            app.sinkingFunds = incomingSinkingFunds.map((s, i) => ({ ...s, id: Date.now() + 5000 + i }));
            app.reconciliations = incomingReconciliations.map((r, i) => ({ ...r, id: Date.now() + 5500 + i }));
            app.planHistory = incomingPlanHistory.map((h, i) => ({ ...h, id: Date.now() + 6000 + i }));
            app.retirementSnapshots = incomingRetirementSnapshots.map((s, i) => ({ ...s, id: Date.now() + 6500 + i }));
            // Debts get fresh ids by index; accounts keep their ids in replace mode.
            const debtIdMap = new Map(validDebts.map((d, i) => [d.id, app.debts[i].id]));
            const accountIdMap = new Map(app.accounts.map(a => [a.id, a.id]));
            // Accounts keep their ids in replace mode, so this is a pass-through
            // rather than a real remap -- still routed through accountIdMap for
            // the same orphan-dropping behavior merge mode needs (see below).
            app.transfers = incomingTransfers
                .filter(t => accountIdMap.has(t.fromAccountId) && accountIdMap.has(t.toAccountId))
                .map((t, i) => ({ ...t, fromAccountId: accountIdMap.get(t.fromAccountId), toAccountId: accountIdMap.get(t.toAccountId), id: Date.now() + 7500 + i }));
            app.balanceHistory = remapHistoryOwners(incomingBalanceHistory, debtIdMap, accountIdMap)
                .map((h, i) => ({ ...h, id: Date.now() + 8000 + i }));
            app.retirementTargetDate = incomingRetirementTargetDate || null;
            app.homePurchasePlan = incomingHomePurchasePlan || null;
            app.budgetCategories = incomingBudgetCategories;
            app.settings = incomingSettings || [];
            app.ledgerAmountOverrides = incomingLedgerAmountOverrides || {};
            app.ledgerClearedTransactions = incomingLedgerClearedTransactions || {};
            app.monthlySnapshots = incomingMonthlySnapshots || [];
            app.netWorthMilestonesAwarded = incomingNetWorthMilestones || [];
            app.perMonthStimulus = incomingPerMonthStimulus;
            if (incomingLedgerSettings) {
                app._ledgerAccountFilter = incomingLedgerSettings.accountFilter || 'all';
                app._ledgerDateRange = incomingLedgerSettings.dateRange || 'around7';
                app._ledgerSortKey = incomingLedgerSettings.sortKey || 'date';
                app._ledgerSortDir = incomingLedgerSettings.sortDir || 'desc';
                app._ledgerClearedFilter = incomingLedgerSettings.clearedFilter || 'all';
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
            const toAddIds = new Set(toAdd.map(d => d.id));
            if (skipped > 0 && typeof onMergeDuplicates === 'function') {
                onMergeDuplicates(toAdd.length, skipped, warnings);
                mergeDuplicatesReported = true;
            }
            app.persons = _mergeByName(app.persons || [], incomingPersons, 7000);
            // #272: resolve each incoming person to the surviving (existing or
            // newly added) person by name, then remap the newly added debts.
            const personIdByName = new Map(app.persons.map(p => [p.name.toLowerCase(), p.id]));
            const personIdMap = Object.fromEntries(
                incomingPersons.filter(p => p.name && personIdByName.has(p.name.toLowerCase())).map(p => [p.id, personIdByName.get(p.name.toLowerCase())])
            );
            app.debts = app.debts.map(d => toAddIds.has(d.id) ? remapDebtPersonRefs(d, personIdMap) : d);
            app.accounts = _mergeByName(app.accounts, incomingAccounts, 0);
            app.incomes = _mergeByName(app.incomes, incomingIncomes.map(inc => remapIncomePersonRef(inc, personIdMap)), 1000);
            app.bonuses = _mergeByName(app.bonuses, incomingBonuses, 1500);
            app.bills = _mergeByName(app.bills, incomingBills, 2000);
            app.expenses = [...app.expenses, ...incomingExpenses.map((e, i) => ({ ...e, id: Date.now() + 3000 + i }))];
            app.recurringTemplates = _mergeByName(app.recurringTemplates, incomingRecurringTemplates, 4000);
            app.emergencyFunds = [...app.emergencyFunds, ...incomingEmergencyFunds.map((f, i) => ({ ...f, id: Date.now() + 4500 + i }))];
            app.sinkingFunds = _mergeByName(app.sinkingFunds, incomingSinkingFunds, 5000);
            app.reconciliations = [...app.reconciliations, ...incomingReconciliations.map((r, i) => ({ ...r, id: Date.now() + 5500 + i }))];
            app.planHistory = [...app.planHistory, ...incomingPlanHistory.map((h, i) => ({ ...h, id: Date.now() + 6000 + i }))].slice(-PLAN_HISTORY_CAP);
            app.retirementSnapshots = [...app.retirementSnapshots, ...incomingRetirementSnapshots.map((s, i) => ({ ...s, id: Date.now() + 6500 + i }))];
            // Name-matched debts/accounts resolve to the surviving record's id.
            const debtIdByName = new Map(app.debts.map(d => [d.name.toLowerCase(), d.id]));
            const accountIdByName = new Map(app.accounts.map(a => [a.name.toLowerCase(), a.id]));
            const debtIdMap = new Map(validDebts.map(d => [d.id, debtIdByName.get(d.name.toLowerCase())]));
            const accountIdMap = new Map(incomingAccounts.map(a => [a.id, accountIdByName.get(a.name.toLowerCase())]));
            // A transfer whose from/to account didn't resolve to a surviving
            // account (name not found) is dropped rather than imported with a
            // dangling reference.
            app.transfers = [
                ...(app.transfers || []),
                ...incomingTransfers
                    .filter(t => accountIdMap.has(t.fromAccountId) && accountIdMap.has(t.toAccountId))
                    .map((t, i) => ({ ...t, fromAccountId: accountIdMap.get(t.fromAccountId), toAccountId: accountIdMap.get(t.toAccountId), id: Date.now() + 7500 + i }))
            ];
            const remappedHistory = remapHistoryOwners(incomingBalanceHistory, debtIdMap, accountIdMap);
            app.balanceHistory = [
                ...(app.balanceHistory || []),
                ...excludeExistingHistory(app.balanceHistory || [], remappedHistory)
                    .map((h, i) => ({ ...h, id: Date.now() + 8000 + i }))
            ];
            if (incomingRetirementTargetDate) app.retirementTargetDate = incomingRetirementTargetDate;
            if (incomingHomePurchasePlan) app.homePurchasePlan = incomingHomePurchasePlan;
            app.budgetCategories = { ...(app.budgetCategories || {}), ...incomingBudgetCategories };
            app.settings = incomingSettings || [];
            app.ledgerAmountOverrides = incomingLedgerAmountOverrides || {};
            app.ledgerClearedTransactions = incomingLedgerClearedTransactions || {};
            app.monthlySnapshots = incomingMonthlySnapshots || [];
            app.netWorthMilestonesAwarded = incomingNetWorthMilestones || [];
            app.perMonthStimulus = incomingPerMonthStimulus;
            if (incomingLedgerSettings) {
                app._ledgerAccountFilter = incomingLedgerSettings.accountFilter || 'all';
                app._ledgerDateRange = incomingLedgerSettings.dateRange || 'around7';
                app._ledgerSortKey = incomingLedgerSettings.sortKey || 'date';
                app._ledgerSortDir = incomingLedgerSettings.sortDir || 'desc';
                app._ledgerClearedFilter = incomingLedgerSettings.clearedFilter || 'all';
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

        await seedMissingBalanceHistory(app);
        app.saveToStorage();
        app.updateUI();
        app.refreshCurrentPageData();
        if (!mergeDuplicatesReported && typeof onImported === 'function') {
            onImported(parts, warnings);
        }
    };

    reader.onerror = () => {
        if (typeof onReadError === 'function') {
            onReadError();
        }
    };
    reader.readAsText(file);
}
