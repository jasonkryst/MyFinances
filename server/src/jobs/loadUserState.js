// Load one user's data into an app-shaped object (#579), the same shape the
// browser's loadFromPostgres() (src/storage.js) builds from the GET routes.
// Each collection comes from its route's own listForUser(), so the column
// mapping, row order and value types are exactly what the browser receives;
// like the browser, nothing is re-sanitized on the way out (every row was
// sanitized on write).

import personsRouter from '../routes/persons.js';
import debtsRouter from '../routes/debts.js';
import accountsRouter from '../routes/accounts.js';
import incomesRouter from '../routes/incomes.js';
import bonusesRouter from '../routes/bonuses.js';
import billsRouter from '../routes/bills.js';
import expensesRouter from '../routes/expenses.js';
import recurringTemplatesRouter from '../routes/recurringTemplates.js';
import emergencyFundsRouter from '../routes/emergencyFunds.js';
import sinkingFundsRouter from '../routes/sinkingFunds.js';
import reconciliationsRouter from '../routes/reconciliations.js';
import planHistoryRouter from '../routes/planHistory.js';
import retirementSnapshotsRouter from '../routes/retirementSnapshots.js';
import transfersRouter from '../routes/transfers.js';
import manualTransactionsRouter from '../routes/manualTransactions.js';
import balanceHistoryRouter from '../routes/balanceHistory.js';
import netWorthSnapshotsRouter from '../routes/netWorthSnapshots.js';
import settingsRouter from '../routes/settings.js';
import ledgerOverridesRouter from '../routes/ledgerOverrides.js';
import ledgerClearedRouter from '../routes/ledgerCleared.js';

// Same keys as POSTGRES_RESOURCE_ENDPOINTS in src/storage.js (a test keeps
// the two lists equal).
export const USER_STATE_COLLECTIONS = {
    persons: personsRouter,
    debts: debtsRouter,
    accounts: accountsRouter,
    incomes: incomesRouter,
    bonuses: bonusesRouter,
    bills: billsRouter,
    expenses: expensesRouter,
    recurringTemplates: recurringTemplatesRouter,
    emergencyFunds: emergencyFundsRouter,
    sinkingFunds: sinkingFundsRouter,
    reconciliations: reconciliationsRouter,
    planHistory: planHistoryRouter,
    retirementSnapshots: retirementSnapshotsRouter,
    transfers: transfersRouter,
    manualTransactions: manualTransactionsRouter,
    balanceHistory: balanceHistoryRouter,
};

const list = (router, userId) => router.crudConfig.listForUser(userId);

// Plan settings (strategy, monthly payment, Ledger/Forecast view state, ...)
// are not loaded: nothing in the projection or the snapshot metrics reads them.
export async function loadUserState(userId) {
    const entries = Object.entries(USER_STATE_COLLECTIONS);
    const [lists, snapshots, settingsRows, overrides, cleared] = await Promise.all([
        Promise.all(entries.map(([, router]) => list(router, userId))),
        list(netWorthSnapshotsRouter, userId),
        list(settingsRouter, userId),
        list(ledgerOverridesRouter, userId),
        list(ledgerClearedRouter, userId),
    ]);
    const app = {};
    entries.forEach(([field], i) => { app[field] = lists[i]; });
    app.monthlySnapshots = snapshots;
    app.settings = settingsRows;
    app.ledgerAmountOverrides = Object.fromEntries(overrides.map(o => [o.overrideKey, o]));
    app.ledgerClearedTransactions = Object.fromEntries(cleared.map(c => [c.clearedKey, c]));
    return app;
}
