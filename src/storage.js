// LocalStorage import/export


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
            app.debts = parsed.debts || [];
            app.accounts = parsed.accounts || [];
            app.incomes = parsed.incomes || [];
            app.bonuses = parsed.bonuses || [];
            app.bills = parsed.bills || [];
            app.expenses = parsed.expenses || [];
            app.perMonthStimulus = parsed.perMonthStimulus || [];
            app._savedMonthlyPayment = parsed.monthlyPayment || null;
            app._savedStrategy = parsed.strategy || null;
            // Restore ledger settings if present
            if (parsed.ledgerSettings) {
                app._ledgerAccountFilter = parsed.ledgerSettings.accountFilter || 'all';
                app._ledgerDateRange = parsed.ledgerSettings.dateRange || 'all';
                app._ledgerSortKey = parsed.ledgerSettings.sortKey || 'date';
                app._ledgerSortDir = parsed.ledgerSettings.sortDir || 'desc';
            }
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
        onReadError
    } = options;

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

        const incomingDebts = Array.isArray(parsed) ? parsed : (parsed.debts || []);
        const incomingAccounts = parsed.accounts || [];
        const incomingIncomes = parsed.incomes || [];
        const incomingBonuses = parsed.bonuses || [];
        const incomingBills = parsed.bills || [];
        const incomingExpenses = parsed.expenses || [];
        const incomingStrategy = parsed.strategy || null;
        const incomingLedgerSettings = parsed.ledgerSettings || null;

        const validDebts = incomingDebts.filter(d => d && typeof d.name === 'string' && d.name.trim());

        if (validDebts.length === 0 && incomingIncomes.length === 0 && !incomingStrategy
            && incomingBills.length === 0 && incomingExpenses.length === 0) {
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
        if (incomingStrategy?.monthlyPayment || incomingStrategy?.paymentStrategy) parts.push('strategy settings');

        const shouldReplace = typeof requestImportMode === 'function'
            ? requestImportMode(parts)
            : true;

        if (shouldReplace) {
            app.accounts = incomingAccounts.map((a, i) => ({ ...a, id: Date.now() + 500 + i }));
            app.debts = validDebts.map((d, i) => ({
                ...d,
                id: Date.now() + i,
                accountBalance: d.accountBalance ?? 0,
                originalBalance: d.originalBalance ?? d.accountBalance ?? 0
            }));
            app.incomes = incomingIncomes.map((inc, i) => ({ ...inc, id: Date.now() + 1000 + i }));
            app.bonuses = incomingBonuses.map((b, i) => ({ ...b, id: Date.now() + 1500 + i }));
            app.bills = incomingBills.map((b, i) => ({ ...b, id: Date.now() + 2000 + i }));
            app.expenses = incomingExpenses.map((e, i) => ({ ...e, id: Date.now() + 3000 + i }));
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
                        id: Date.now() + toAdd.length,
                        accountBalance: d.accountBalance ?? 0,
                        originalBalance: d.originalBalance ?? d.accountBalance ?? 0
                    });
                    existingNames.add(d.name.toLowerCase());
                }
            }
            app.debts = [...app.debts, ...toAdd];
            if (skipped > 0 && typeof onMergeDuplicates === 'function') {
                onMergeDuplicates(toAdd.length, skipped);
            }
            app.accounts = incomingAccounts.map((a, i) => ({ ...a, id: Date.now() + 500 + i }));
            app.incomes = incomingIncomes.map((inc, i) => ({ ...inc, id: Date.now() + 1000 + i }));
            app.bonuses = incomingBonuses.map((b, i) => ({ ...b, id: Date.now() + 1500 + i }));
            app.bills = incomingBills.map((b, i) => ({ ...b, id: Date.now() + 2000 + i }));
            app.expenses = incomingExpenses.map((e, i) => ({ ...e, id: Date.now() + 3000 + i }));
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
            if (mpEl && incomingStrategy.monthlyPayment) mpEl.value = incomingStrategy.monthlyPayment;
            if (psEl && incomingStrategy.paymentStrategy) psEl.value = incomingStrategy.paymentStrategy;
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
    app.lastPaymentPlan = null;
    app.lastSummary = null;
    app.perMonthStimulus = [];
    app.bonuses = [];
    app.saveToStorage();
    app.updateUI();
    document.getElementById('resultsSection').style.display = 'none';
    document.getElementById('monthlyPayment').value = '';
    if (typeof onCleared === 'function') {
        onCleared();
    }
}
