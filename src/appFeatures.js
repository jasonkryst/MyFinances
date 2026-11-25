// Everything the app shell calls after the landing page has painted (#713).
// app.js and ui.js reach these through lazyFeature()/getAppFeatures() in
// lazyModules.js, so none of this is in the first-paint static import graph.
// One dynamic import() of this file fetches the whole second tier together.
// A function app.js or ui.js starts calling must be re-exported here.

export { addDebt, deleteDebt, archiveDebt, unarchiveDebt, showUpdateBalanceModal, updateDebtBalance, saveEdit, cancelEdit, renderDebtsList, startEdit, cancelInlineEdit, saveInlineEdit } from './debts.js';
export { showAccelerateModal } from './debtBreakEven.js';
export { refreshAccountSelectors, updateAccountFormRetirementVisibility, renderAccountsList, addAccount, deleteAccount, startEditAccount, cancelEditAccount, saveEditAccount, archiveAccount, unarchiveAccount, renderAccountBalanceBreakdown } from './accounts.js';
export { renderBudgetPage, addBill, deleteBill, startEditBill, saveEditBill, cancelEditBill, addExpense, deleteExpense, startEditExpense, saveEditExpense, cancelEditExpense } from './bills.js';
export { renderBalanceChart, renderPieChart, renderProgressChart, renderDebtDistributionChart, renderDebtToIncomeChart, renderPayoffGanttChart } from './charts.js';
export { initLiveRefresh, refreshFromServer } from './liveRefresh.js';
export { initNotificationsCenter, refreshNotifications } from './notificationsCenter.js';
export { showPgMigrationModal, showLegacyDataCleanupModal } from './pgMigrationModal.js';
export { exportAllJSON, exportToCSV, exportLedgerToCSV, exportPaymentScheduleCSV, exportChartsAsPng, importAllJSON } from './dataExport.js';
export { recordBalanceHistory, getBalanceHistory, deleteBalanceHistoryEntry, seedMissingBalanceHistory } from './balanceHistory.js';
export { showBalanceHistoryModal } from './balanceHistoryModal.js';
export { renderIncomeList, addIncome, deleteIncome, startEditIncome, cancelEditIncome, saveEditIncome, addBonus, deleteBonus, startEditBonus, cancelEditBonus, saveEditBonus, renderBonusList, renderIncomeTrendChart } from './income.js';
export { showBonusAdvice } from './bonusAdvisor.js';
export { displayPaymentPlan, renderStrategyIncomeWidget, renderPlanHistory, suggestMonthlyPayment } from './strategy.js';
export { displayPaymentSchedule } from './strategyScheduleTable.js';
export { displayDebtSummary, showAmortizationModal } from './strategySummaryTable.js';
export { displayInterestComparison, displayWhatIfSimulator, resetRefinanceScenario } from './strategyComparison.js';
export { prevReportMonth, nextReportMonth, renderReportsPage } from './reports.js';
export { captureNetWorthSnapshot, renderNetWorthWidget } from './reportsNetWorth.js';
export { renderRecurringPage, addRecurringTemplate, deleteRecurringTemplate, pauseRecurringTemplate, archiveRecurringTemplate, unarchiveRecurringTemplate, skipRecurringOccurrence, openRecurringPauseModal, startEditRecurring, cancelEditRecurring, saveEditRecurring, refreshRecurringAccountSelectors } from './recurring.js';
export { markRecurringPaid, openRecurringMarkPaidModal, syncRecurringPaidFromLedger, reconcileRecurringPaidState } from './recurringPaid.js';
export { renderSavingsPage, switchSavingsSubTab, attachSavingsEventListeners } from './savings.js';
export { openKeyboardShortcutsModal } from './keyboardShortcuts.js';
export { maybeShowSetupWizard, initSettingsModal, openSettings } from './setupWizard.js';
export { initDataTransferModal, showImportResult, requestImportModeChoice } from './dataTransferModal.js';
export { initCalendarFeedModal } from './calendarFeed.js';
export { addPerson, deletePerson, startEditPerson, cancelEditPerson, saveEditPerson, renderPeopleList, refreshPersonSelectors } from './people.js';
export { renderLedgerPage } from './ledger.js';
export { refreshCategoryDatalist } from './recurring.js';
