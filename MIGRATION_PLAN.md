# app.js to src Module Migration Plan

This plan completes modularization in safe, testable phases while keeping the app functional after each step.

## Status (completed in this change)

- Runtime entry moved from root `app.js` to `src/app.js`.
- `index.html` now loads `src/app.js` directly.
- Import paths in `src/app.js` were updated to local `src/*` modules.
- Phase 1 executed: event listener wiring extracted into `src/ui.js` and `DebtTrackerApp.initializeEventListeners()` now delegates.
- Phase 2 partially executed: strategy handlers `calculatePaymentPlanFromInputs`, `calculateRequiredPayment`, and `displayPaymentPlan` extracted to `src/strategy.js` with delegator methods in `src/app.js`.
- Phase 2 advanced: `displayInterestComparison` and `displayWhatIfSimulator` extracted to `src/strategy.js` with delegator methods.
- Phase 2 completed: `displayDebtSummary` and `displayPaymentSchedule` extracted to `src/strategy.js` with delegator methods.
- Phase 4 partially executed: income/bonus CRUD, budget CRUD/render, accounts render, and storage load/save now delegate from `src/app.js` to `src` modules.
- Phase 3 completed: debt list rendering and inline-edit handlers moved to `src/debts.js`; `src/app.js` now delegates `renderDebtsList`, `startEdit`, `cancelInlineEdit`, and `saveInlineEdit`.
- Debt CRUD path restored in src runtime: `addDebt` and `deleteDebt` now delegate through `src/debts.js`, and debt form/category/debt-type listeners are wired in `src/ui.js`.
- Phase 4 completed: `renderIncomeList` and `renderBonusList` now live in `src/income.js`, and `src/app.js` delegates to those module functions.

## Target Architecture

- `src/app.js`: lightweight app composition and bootstrapping only.
- `src/state/`: app state shape, defaults, and mutation helpers.
- `src/features/debts/`: debt CRUD, debt list render, inline edits, debt balance updates.
- `src/features/strategy/`: payment-plan calculation handlers, target payoff, schedule rendering, summary rendering.
- `src/features/income/`: income + bonus CRUD and rendering.
- `src/features/budget/`: bills + expense CRUD and rendering.
- `src/features/accounts/`: account CRUD, account projections, selector syncing.
- `src/features/reports/`: reports tab rendering and charts.
- `src/features/ledger/`: transaction projection and ledger rendering.
- `src/services/storage.js`: persistence/export/import.
- `src/services/charts.js`: chart lifecycle helpers.
- `src/utils/`: formatters/date/number helpers.

## Migration Phases

### Phase 1 - Bootstrapping + Event Wiring

- Completed.

### Phase 2 - Strategy Domain

- Completed.
- Completed:
  - `calculatePaymentPlanFromInputs`
  - `calculateRequiredPayment`
  - `displayPaymentPlan`
  - `displayDebtSummary`
  - `displayPaymentSchedule`
  - `displayInterestComparison`
  - `displayWhatIfSimulator`
- Keep all calculation calls through `DebtCalculator.calculatePaymentPlan(...)`.
- Add a single module export surface for strategy actions.

### Phase 3 - Debt Domain

- Completed.
- Completed:
  - `addDebt`
  - `deleteDebt`
  - `renderDebtsList`
  - `startEdit`
  - `cancelInlineEdit`
  - `saveInlineEdit`

### Phase 4 - Accounts, Income, Budget Domain Completion

- Remove duplicate in-class implementations already partially extracted into src modules.
- Standardize on one implementation per feature module.
- Keep `app` object passed explicitly to feature functions.

Current progress:
- Delegated in `src/app.js`: `addIncome`, `deleteIncome`, `startEditIncome`, `cancelEditIncome`, `saveEditIncome`, `addBonus`, `deleteBonus`, `startEditBonus`, `cancelEditBonus`, `saveEditBonus`.
- Delegated in `src/app.js`: `renderIncomeList`, `renderBonusList`.
- Delegated in `src/app.js`: `addBill`, `deleteBill`, `startEditBill`, `saveEditBill`, `cancelEditBill`, `addExpense`, `deleteExpense`, `startEditExpense`, `saveEditExpense`, `cancelEditExpense`, `renderBudgetPage`.
- Delegated in `src/app.js`: `renderAccountsList`, `saveToStorage`, `loadFromStorage`.
- Remaining in this phase: none.

Immediate next slice:
- Phase 5: move reports + ledger methods from `src/app.js` into feature modules and keep shared projection/date helpers in `src/utils`.

### Phase 5 - Reports + Ledger

- Move reports and ledger methods from `src/app.js` into their feature modules.
- Consolidate shared date window/projection utilities in `src/utils/date.js`.

Current progress:
- Added `src/reports.js` and moved reports month-nav + rendering methods there.
- Delegated in `src/app.js`: `_getReportDate`, `prevReportMonth`, `nextReportMonth`, `_updateReportMonthNav`, `renderReportsPage`, `_renderReportsCalendar`, `_renderReportsIncomeExp`, `_renderReportsMoneyFlow`.
- Removed redundant in-class ledger helper implementations (`_getLedgerTransactions`, `_formatLedgerDate`) from `src/app.js`; ledger rendering remains module-owned in `src/ledger.js`.
- Shared payday projection utility added in `src/utils.js` (`getIncomePaydaysInMonth`) and now reused by both `src/reports.js` and `src/ledger.js` to keep date logic consistent.
- Additional shared utilities added in `src/utils.js`: `countIncomePaydaysInMonth`, `getNextIncomePayDates`, `computeMonthlyBonusesForMonth`, `computeMonthlyIncomeForMonth`.
- `src/app.js` now delegates `nextPayDates`, `paydaysInCurrentMonth`, `computeMonthlyIncome`, and `computeMonthlyBonuses` to shared utilities; account projection uses utility payday counts.
- Removed now-unused `_incomeDaysInMonth` wrapper from `src/app.js`.
- Moved account balance projection helper into `src/accounts.js` (`computeAccountBalance`) and delegated `src/app.js` `computeAccountBalance(...)` to the accounts feature module.
- Added shared calendar/day-map utilities in `src/utils.js`: `getBillsByDayForMonth`, `getBonusesByDayForMonth`, `getIncomeEventsByMonthForRange`.
- `src/reports.js` now uses utility day-map helpers for report calendar bill/bonus rendering.
- `src/app.js` strategy calendar (`renderCalendarView`) now uses utility helpers for income month projection and bill day mapping.
- Strategy calendar extraction completed: full `renderCalendarView` implementation moved into `src/strategy.js`; `src/app.js` now delegates `renderCalendarView(page)` to the strategy feature.
- Budget rendering extraction completed: `src/bills.js` now owns bill/expense list rendering and cashflow summary/chart rendering; `src/app.js` delegates `_renderBillList`, `_renderExpenseList`, `_renderCashFlowSummary`, and `_renderCashFlowCharts`.
- Chart render extraction completed: `src/charts.js` now owns payoff timeline, interest split, progress, distribution, and debt-to-income charts; `src/app.js` delegates `renderBalanceChart`, `renderPieChart`, `renderProgressChart`, `renderDebtDistributionChart`, and `renderDebtToIncomeChart`.
- Debt summary extraction completed: `src/strategy.js` now owns debt summary table rendering and amortization modal rendering; `src/app.js` delegates `_renderDebtSummaryTable` and `showAmortizationModal`.
- Backup flow extraction completed: `src/storage.js` now owns `exportAllJSON` and `importAllJSON`; `src/app.js` delegates both methods.
- Shared helper extraction completed: `src/utils.js` now owns `computeInterestPaidToDate`; `src/app.js` delegates the helper used by debts and strategy views.
- UI helper extraction completed: `src/ui.js` now owns `switchTab` and `updateFormVisibility`; `src/app.js` delegates both methods.
- Navigation helper extraction completed: `src/ui.js` now owns `switchPage`; `src/app.js` delegates the top-level page switcher.
- UI refresh extraction completed: `src/ui.js` now owns `updateUI`; `src/app.js` delegates the app refresh routine.
- Account CRUD extraction completed: `src/accounts.js` now owns `addAccount`, `deleteAccount`, `startEditAccount`, `cancelEditAccount`, and `saveEditAccount`; `src/app.js` delegates them.
- Milestone helper extraction completed: `src/ui.js` now owns `showMilestone`; `src/app.js` delegates the celebration effect used by debt payoff summaries.
- CSV export extraction completed: `src/storage.js` now owns `exportToCSV`; `src/app.js` delegates the payment-plan CSV download.
- Account selector sync extraction completed: `src/accounts.js` now owns `refreshAccountSelectors`; `src/app.js` delegates `_refreshAccountSelectors`.
- Controller shell repair completed during the milestone move: `src/app.js` class structure and constructor were restored after an intermediate edit left the file temporarily unparsable.

Immediate next slice:
- Continue Phase 5 by extracting any remaining cross-feature controller renderers and utility-only helpers out of `src/app.js` to further slim the controller.

### Phase 6 - Persistence + Import/Export

- Move import/export/clear/reset logic to `src/services/storage.js` and `src/services/backup.js`.
- Keep UI confirmation dialogs in feature layer, not service layer.

### Phase 7 - Final Controller Slimdown

- Reduce `src/app.js` to:
  - state initialization
  - feature composition
  - app bootstrap (`DOMContentLoaded`)
- Remove dead code and unused imports.

## Acceptance Criteria per Phase

- No runtime errors in console during:
  - Add/edit/delete debt
  - Calculate payment plan
  - Target payoff calculation
  - Update debt balance + recalc
  - Add/edit/delete income/bonus
  - Add/edit/delete bills/expenses
  - Reports tab switching
  - Export/import and reload persistence
- `get_errors` reports no JS errors in touched files.
- No duplicate implementations remain for migrated methods.

## Recommended Execution Order

1. Strategy (highest user impact)
2. Debts
3. Accounts/Income/Budget
4. Reports/Ledger
5. Storage/backup
6. Final cleanup

## Risk Controls

- Move one method group at a time and keep signatures stable.
- Add thin delegator methods in `src/app.js` first, then remove in-class bodies after verification.
- Avoid changing DOM IDs and CSS class contracts during migration.
- Validate after each phase before proceeding.
