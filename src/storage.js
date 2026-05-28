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
