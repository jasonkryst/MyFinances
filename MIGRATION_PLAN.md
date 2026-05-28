# app.js to src Module Migration Plan

This plan completes modularization in safe, testable phases while keeping the app functional after each step.

## Status (completed in this change)

- Runtime entry moved from root `app.js` to `src/app.js`.
- `index.html` now loads `src/app.js` directly.
- Import paths in `src/app.js` were updated to local `src/*` modules.

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

- Extract DOM event binding from `DebtTrackerApp.initializeEventListeners()` into `src/ui/events.js`.
- Keep `DebtTrackerApp` as orchestrator, but delegate to imported handlers.
- Ensure button IDs are mapped once in one place.

### Phase 2 - Strategy Domain

- Move these methods from `src/app.js` to `src/features/strategy/`:
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

- Move debt CRUD + rendering methods into `src/features/debts/`.
- Replace direct DOM strings with focused render helpers where practical.
- Keep update/recalc side effects explicit (storage + optional recalc).

### Phase 4 - Accounts, Income, Budget Domain Completion

- Remove duplicate in-class implementations already partially extracted into src modules.
- Standardize on one implementation per feature module.
- Keep `app` object passed explicitly to feature functions.

### Phase 5 - Reports + Ledger

- Move reports and ledger methods from `src/app.js` into their feature modules.
- Consolidate shared date window/projection utilities in `src/utils/date.js`.

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
