import {
    addDebt as addDebtFeature,
    deleteDebt as deleteDebtFeature,
    archiveDebt as archiveDebtFeature,
    unarchiveDebt as unarchiveDebtFeature,
    showUpdateBalanceModal as showUpdateBalanceModalFeature,
    updateDebtBalance as updateDebtBalanceFeature,
    saveEdit as saveEditFeature,
    cancelEdit as cancelEditFeature,
    renderDebtsList as renderDebtsListFeature,
    startEdit as startEditDebtFeature,
    cancelInlineEdit as cancelInlineEditDebtFeature,
    saveInlineEdit as saveInlineEditDebtFeature
} from './debts.js';
import { showAccelerateModal as showAccelerateModalFeature } from './debtBreakEven.js';
import { renderAccountsList, addAccount as addAccountFeature, deleteAccount as deleteAccountFeature, startEditAccount as startEditAccountFeature, cancelEditAccount as cancelEditAccountFeature, saveEditAccount as saveEditAccountFeature, computeAccountBalance as computeAccountBalanceFeature, archiveAccount as archiveAccountFeature, unarchiveAccount as unarchiveAccountFeature, renderAccountBalanceBreakdown as renderAccountBalanceBreakdownFeature } from './accounts.js';
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
    renderDebtToIncomeChart as renderDebtToIncomeChartFeature,
    renderPayoffGanttChart as renderPayoffGanttChartFeature
} from './charts.js';
import { saveToStorage, backfillIncomeAccountIds, clearAllData as clearAllDataFeature, probeServer, loadFromPostgres, SessionExpiredError } from './storage.js';
import { initLiveRefresh, refreshFromServer as refreshFromServerFeature } from './liveRefresh.js';
import { showServerUnreachable } from './serverUnreachableGate.js';
import { requestLogin } from './loginGate.js';
import { showPgMigrationModal, showLegacyDataCleanupModal } from './pgMigrationModal.js';
import { exportAllJSON as exportAllJSONFeature, exportToCSV as exportToCSVFeature, exportLedgerToCSV as exportLedgerToCSVFeature, exportPaymentScheduleCSV as exportPaymentScheduleCSVFeature, exportChartsAsPng as exportChartsAsPngFeature, importAllJSON as importAllJSONFeature } from './dataExport.js';
import {
    recordBalanceHistory as recordBalanceHistoryFeature,
    getBalanceHistory as getBalanceHistoryFeature,
    deleteBalanceHistoryEntry as deleteBalanceHistoryEntryFeature,
    seedMissingBalanceHistory as seedMissingBalanceHistoryFeature
} from './balanceHistory.js';
import { showBalanceHistoryModal as showBalanceHistoryModalFeature } from './balanceHistoryModal.js';
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
    renderBonusList,
    renderIncomeTrendChart
} from './income.js';
import { showBonusAdvice } from './bonusAdvisor.js';
import {
    calculatePaymentPlanFromInputs as calculatePaymentPlanFromInputsFeature,
    calculateRequiredPayment as calculateRequiredPaymentFeature,
    restoreLastPlan as restoreLastPlanFeature
} from './strategyPlanCalculation.js';
import {
    displayPaymentPlan as displayPaymentPlanFeature,
    renderStrategyIncomeWidget as renderStrategyIncomeWidgetFeature,
    renderPlanHistory as renderPlanHistoryFeature,
    suggestMonthlyPayment as suggestMonthlyPaymentFeature
} from './strategy.js';
import {
    displayPaymentSchedule as displayPaymentScheduleFeature
} from './strategyScheduleTable.js';
import {
    displayDebtSummary as displayDebtSummaryFeature,
    showAmortizationModal as showAmortizationModalFeature
} from './strategySummaryTable.js';
import {
    displayInterestComparison as displayInterestComparisonFeature,
    displayWhatIfSimulator as displayWhatIfSimulatorFeature,
    resetRefinanceScenario as resetRefinanceScenarioFeature
} from './strategyComparison.js';
import {
    prevReportMonth as prevReportMonthFeature,
    nextReportMonth as nextReportMonthFeature,
    renderReportsPage as renderReportsPageFeature
} from './reports.js';
import {
    captureNetWorthSnapshot as captureNetWorthSnapshotFeature,
    renderNetWorthWidget as renderNetWorthWidgetFeature
} from './reportsNetWorth.js';
import { initializeEventListeners as initializeUIEventListeners, switchTab as switchTabFeature, updateFormVisibility as updateFormVisibilityFeature, switchPage as switchPageFeature, renderPageData as renderPageDataFeature, switchLiabilitiesSubTab as switchLiabilitiesSubTabFeature, updateUI as updateUIFeature, showMilestone as showMilestoneFeature, showNetWorthMilestone as showNetWorthMilestoneFeature, showUpdateAvailableBanner as showUpdateAvailableBannerFeature, checkWhatsNew as checkWhatsNewFeature, openWhatsNewModal as openWhatsNewModalFeature, showAlertModal } from './ui.js';
import { registerServiceWorker } from './serviceWorker.js';
import { APP_VERSION, renderLazyLoadError } from './utils.js';
import {
    loadRetirementModule,
    loadReconciliationModule,
    loadTransfersModule,
    loadManualTransactionsModule,
    loadStrategyCalendarModule,
    loadReportsSubModules
} from './lazyModules.js';
import {
    renderRecurringPage as renderRecurringPageFeature,
    addRecurringTemplate as addRecurringTemplateFeature,
    deleteRecurringTemplate as deleteRecurringTemplateFeature,
    pauseRecurringTemplate as pauseRecurringTemplateFeature,
    archiveRecurringTemplate as archiveRecurringTemplateFeature,
    unarchiveRecurringTemplate as unarchiveRecurringTemplateFeature,
    skipRecurringOccurrence as skipRecurringOccurrenceFeature,
    openRecurringPauseModal as openRecurringPauseModalFeature,
    startEditRecurring as startEditRecurringFeature,
    cancelEditRecurring as cancelEditRecurringFeature,
    saveEditRecurring as saveEditRecurringFeature,
    refreshRecurringAccountSelectors as refreshRecurringAccountSelectorsFeature
} from './recurring.js';
import {
    markRecurringPaid as markRecurringPaidFeature,
    openRecurringMarkPaidModal as openRecurringMarkPaidModalFeature,
    syncRecurringPaidFromLedger as syncRecurringPaidFromLedgerFeature,
    reconcileRecurringPaidState as reconcileRecurringPaidStateFeature
} from './recurringPaid.js';
import {
    renderSavingsPage as renderSavingsPageFeature,
    switchSavingsSubTab as switchSavingsSubTabFeature,
    attachSavingsEventListeners as attachSavingsEventListenersFeature
} from './savings.js';
import { renderHealthDashboard as renderHealthDashboardFeature } from './health.js';
import { openKeyboardShortcutsModal as openKeyboardShortcutsModalFeature } from './keyboardShortcuts.js';
import { getFilteredSortedLedgerTransactions as getFilteredSortedLedgerTransactionsFeature } from './ledgerTransactions.js';
import { getSetting as getSettingFeature, setSetting as setSettingFeature, AUTO_NW_SNAPSHOT, RECONCILIATION_ADJUSTS_BALANCE } from './settings.js';
import { maybeShowSetupWizard as maybeShowSetupWizardFeature, initSettingsModal as initSettingsModalFeature } from './setupWizard.js';
import { initDataTransferModal, showImportResult, requestImportModeChoice } from './dataTransferModal.js';
import { initCalendarFeedModal } from './calendarFeed.js';
import { applyStaticTranslations, setLocale as setLocaleFeature, t } from './i18n.js';
import {
    addPerson as addPersonFeature,
    deletePerson as deletePersonFeature,
    startEditPerson as startEditPersonFeature,
    cancelEditPerson as cancelEditPersonFeature,
    saveEditPerson as saveEditPersonFeature,
    renderPeopleList as renderPeopleListFeature,
    refreshPersonSelectors as refreshPersonSelectorsFeature
} from './people.js';

/**
 * app.js — Debt Tracker Application (ES module)
 * Main UI controller and data manager for the Debt Tracker web app.
 *
 * Modularized for modern browser support.
 */

export class DebtTrackerApp {
    constructor() {
        this.persons = [];
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
        this.reconciliations = [];
        this.planHistory = [];
        this.retirementSnapshots = [];
        this.transfers = [];
        this.manualTransactions = [];
        this.retirementTargetDate = null;
        this.homePurchasePlan = null;
        this.budgetCategories = {};
        this.balanceHistory = [];
        this._retireBalanceChart = null;
        this._retireContributionChart = null;
        this._retireBreakdownChart = null;
        this.settings = [];
        this.ledgerAmountOverrides = {};
        this.ledgerClearedTransactions = {};
        this.lastPaymentPlan = null;
        this.lastSummary = null;
        this._planFingerprint = null;
        this.perMonthStimulus = [];
        this.editingDebtId = null;
        this.editingIncomeId = null;
        this.editingAccountId = null;
        this.editingPersonId = null;
        this.editingRecurringId = null;
        this.savingsSubTab = 'emergency';
        this._reportMonthOffset = 0;
        this._reportRangeMonths = 1;
        this._expenseMonthOffset = 0;
            this.liabilitiesSubTab = 'debts';
        this._savedMonthlyPayment = null;
        this._savedStrategy = null;
    this._netWorthRangeMonths = 6;
    this._cashFlowTrendRangeMonths = 6;
    this._forecastRangeMonths = 1;
    this._forecastAccountId = 'total';
    this._forecastNotableThresholdPct = 130;
    this._reconciliationAccountFilter = 'all';

        // Respect prefers-reduced-motion: Chart.js animates every render by
        // default (entry animation + per-update transitions), which CSS alone
        // can't reach since it's driven by canvas drawing, not DOM transitions.
        if (typeof Chart !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            Chart.defaults.animation = false;
            Chart.defaults.transitions.active.animation.duration = 0;
        }

        applyStaticTranslations();

        this.initializeEventListeners();
    }

    // Boot (v7.0.0, spec §5): the PostgreSQL server is the only storage.
    async init() {
        // §5 step 5: the backend preference from the local/session-storage era
        // means nothing now; drop it unconditionally.
        try { localStorage.removeItem('debtTrackerStorageBackend'); } catch (_) { /* storage blocked */ }

        // §5 steps 1-3: probe, sign in if needed, load. Any failure shows the
        // "Can't reach your server" gate; its Retry resolves once the server
        // answers again and the whole sequence re-runs. Nothing is rendered
        // from data while a gate is up.
        // Consecutive SessionExpiredError re-probes are capped: a server that
        // reports a session but 401s the data would otherwise loop forever.
        let expiredReprobes = 0;
        for (;;) {
            const probe = await probeServer();
            if (!probe.reachable) {
                // A 429 from /auth/setup-status is mapped to reachable by
                // probeServer(), so this retry loop can't spin on the limiter.
                this._markReadyBehindGate();
                await showServerUnreachable(this);
                continue;
            }
            if (!probe.hasSession) {
                this._markReadyBehindGate();
                await requestLogin(this, { needsSetup: probe.needsSetup === true });
            }
            try {
                await loadFromPostgres(this);
                break;
            } catch (err) {
                // The session expired between probe and load: re-probe, which
                // now reports no session and shows the login gate.
                if (err instanceof SessionExpiredError && ++expiredReprobes <= 2) continue;
                console.error('Loading data from the server failed:', err);
                this._markReadyBehindGate();
                await showServerUnreachable(this);
            }
        }

        // §5 step 4 (legacy browser data) — true when a prompt was shown.
        const legacyPromptShown = await this._handleLegacyBrowserData();

        // §5 step 6: first run means the wizard has never stored its setting
        // (it persists a default the moment it opens) AND there is no data.
        // Existing users who never opened Settings lack the setting too; the
        // empty-data check keeps the wizard (and the silent What's New
        // "seen" mark below) away from them.
        const isFirstRun = this._isFirstRun();
        if (isFirstRun && !legacyPromptShown) maybeShowSetupWizardFeature(this, true);

        const versionEl = document.getElementById('appVersion');
        if (versionEl) versionEl.textContent = `v${APP_VERSION}`;

        checkWhatsNewFeature(isFirstRun);

        // Auto-capture monthly net worth snapshot if enabled
        if (getSettingFeature(this, AUTO_NW_SNAPSHOT, false)) {
            const now = new Date();
            const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
            const snapshots = Array.isArray(this.monthlySnapshots) ? this.monthlySnapshots : [];
            const hasCurrentMonth = snapshots.some(s => {
                const sMonthKey = String(s?.date || '').slice(0, 7);
                return sMonthKey === monthKey;
            });
            if (!hasCurrentMonth) {
                this.captureNetWorthSnapshot({ source: 'auto', silent: true, skipMilestone: true });
            }
        }

        backfillIncomeAccountIds(this);
        // #434: migrate legacy recurring paidMonths/paidAmounts into the Ledger.
        // It persists the templates it changes itself.
        this.reconcileRecurringPaidState();
        await this.seedMissingBalanceHistory();
        initSettingsModalFeature(this);
        initDataTransferModal(this);
        initCalendarFeedModal(this);
        this.updateUI();
        this.updateFormVisibility();
        this.switchPage('health');
        // #575: from here on, other tabs' writes and returning to this tab
        // re-read the server.
        initLiveRefresh(this);
    }

    // The readiness marker (issue #422) also goes up while boot waits at a
    // gate, so tests and tooling can tell "stopped at a gate" from "still
    // starting".
    _markReadyBehindGate() {
        document.documentElement.dataset.appReady = 'true';
    }

    _isFirstRun() {
        const hasSetting = (this.settings || []).some(s => s?.key === RECONCILIATION_ADJUSTS_BALANCE);
        if (hasSetting) return false;
        const collections = [this.accounts, this.debts, this.incomes, this.recurringTemplates,
            this.emergencyFunds, this.sinkingFunds];
        return collections.every(c => !Array.isArray(c) || c.length === 0);
    }

    // Legacy browser-only data (spec §5 step 4). Returns true when a prompt
    // was shown, which suppresses the setup wizard.
    async _handleLegacyBrowserData() {
        let localJson = null;
        try { localJson = window.localStorage.getItem('debtTrackerData'); } catch (_) { return false; }
        if (!localJson) return false;
        try {
            JSON.parse(localJson);
        } catch {
            try { window.localStorage.removeItem('debtTrackerData'); } catch (_) { /* storage blocked */ }
            return false;
        }
        const serverIsEmpty = [
            this.debts, this.accounts, this.incomes, this.bills, this.expenses,
            this.recurringTemplates, this.emergencyFunds, this.sinkingFunds,
            this.reconciliations, this.persons, this.transfers, this.manualTransactions, this.balanceHistory,
        ].every(c => !Array.isArray(c) || c.length === 0);
        // Boot waits on the prompt; flag readiness so tooling can tell that apart from a hang.
        this._markReadyBehindGate();
        if (serverIsEmpty) await showPgMigrationModal(this, localJson);
        else await showLegacyDataCleanupModal(localJson);
        return true;
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
     * Silently recalculate and reveal the last-submitted plan's results on
     * load, using the saved monthlyPayment/strategy (issue #162). No-op if a
     * plan is already displayed or no saved plan/debts exist.
     */
    restoreLastPlan() {
        return restoreLastPlanFeature(this);
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

    archiveDebt(debtId) {
        return archiveDebtFeature(this, debtId);
    }

    unarchiveDebt(debtId) {
        return unarchiveDebtFeature(this, debtId);
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
            onMissingPlan: () => showAlertModal('Please calculate a payment plan first')
        });
    }

    exportLedgerToCSV(columns) {
        return exportLedgerToCSVFeature(this, columns);
    }

    exportPaymentScheduleCSV() {
        return exportPaymentScheduleCSVFeature(this);
    }

    exportChartsAsPng() {
        return exportChartsAsPngFeature(this);
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
     * Re-render whichever page is currently visible (`this._currentPage`) in
     * place, without resetting its view state (Liabilities subtab, Reports
     * month offset, etc.). Used to reflect data changes that happen while
     * the user is looking at a page — e.g. a successful JSON import.
     */
    refreshCurrentPageData() {
        return renderPageDataFeature(this, this._currentPage, { resetToDefaults: false });
    }

    // Re-read the server in place (#575/#565); see liveRefresh.js.
    refreshFromServer() {
        return refreshFromServerFeature(this);
    }

    /**
     * Render the Debts page list.
     * Each debt is shown as a card with:
     *   - Name, balance, APR, minimum payment, due date, category
     *   - A negative-amortization warning badge if APR causes the balance to grow
     *   - A paydown progress bar (requires `originalBalance`)
     *   - Monthly interest cost estimate
     *   - Interest Paid to Date stat (credit-card debts with `debtStartDate` only)
     *   - Last updated date (day the debt was created or last edited)
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
    async addIncome() {
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
     * Compute and render the Bonus Advisor comparison (cash flow vs savings)
     * for the amount currently entered in the bonus form.
     */
    showBonusAdvice() {
        return showBonusAdvice(this);
    }

    /**
     * Render the income list and summary panel inside the Income page.
     */
    renderIncomeList() {
        return renderIncomeList(this);
    }

    /**
     * Render the Income Trend chart (regular income vs. bonuses, optional
     * year-over-year overlay) on the Income page.
     */
    renderIncomeTrendChart() {
        return renderIncomeTrendChart(this);
    }

    /**
     * Render (or hide) the income context widget on the Strategy page.
     * Shows monthly expected income alongside the current monthly payment
     * commitment so the user can see the ratio at a glance.
     */
    renderStrategyIncomeWidget() {
        return renderStrategyIncomeWidgetFeature(this);
    }

    suggestMonthlyPayment() {
        return suggestMonthlyPaymentFeature(this);
    }

    /**
     * Render the read-only Plan History table on the Plan page — one row per
     * previously submitted "Calculate Payment Plan" run, newest first.
     */
    renderPlanHistory() {
        return renderPlanHistoryFeature(this);
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
     * On success, refreshes both the Debts list (`updateUI()`) and whichever
     * page the user currently has open (`refreshCurrentPageData()`), so
     * imported data shows up immediately without navigating away and back.
     * @param {File} file
     */
    importAllJSON(file) {
        return importAllJSONFeature(this, file, {
            // Hard failure (#291): the file isn't parseable JSON at all. Stays
            // inline (not a popup modal) per the established Backup & Restore
            // pattern of never using alert()/confirm()-style interruptions for
            // import validation — but now includes the native parse error,
            // which already carries a position and often a line/column.
            onInvalidJSON: (parseErrorMessage) => showImportResult('error', `Invalid JSON file: ${parseErrorMessage}`),
            onNoData: () => showImportResult('error', 'No recognisable data found in the selected file.'),
            requestImportMode: (parts) => requestImportModeChoice(parts),
            onImported: (parts, warnings) => showImportResult('success', `Imported: ${parts.join(', ')}.`, warnings),
            onMergeDuplicates: (skipped, warnings) => {
                const list = Object.entries(skipped)
                    .map(([field, count]) => t('import.mergeSkippedItem', { label: t(`import.skippedType.${field}`), count }))
                    .join(', ');
                showImportResult('success', t('import.mergeSkipped', { list }), warnings);
            },
            onTooLarge: (maxBytes) => {
                showImportResult('error', `Import file is too large. Maximum supported size is ${Math.round(maxBytes / 1024)} KB.`);
            },
            onReadError: () => showImportResult('error', 'Could not read the file. Please try again.')
        });
    }

    /**
     * Wipe all debts and reset every piece of app state, then confirm to the user.
     * Resets in-memory state, deletes every record on the server (awaited),
     * and resets all form fields.
     */
    clearAllData() {
        return clearAllDataFeature(this, {
            onCleared: () => showAlertModal('All app data and saved preferences have been cleared.')
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

    showUpdateAvailableBanner(waitingWorker) {
        return showUpdateAvailableBannerFeature(waitingWorker);
    }

    checkWhatsNew(isFirstRun) { return checkWhatsNewFeature(isFirstRun); }
    openWhatsNewModal() { return openWhatsNewModalFeature(); }

    /**
     * Persist the named plan-settings fields to the server
     * (PATCH /api/plan-settings, issue #564), e.g. saveToStorage(['strategy']).
     * Record collections are synced by their feature modules and never call this.
     */
    saveToStorage(fields) {
        return saveToStorage(this, fields);
    }

    /**
     * Switch the active UI language ('en' | 'es' | 'pl'), persisting the
     * preference and re-rendering translated content.
     */
    setLocale(code) {
        return setLocaleFeature(this, code);
    }

    /**
     * Activate a Results sub-tab by name.
     * Valid tab names: `'table'`, `'chart'`, `'calendar'`.
     * Side effects:
     *   - `'chart'` triggers `renderPayoffGanttChart()`, `renderBalanceChart()`, `renderProgressChart()`, `renderPieChart()`
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
    async renderCalendarView(page = 0) {
        try {
            const mod = await loadStrategyCalendarModule();
            return mod.renderCalendarView(this, page);
        } catch (err) {
            console.error('Failed to load strategy calendar module', err);
            renderLazyLoadError('calendar-tab', 'the Payment Calendar');
        }
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

    /** Reset the what-if Refinancing scenario section to empty (#320). */
    resetRefinanceScenario() {
        return resetRefinanceScenarioFeature(this);
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

    showAccelerateModal(debtId) {
        return showAccelerateModalFeature(this, debtId);
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

    /**
     * Payoff Timeline: horizontal-bar Gantt view of each debt's span from
     * the plan start to its own payoff month (#314).
     */
    renderPayoffGanttChart() {
        return renderPayoffGanttChartFeature(this);
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

    /** Archive an account (hides it from the list by default). */
    archiveAccount(id) {
        return archiveAccountFeature(this, id);
    }

    /** Unarchive a previously archived account. */
    unarchiveAccount(id) {
        return unarchiveAccountFeature(this, id);
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

    /** Return the Ledger page's filtered (account + date-range) and sorted transaction list, unpaginated. */
    getFilteredSortedLedgerTransactions() {
        return getFilteredSortedLedgerTransactionsFeature(this);
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

    async computeReportsSummaryMetrics(rangeType, baseDate) {
        const mods = await loadReportsSubModules();
        return mods.summary.computeReportsSummaryMetrics(this, rangeType, baseDate);
    }

    async getCashFlowTrendSeries(months) {
        const mods = await loadReportsSubModules();
        return mods.cashFlow.getCashFlowTrendSeries(this, months);
    }

    async computeMoneyFlowSankeyData(year, month) {
        const mods = await loadReportsSubModules();
        return mods.sankey.computeMoneyFlowSankeyData(this, year, month);
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  RECURRING TRANSACTION TEMPLATES
    // ═════════════════════════════════════════════════════════════════════════

    renderRecurringPage() { return renderRecurringPageFeature(this); }
    addRecurringTemplate() { return addRecurringTemplateFeature(this); }
    deleteRecurringTemplate(id) { return deleteRecurringTemplateFeature(this, id); }
    pauseRecurringTemplate(id, paused, pauseUntil) { return pauseRecurringTemplateFeature(this, id, paused, pauseUntil); }
    archiveRecurringTemplate(id) { return archiveRecurringTemplateFeature(this, id); }
    unarchiveRecurringTemplate(id) { return unarchiveRecurringTemplateFeature(this, id); }
    skipRecurringOccurrence(id, monthKey, unskip) { return skipRecurringOccurrenceFeature(this, id, monthKey, unskip); }
    markRecurringPaid(id, monthKey, unmark, actualAmount) { return markRecurringPaidFeature(this, id, monthKey, unmark, actualAmount); }
    openRecurringMarkPaidModal(id, monthKey) { return openRecurringMarkPaidModalFeature(this, id, monthKey); }
    syncRecurringPaidFromLedger(txIds) { return syncRecurringPaidFromLedgerFeature(this, txIds); }
    reconcileRecurringPaidState() { return reconcileRecurringPaidStateFeature(this); }
    openRecurringPauseModal(id) { return openRecurringPauseModalFeature(this, id); }
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

    // Issue #278: reconciliation.js is loaded on demand. Every wrapper method
    // here awaits the shared loader (loadReconciliationModule() resolves
    // instantly once cached, so this costs nothing after the first call) --
    // these are called directly by data-layer tests and potentially other
    // code without the Reconcile page ever having rendered, so none of them
    // can safely assume the module is already loaded. renderReconciliationPage
    // and openReconcileModal additionally handle a failed import gracefully
    // (in-page error / alert respectively, since openReconcileModal's caller,
    // the Ledger page, has no Reconcile-page DOM of its own to host one).
    async renderReconciliationPage() {
        try {
            const mod = await loadReconciliationModule();
            return mod.renderReconciliationPage(this);
        } catch (err) {
            console.error('Failed to load reconciliation module', err);
            renderLazyLoadError('reconcileSection', 'the Reconcile page');
        }
    }
    async applyReconciliation(accountId, statementBalance, note, dates) {
        const mod = await loadReconciliationModule();
        return mod.applyReconciliation(this, accountId, statementBalance, note, dates);
    }
    async reconcileAccount(accountId) {
        const mod = await loadReconciliationModule();
        return mod.reconcileAccount(this, accountId);
    }
    async deleteReconciliationEntry(id) {
        const mod = await loadReconciliationModule();
        return mod.deleteReconciliationEntry(this, id);
    }
    async openReconcileModal(accountId) {
        try {
            const mod = await loadReconciliationModule();
            return mod.openReconcileModal(this, accountId);
        } catch (err) {
            console.error('Failed to load reconciliation module', err);
            showAlertModal("Couldn't load the Reconcile feature. Check your connection and try again.");
        }
    }
    async getExpectedTransactionsInRange(accountId, startDate, endDate) {
        const mod = await loadReconciliationModule();
        return mod.getExpectedTransactionsInRange(this, accountId, startDate, endDate);
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  TRANSFERS (issue #248)
    // ═════════════════════════════════════════════════════════════════════════

    // transfers.js is lazy-loaded (issue #278 pattern) -- same reasoning as the
    // Reconciliation group above: these wrappers are called directly from the
    // Accounts/Ledger pages, which have no reason to have already loaded it.
    async addTransfer(fromAccountId, toAccountId, amount, date, memo) {
        const mod = await loadTransfersModule();
        return mod.addTransfer(this, fromAccountId, toAccountId, amount, date, memo);
    }
    async editTransfer(id, fields) {
        const mod = await loadTransfersModule();
        return mod.editTransfer(this, id, fields);
    }
    async deleteTransfer(id) {
        const mod = await loadTransfersModule();
        return mod.deleteTransfer(this, id);
    }
    async openTransferModal(options) {
        try {
            const mod = await loadTransfersModule();
            return mod.openTransferModal(this, options);
        } catch (err) {
            console.error('Failed to load transfers module', err);
            showAlertModal("Couldn't load the Transfer feature. Check your connection and try again.");
        }
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  MANUAL TRANSACTIONS (issue #584), lazy-loaded like transfers
    // ═════════════════════════════════════════════════════════════════════════

    async addManualTransaction(fields) {
        const mod = await loadManualTransactionsModule();
        return mod.addManualTransaction(this, fields);
    }
    async editManualTransaction(id, fields) {
        const mod = await loadManualTransactionsModule();
        return mod.editManualTransaction(this, id, fields);
    }
    async deleteManualTransaction(id) {
        const mod = await loadManualTransactionsModule();
        return mod.deleteManualTransaction(this, id);
    }
    async openManualTransactionModal(options) {
        try {
            const mod = await loadManualTransactionsModule();
            return mod.openManualTransactionModal(this, options);
        } catch (err) {
            console.error('Failed to load manual transactions module', err);
            showAlertModal(t('manualTx.loadFailed'));
        }
    }

    // ═════════════════════════════════════════════════════════════════════════
    //  RETIREMENT
    // ═════════════════════════════════════════════════════════════════════════

    // Issue #278: retirement.js is loaded on demand. Every wrapper method here
    // awaits the shared loader for the same reason as the reconciliation group
    // above -- data-layer tests (and potentially other future callers) invoke
    // these directly without the Retirement page ever having rendered.
    // retirement.js's own internal rendering code (renderProjectionPanel) calls
    // the local computeAccountProjection()/getRetirementAccounts() functions
    // directly rather than through these async wrappers, since it needs a
    // synchronous value and is already guaranteed to be running after load.
    async getRetirementAccounts() {
        const mod = await loadRetirementModule();
        return mod.getRetirementAccounts(this);
    }
    async getSnapshotsForAccount(accountId) {
        const mod = await loadRetirementModule();
        return mod.getSnapshotsForAccount(this, accountId);
    }
    async addRetirementSnapshot(accountId, date, balance, contribution, annualSalary = null) {
        const mod = await loadRetirementModule();
        return mod.addRetirementSnapshot(this, accountId, date, balance, contribution, annualSalary);
    }
    recordBalanceHistory(owner) { return recordBalanceHistoryFeature(this, owner); }
    getBalanceHistory(owner) { return getBalanceHistoryFeature(this, owner); }
    deleteBalanceHistoryEntry(id) { return deleteBalanceHistoryEntryFeature(this, id); }
    seedMissingBalanceHistory() { return seedMissingBalanceHistoryFeature(this); }
    showBalanceHistoryModal(owner) { return showBalanceHistoryModalFeature(this, owner); }
    showAccountBalanceBreakdown(accountId, triggerEl) { return renderAccountBalanceBreakdownFeature(this, accountId, triggerEl); }
    async deleteRetirementSnapshot(id) {
        const mod = await loadRetirementModule();
        return mod.deleteRetirementSnapshot(this, id);
    }
    async computeAccountProjection(accountId) {
        const mod = await loadRetirementModule();
        return mod.computeAccountProjection(this, accountId);
    }
    // Issue #264: same async-lazy pattern as its siblings above (#278).
    async computeAccountProjectionScenarios(accountId, conservativeDelta, aggressiveDelta) {
        const mod = await loadRetirementModule();
        return mod.computeAccountProjectionScenarios(this, accountId, conservativeDelta, aggressiveDelta);
    }
    async renderRetirementPage() {
        try {
            const mod = await loadRetirementModule();
            return mod.renderRetirementPage(this);
        } catch (err) {
            console.error('Failed to load retirement module', err);
            renderLazyLoadError('retirementSection', 'the Retirement page');
        }
    }

    addPerson() { return addPersonFeature(this); }
    deletePerson(id) { return deletePersonFeature(this, id); }
    startEditPerson(id) { return startEditPersonFeature(this, id); }
    cancelEditPerson() { return cancelEditPersonFeature(this); }
    saveEditPerson(id) { return saveEditPersonFeature(this, id); }
    renderPeopleList() { return renderPeopleListFeature(this); }
    refreshPersonSelectors() { return refreshPersonSelectorsFeature(this); }

    openKeyboardShortcuts() { return openKeyboardShortcutsModalFeature(this); }

    getSetting(key, defaultValue) { return getSettingFeature(this, key, defaultValue); }
    setSetting(key, value) { return setSettingFeature(this, key, value); }

    switchLiabilitiesSubTab(subTab) {
        switchLiabilitiesSubTabFeature(this, subTab);
    }
}

// Initialize the app when the DOM is ready
document.addEventListener('DOMContentLoaded', async () => {
    try {
        window.app = new DebtTrackerApp();
        await window.app.init();
    } finally {
        // Readiness marker (issue #422): set once startup settles — even if the
        // constructor or init() throws —
        // so tests (and anything else) can wait for a fully initialized app instead of
        // racing the window.app assignment. A data attribute keeps it CSP-safe.
        document.documentElement.dataset.appReady = 'true';
    }
    const pageParam = new URLSearchParams(window.location.search).get('page');
    if (pageParam) window.app.switchPage(pageParam);
    registerServiceWorker(window.app);
});



