import {
    addDebt as addDebtFeature,
    deleteDebt as deleteDebtFeature,
    showUpdateBalanceModal as showUpdateBalanceModalFeature,
    updateDebtBalance as updateDebtBalanceFeature,
    saveEdit as saveEditFeature,
    cancelEdit as cancelEditFeature,
    renderDebtsList as renderDebtsListFeature,
    startEdit as startEditDebtFeature,
    cancelInlineEdit as cancelInlineEditDebtFeature,
    saveInlineEdit as saveInlineEditDebtFeature
} from './debts.js';
import { renderAccountsList, addAccount as addAccountFeature, deleteAccount as deleteAccountFeature, startEditAccount as startEditAccountFeature, cancelEditAccount as cancelEditAccountFeature, saveEditAccount as saveEditAccountFeature, computeAccountBalance as computeAccountBalanceFeature } from './accounts.js';
import {
    renderBudgetPage,
    addBill,
    deleteBill,
    startEditBill,
    saveEditBill,
    cancelEditBill,
    addExpense,
    deleteExpense,
    startEditExpense,
    saveEditExpense,
    cancelEditExpense
} from './bills.js';
import {
    renderBalanceChart as renderBalanceChartFeature,
    renderPieChart as renderPieChartFeature,
    renderProgressChart as renderProgressChartFeature,
    renderDebtDistributionChart as renderDebtDistributionChartFeature,
    renderDebtToIncomeChart as renderDebtToIncomeChartFeature
} from './charts.js';
import { saveToStorage, loadFromStorage, exportAllJSON as exportAllJSONFeature, exportToCSV as exportToCSVFeature, importAllJSON as importAllJSONFeature, clearAllData as clearAllDataFeature } from './storage.js';
import {
    renderIncomeList,
    addIncome,
    deleteIncome,
    startEditIncome,
    cancelEditIncome,
    saveEditIncome,
    addBonus,
    deleteBonus,
    startEditBonus,
    cancelEditBonus,
    saveEditBonus,
    renderBonusList
} from './income.js';
import {
    calculatePaymentPlanFromInputs as calculatePaymentPlanFromInputsFeature,
    calculateRequiredPayment as calculateRequiredPaymentFeature,
    displayPaymentPlan as displayPaymentPlanFeature,
    displayDebtSummary as displayDebtSummaryFeature,
    showAmortizationModal as showAmortizationModalFeature,
    displayPaymentSchedule as displayPaymentScheduleFeature,
    displayInterestComparison as displayInterestComparisonFeature,
    displayWhatIfSimulator as displayWhatIfSimulatorFeature,
    renderStrategyIncomeWidget as renderStrategyIncomeWidgetFeature,
    renderCalendarView as renderCalendarViewFeature
} from './strategy.js';
import {
    prevReportMonth as prevReportMonthFeature,
    nextReportMonth as nextReportMonthFeature,
    renderReportsPage as renderReportsPageFeature,
    captureNetWorthSnapshot as captureNetWorthSnapshotFeature,
    renderNetWorthWidget as renderNetWorthWidgetFeature
} from './reports.js';
import { initializeEventListeners as initializeUIEventListeners, switchTab as switchTabFeature, updateFormVisibility as updateFormVisibilityFeature, switchPage as switchPageFeature, updateUI as updateUIFeature, showMilestone as showMilestoneFeature, showNetWorthMilestone as showNetWorthMilestoneFeature } from './ui.js';
import { computeMonthlyIncomeForMonth, computeMonthlyBonusesForMonth, APP_VERSION } from './utils.js';
import {
    renderRecurringPage as renderRecurringPageFeature,
    addRecurringTemplate as addRecurringTemplateFeature,
    deleteRecurringTemplate as deleteRecurringTemplateFeature,
    pauseRecurringTemplate as pauseRecurringTemplateFeature,
    skipRecurringOccurrence as skipRecurringOccurrenceFeature,
    startEditRecurring as startEditRecurringFeature,
    cancelEditRecurring as cancelEditRecurringFeature,
    saveEditRecurring as saveEditRecurringFeature,
    refreshRecurringAccountSelectors as refreshRecurringAccountSelectorsFeature
} from './recurring.js';
import {
    renderSavingsPage as renderSavingsPageFeature,
    switchSavingsSubTab as switchSavingsSubTabFeature,
    attachSavingsEventListeners as attachSavingsEventListenersFeature
} from './savings.js';
import { renderHealthDashboard as renderHealthDashboardFeature } from './health.js';

/**
 * app.js — Debt Tracker Application (ES module)
 * Main UI controller and data manager for the Debt Tracker web app.
 *
 * Modularized for modern browser support.
 */

export class DebtTrackerApp {
    constructor() {
        this.debts = [];
        this.accounts = [];
        this.incomes = [];
        this.bonuses = [];
        this.bills = [];
        this.expenses = [];
        this.recurringTemplates = [];
        this.emergencyFunds = [];
        this.sinkingFunds = [];
        this.monthlySnapshots = [];
        this.netWorthMilestonesAwarded = [];
        this.ledgerAmountOverrides = {};
        this.lastPaymentPlan = null;
        this.lastSummary = null;
        this.perMonthStimulus = [];
        this.editingDebtId = null;
        this.editingIncomeId = null;
        this.editingAccountId = null;
        this.editingRecurringId = null;
        this.savingsSubTab = 'emergency';
        this._reportMonthOffset = 0;
            this.liabilitiesSubTab = 'debts';
        this._savedMonthlyPayment = null;
        this._savedStrategy = null;
        this.storageKey = 'debtTrackerData';
    this._netWorthRangeMonths = 6;

        this.initializeEventListeners();
        this.loadFromStorage();
        const versionEl = document.getElementById('appVersion');
        if (versionEl) versionEl.textContent = `v${APP_VERSION}`;
    this.captureNetWorthSnapshot({ source: 'auto', silent: true, skipMilestone: true });

        if (this.accounts.length > 0 && this.incomes.length > 0) {
            const firstAccountId = this.accounts[0].id;
            let changed = false;
            for (let index = 0; index < this.incomes.length; index++) {
                if (!this.incomes[index].accountId || isNaN(this.incomes[index].accountId)) {
                    this.incomes[index].accountId = firstAccountId;
                    changed = true;
                }
            }
            if (changed) this.saveToStorage();
        }

        this.updateUI();
        this.updateFormVisibility();
        this.switchPage('health');
    }

    initializeEventListeners() {
        return initializeUIEventListeners(this);
    }

    /**
     * Run the main payment-plan calculation from the Plan section inputs.
     * Stores results and reveals the Results panel when successful.
     */
    calculatePaymentPlanFromInputs() {
        return calculatePaymentPlanFromInputsFeature(this);
    }

    /**
     * Show/hide form fields based on the selected debt type.
     * creditCard  → shows balance, rate, min payment, due date, priority, start date fields
     * fixedAmount → hides those; shows fixed amount, start date, end date fields
     */
    updateFormVisibility() {
        return updateFormVisibilityFeature();
    }

    addDebt() {
        return addDebtFeature(this);
    }

    deleteDebt(debtId) {
        return deleteDebtFeature(this, debtId);
    }

    /**
     * Use binary search to find the minimum monthly payment needed to pay off all
     * interest-bearing debts by the user's chosen target date.
     *
     * Algorithm:
     *   1. Convert target date → targetMonths from today
     *   2. Binary search (60 iterations) between totalMinimum and 2×totalBalance
     *   3. Round result up to the nearest dollar
     *   4. Render a result card with payoff stats and an optional "Use this amount" button
     */
    calculateRequiredPayment() {
        return calculateRequiredPaymentFeature(this);
    }

    /**
     * Render the full Results page after a calculation:
     *   - Summary stats (total debt, interest, payoff time, monthly interest cost)
     *   - Debt Summary table
     *   - Strategy interest comparison panel
     *   - What-if extra-payment simulator
     *   - Monthly payment schedule table
     */
    displayPaymentPlan() {
        return displayPaymentPlanFeature(this);
    }

    /**
     * Build this._debtSummaryRows from this.lastPaymentPlan and render the
     * interactive summary table with sortable columns.
     */
    displayDebtSummary() {
        return displayDebtSummaryFeature(this);
    }

    /**
     * Open the amortization modal for a single debt, showing a month-by-month
     * table of payment, principal, interest, and remaining balance.
     * @param {string} debtName - Debt name as it appears in the payment plan
     */
    showAmortizationModal(debtName) {
        return showAmortizationModalFeature(this, debtName);
    }

    /**
     * Build the monthly payment schedule table (tabular view tab).
     * Columns: Month | [one column per debt] | Stimulus ($) | Total Paid
     *
     * The Stimulus column is an editable number input per month. Changing it
     * updates this.perMonthStimulus, persists, and immediately recalculates the plan.
     */
    displayPaymentSchedule() {
        return displayPaymentScheduleFeature(this);
    }

    /**
     * Export the current payment plan to a downloadable CSV file.
     * The file contains two sections:
     *   1. Monthly schedule — one row per month with per-debt payment amounts,
     *      a "Stimulus Applied" column, and a monthly total.
     *   2. Debt summary — one row per debt with totals for principal, interest
     *      paid, and estimated payoff date.
     */
    exportToCSV() {
        return exportToCSVFeature(this, {
            onMissingPlan: () => alert('Please calculate a payment plan first')
        });
    }

    /**
     * Refresh the entire UI to match the current state of `this.debts`.
     * - Restores saved monthly-payment and strategy values from storage.
     * - Shows the empty-state banner and redirects to the Add page when there
     *   are no debts.
     * - Otherwise hides the empty state, activates the Debts page, and calls
     *   `renderDebtsList()`.
     */
    updateUI() {
        return updateUIFeature(this);
    }

    /**
     * Activate a top-level page section and update the nav button state.
     * @param {string} pageName - One of `'debts'`, `'income'`, `'budget'`, `'strategy'`
     */
    switchPage(pageName) {
        return switchPageFeature(this, pageName);
    }

    /**
     * Render the Debts page list.
     * Each debt is shown as a card with:
     *   - Name, balance, APR, minimum payment, due date, category
     *   - A negative-amortization warning badge if APR causes the balance to grow
     *   - A paydown progress bar (requires `originalBalance`)
     *   - Monthly interest cost estimate
     *   - Interest Paid to Date stat (credit-card debts with `debtStartDate` only)
     *   - Edit / Delete / Update Balance action buttons
     *
     * If `this.editingDebtId` is set the matching card is replaced with an
     * inline edit form instead.
     */
    renderDebtsList() {
        return renderDebtsListFeature(this);
    }

    /**
     * Enter inline-edit mode for a debt card.
     * Sets `this.editingDebtId` and re-renders the list so the card is
     * replaced with an editable form. Focuses the name field after render.
     * @param {number} debtId - ID of the debt to edit
     */
    startEdit(debtId) {
        return startEditDebtFeature(this, debtId);
    }

    /** Discard inline edits and return the card to read-only view. */
    cancelInlineEdit() {
        return cancelInlineEditDebtFeature(this);
    }

    /**
     * Save inline edits for a debt card (called from inline "Save" button).
     * Updates the debt object, persists, and refreshes the UI.
     * @param {number} debtId
     */
    saveInlineEdit(debtId) {
        return saveInlineEditDebtFeature(this, debtId);
    }

    /**
     * Save changes from the full-page edit form (legacy modal edit path).
     * Validates required fields, updates the debt in `this.debts`, and
     * auto-recalculates the plan if a monthly payment is set.
     */
    saveEdit() {
        return saveEditFeature(this);
    }

    /** Reset the Add Debt form to its blank state and hide the Cancel button. */
    cancelEdit() {
        return cancelEditFeature(this);
    }

    // ─── Income ───────────────────────────────────────────────────────────────

    /**
     * Read the Add Income form, validate, build an income object, and save.
     *
     * Income object shape:
     *   { id, name, amount, firstPayDate, frequency }
     *   frequency: 'biweekly' | 'monthly'
     */
    addIncome() {
        return addIncome(this);
    }

    /**
     * Remove an income source by ID.
     * @param {number} incomeId
     */
    deleteIncome(incomeId) {
        return deleteIncome(this, incomeId);
    }

    /** Enter inline-edit mode for an income card. */
    startEditIncome(incomeId) {
        return startEditIncome(this, incomeId);
    }

    /** Cancel inline-edit without saving. */
    cancelEditIncome() {
        return cancelEditIncome(this);
    }

    /** Validate and save the inline-edit form for an income card. */
    saveEditIncome(incomeId) {
        return saveEditIncome(this, incomeId);
    }

    // ── Bonus / Windfall CRUD ────────────────────────────────────────────────

    /** Add a new one-time bonus from the bonus form. */
    addBonus() {
        return addBonus(this);
    }

    /** Delete a bonus by ID. */
    deleteBonus(bonusId) {
        return deleteBonus(this, bonusId);
    }

    /** Enter inline-edit mode for a bonus card. */
    startEditBonus(bonusId) {
        return startEditBonus(this, bonusId);
    }

    /** Cancel inline-edit for a bonus card. */
    cancelEditBonus() {
        return cancelEditBonus(this);
    }

    /** Save inline-edit for a bonus card. */
    saveEditBonus(bonusId) {
        return saveEditBonus(this, bonusId);
    }

    /**
     * Render the list of one-time bonuses below the bonus form on the Income page.
     */
    renderBonusList() {
        return renderBonusList(this);
    }

    /**
     * Render the income list and summary panel inside the Income page.
     */
    renderIncomeList() {
        return renderIncomeList(this);
    }

    /**
     * Render (or hide) the income context widget on the Strategy page.
     * Shows monthly expected income alongside the current monthly payment
     * commitment so the user can see the ratio at a glance.
     */
    renderStrategyIncomeWidget() {
        return renderStrategyIncomeWidgetFeature(this);
    }

    // Compatibility shim for any stale callsites that still expect app.computeMonthlyIncome().
    computeMonthlyIncome() {
        const now = new Date();
        return computeMonthlyIncomeForMonth(this.incomes, this.bonuses, now.getFullYear(), now.getMonth());
    }

    // Compatibility shim for stale callsites expecting app.computeMonthlyBonuses().
    computeMonthlyBonuses() {
        const now = new Date();
        return computeMonthlyBonusesForMonth(this.bonuses, now.getFullYear(), now.getMonth());
    }

    /**
     * Export a full app backup as JSON — includes debts, income sources,
     * monthly payment, and selected strategy.
     */
    exportAllJSON() {
        return exportAllJSONFeature(this);
    }

    /**
     * Import a full backup JSON file created by `exportAllJSON`.
     * Also accepts legacy v1.0 files (debts only).
     * Prompts the user to choose Replace or Merge for debts; income and
     * strategy are always restored from the file when present.
     * @param {File} file
     */
    importAllJSON(file) {
        return importAllJSONFeature(this, file, {
            onInvalidJSON: () => alert('Invalid JSON file. Please select a valid backup file.'),
            onNoData: () => alert('No recognisable data found in the selected file.'),
            requestImportMode: (parts) => confirm(
                `Found: ${parts.join(', ')}.\n\n` +
                `• OK     — Replace your current data entirely\n` +
                `• Cancel — Merge debts only (income & strategy will still be restored; duplicate debt names are skipped)\n`
            ),
            onMergeDuplicates: (addedCount, skippedCount) => {
                alert(`Merged ${addedCount} debt(s). Skipped ${skippedCount} duplicate name(s).`);
            },
            onTooLarge: (maxBytes) => {
                alert(`Import file is too large. Maximum supported size is ${Math.round(maxBytes / 1024)} KB.`);
            },
            onReadError: () => alert('Could not read the file. Please try again.')
        });
    }

    /**
     * Wipe all debts and reset every piece of app state, then confirm to the user.
     * Clears `this.debts`, `this.lastPaymentPlan`, `this.lastSummary`, and
     * `this.perMonthStimulus`, removes data from localStorage, and resets all
     * form fields.
     */
    clearAllData() {
        return clearAllDataFeature(this, {
            onCleared: () => alert('All app data and saved preferences have been cleared.')
        });
    }

    /**
     * Show a short milestone celebration when a debt is paid off on the current day.
     * @param {string} debtName
     */
    showMilestone(debtName) {
        return showMilestoneFeature(debtName);
    }

    showNetWorthMilestone(message) {
        return showNetWorthMilestoneFeature(message);
    }

    /**
     * Persist current state to localStorage under `this.storageKey`.
     * Saved keys: `debts`, `perMonthStimulus`, `monthlyPayment`, `strategy`, `timestamp`.
     */
    saveToStorage() {
        return saveToStorage(this);
    }

    /**
     * Restore state from localStorage.
     * Populates `this.debts`, `this.perMonthStimulus`, `this._savedMonthlyPayment`,
     * and `this._savedStrategy`. Silently ignores missing or corrupted data.
     */
    loadFromStorage() {
        return loadFromStorage(this);
    }

    /**
     * Activate a Results sub-tab by name.
     * Valid tab names: `'table'`, `'chart'`, `'calendar'`.
     * Side effects:
     *   - `'chart'` triggers `renderBalanceChart()`, `renderProgressChart()`, `renderPieChart()`
     *   - `'calendar'` triggers `renderCalendarView()`
     * @param {string} tabName
     */
    switchTab(tabName) {
        return switchTabFeature(this, tabName);
    }

    /**
     * Render the payment calendar for a given page (1 month per page).
     * Each month is drawn as a standard weekly grid. Debt payment events are
     * pinned to their `dueDate` day and colour-coded by debt. Today's cell
     * receives the `cal-today` CSS class. Prev/Next pagination buttons are
     * rendered at the top and bottom of the container.
     * @param {number} [page=0] - Zero-based page index
     */
    renderCalendarView(page = 0) {
        return renderCalendarViewFeature(this, page);
    }
    /**
     * Render the Strategy Comparison panel inside `#interestComparison`.
     * Runs all four payment strategies with the current debts and monthly
     * payment, then displays a ranked table showing total interest and months
     * for each strategy. If the current strategy is not optimal a savings
     * banner is shown.
     * @param {string} currentStrategy - The strategy key currently selected
     * @param {number} monthlyPayment  - The current total monthly payment
     */
    // ─── Interest Saved Comparison ────────────────────────────────────────────
    displayInterestComparison(currentStrategy, monthlyPayment) {
        return displayInterestComparisonFeature(this, currentStrategy, monthlyPayment);
    }

    /**
     * Render the What-If Simulator panel inside `#whatIfSimulator`.
     * Displays a range slider (0 → min(1000, basePayment)) that lets the user
     * drag an extra monthly payment amount and instantly see the resulting
     * months saved and interest saved compared to the base scenario.
     * @param {number} basePayment - The current calculated monthly payment
     * @param {string} strategy    - The currently selected strategy key
     */
    // ─── What-If Simulator ────────────────────────────────────────────────────
    displayWhatIfSimulator(basePayment, strategy) {
        return displayWhatIfSimulatorFeature(this, basePayment, strategy);
    }

    /**
     * Open the Update Balance modal for a credit-card debt.
     * Pre-fills the input with the current balance and wires up Confirm/Cancel.
     * On confirmation calls `updateDebtBalance()` which preserves `originalBalance`.
     * @param {number} debtId - ID of the debt whose balance will be updated
     */
    // ─── Update Balance Modal ─────────────────────────────────────────────────
    showUpdateBalanceModal(debtId) {
        return showUpdateBalanceModalFeature(this, debtId);
    }

    /**
     * Apply a new balance to a debt, preserve `originalBalance`, and
     * recalculate the payment plan if one already exists.
     * @param {number} debtId         - ID of the debt to update
     * @param {number} newBalance     - The new current balance (≥ 0)
     * @param {number} [newMinPayment] - Optional new minimum payment; if omitted, existing value is kept
     */
    updateDebtBalance(debtId, newBalance, newMinPayment) {
        return updateDebtBalanceFeature(this, debtId, newBalance, newMinPayment);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // BUDGET PAGE — Bills & Expenses
    // ─────────────────────────────────────────────────────────────────────────

    /** Add a new bill from the billForm inputs. */
    addBill() {
        return addBill(this);
    }

    /** Delete a bill by id. */
    deleteBill(id) {
        return deleteBill(this, id);
    }

    /** Enter inline edit mode for a bill. */
    startEditBill(id) {
        return startEditBill(this, id);
    }

    /** Save inline bill edits. */
    saveEditBill(id) {
        return saveEditBill(this, id);
    }

    /** Cancel bill edit. */
    cancelEditBill() {
        return cancelEditBill(this);
    }

    /** Add a new expense budget from the expenseForm inputs. */
    addExpense() {
        return addExpense(this);
    }

    /** Delete an expense by id. */
    deleteExpense(id) {
        return deleteExpense(this, id);
    }

    /** Enter inline edit mode for an expense. */
    startEditExpense(id) {
        return startEditExpense(this, id);
    }

    /** Save inline expense edits. */
    saveEditExpense(id) {
        return saveEditExpense(this, id);
    }

    /** Cancel expense edit. */
    cancelEditExpense() {
        return cancelEditExpense(this);
    }

    /** Render the full Budget page: bill cards, expense cards, cashflow summary. */
    renderBudgetPage() {
        return renderBudgetPage(this);
    }

    /**
     * Draw (or redraw) the "Payoff Timeline" Chart.js line chart.
     * One line per debt, each showing the projected balance declining to zero.
     * Uses `this.lastPaymentPlan` as the data source. Destroys any previous
     * `this.balanceChart` instance before creating a new one.
     */
    renderBalanceChart() {
        return renderBalanceChartFeature(this);
    }

    /**
     * Draw (or redraw) the "Total Interest vs. Principal Paid" doughnut chart.
     * Uses `this.lastSummary.totalDebt` (principal) and
     * `this.lastSummary.totalInterest` as segment values. Destroys any
     * previous `this.pieChart` instance before creating a new one.
     */
    renderPieChart() {
        return renderPieChartFeature(this);
    }

    /**
     * Draw (or redraw) the cumulative-payments progress line chart.
     * Three lines: Total Paid, Principal Paid, and Interest Paid — all
     * running totals over the plan duration. Destroys any previous
     * `this.progressChart` instance.
     */
    renderProgressChart() {
        return renderProgressChartFeature(this);
    }

    /**
     * Pie chart: current balance distribution across all debts.
     */
    renderDebtDistributionChart() {
        return renderDebtDistributionChartFeature(this);
    }

    /**
     * Pie chart: monthly debt payment vs. remaining income.
     * Only rendered when income sources exist.
     */
    renderDebtToIncomeChart() {
        return renderDebtToIncomeChartFeature(this);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  ACCOUNTS
    // ═══════════════════════════════════════════════════════════════════════

    /** Add a new account from the accountForm inputs. */
    addAccount() {
        return addAccountFeature(this);
    }

    /** Delete an account by ID. */
    deleteAccount(id) {
        return deleteAccountFeature(this, id);
    }

    /** Enter inline-edit mode for an account card. */
    startEditAccount(id) {
        return startEditAccountFeature(this, id);
    }

    /** Cancel inline-edit for an account card. */
    cancelEditAccount() {
        return cancelEditAccountFeature(this);
    }

    /** Save inline-edit for an account card. */
    saveEditAccount(id) {
        return saveEditAccountFeature(this, id);
    }

    /**
     * Compute the projected balance for a given account based on:
     *   startingBalance
     *   + income paydays this month assigned to this account
     *   + bonuses this month assigned to this account
     *   − debt minimums assigned to this account
     *   − bills assigned to this account
     *   − expense budgets assigned to this account
     * @param {number|null} accountId
     * @returns {number}
     */
    computeAccountBalance(accountId, year = null, month = null) {
        return computeAccountBalanceFeature(this, accountId, year, month);
    }

    /** Render the full accounts list on the Accounts page. */
    renderAccountsList() {
        return renderAccountsList(this);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //  REPORTS PAGE
    // ═══════════════════════════════════════════════════════════════════════

    /** Step the report month back by 1 and re-render. */
    prevReportMonth() {
        return prevReportMonthFeature(this);
    }

    /** Step the report month forward by 1 and re-render. */
    nextReportMonth() {
        return nextReportMonthFeature(this);
    }

    renderReportsPage() {
        return renderReportsPageFeature(this);
    }

    captureNetWorthSnapshot(options = {}) {
        return captureNetWorthSnapshotFeature(this, options);
    }

    renderNetWorthWidget() {
        return renderNetWorthWidgetFeature(this);
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  RECURRING TRANSACTION TEMPLATES
    // ═════════════════════════════════════════════════════════════════════════

    renderRecurringPage() { return renderRecurringPageFeature(this); }
    addRecurringTemplate() { return addRecurringTemplateFeature(this); }
    deleteRecurringTemplate(id) { return deleteRecurringTemplateFeature(this, id); }
    pauseRecurringTemplate(id, paused) { return pauseRecurringTemplateFeature(this, id, paused); }
    skipRecurringOccurrence(id, monthKey, unskip) { return skipRecurringOccurrenceFeature(this, id, monthKey, unskip); }
    startEditRecurring(id) { return startEditRecurringFeature(this, id); }
    cancelEditRecurring() { return cancelEditRecurringFeature(this); }
    saveEditRecurring(id) { return saveEditRecurringFeature(this, id); }
    refreshRecurringAccountSelectors() { return refreshRecurringAccountSelectorsFeature(this); }

    // ═════════════════════════════════════════════════════════════════════════
    //  SAVINGS (Emergency Fund & Sinking Funds)
    // ═════════════════════════════════════════════════════════════════════════

    renderSavingsPage() { return renderSavingsPageFeature(this); }
    switchSavingsSubTab(subTab) { return switchSavingsSubTabFeature(this, subTab); }
    attachSavingsEventListeners() { return attachSavingsEventListenersFeature(this); }

    renderHealthDashboard() { return renderHealthDashboardFeature(this); }

    switchLiabilitiesSubTab(subTab) {
        this.liabilitiesSubTab = subTab;
        const section = document.getElementById('liabilitiesSection');
        if (!section) return;
        
        // Update button states
        section.querySelectorAll('.liabilities-subtab-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.liabilitiesSubtab === subTab);
        });
        
        // Show/hide panels
        section.querySelectorAll('.liabilities-subtab-panel').forEach(panel => {
            panel.classList.toggle('visible', panel.dataset.subtab === subTab);
            panel.classList.toggle('hidden', panel.dataset.subtab !== subTab);
        });
    }
}

// Initialize the app when the DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.app = new DebtTrackerApp();
});
