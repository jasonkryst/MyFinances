# Recurring income type (issue #252) — design

## Problem
Recurring templates read as outflow-only. `reimbursement` ("Reimbursement / Income") already posts a positive ledger
transaction, so Accounts/Forecast/Reports already see inflows, but side income (retainer, dividends) has no clearly
named type, and the Health cash-flow card ignores recurring templates entirely.

## Decisions
- **Direction is encoded in `type`** (no new `incomeDirection` field): `subscription | reimbursement | transfer | income`.
  `income` is a 4th type. Existing `reimbursement` templates are untouched (no data migration). Labels: `income` ->
  "Income" (icon `💰`, category default `Income`), `reimbursement` -> "Reimbursement".
- **Inflow helper**: `isRecurringInflow(tmpl)` (hoisted function in `utils.js`, cycle-safe) is true for `income` and
  `reimbursement`; every site that special-cased `reimbursement` uses it (ledger, recurring page sign/class).
- **Ledger/Accounts/Forecast/Reports/Spending**: unchanged mechanism — inflow templates emit a positive
  `type:'recurring'` tx; Spending already excludes positive recurring amounts.
- **Calendar feeds** (client `calendarFeed.js` and server `calendarGenerator.js`): `Income - Name` title for income type.
- **Sanitizer / Postgres**: `sanitizeRecurringTemplate` whitelist gains `income` (unknown -> `subscription`). Migration
  `1755600000028` swaps the `recurring_templates_type_check` constraint. `down()` first rewrites `income` rows to
  `reimbursement` (equivalent inflow semantics) so rollback neither fails nor loses rows.
- **Health cash flow** now includes recurring templates for the current month via
  `computeRecurringCashFlowForMonth(app, y, m)` (recurring.js): sums each occurrence from
  `getRecurringOccurrencesInMonth` (so weekly/biweekly/quarterly/yearly, pause, archive, skip and start/end dates are
  honored). Inflows (income + reimbursement) join the income side of `net`, savings rate, FIRE; `subscription` adds to
  outflow (also used for emergency-fund coverage). Transfers are excluded (zero-sum between own accounts).
- **Not changed (deliberate)**: `computeMonthlyIncomeForMonth`, DTI, mortgage DTI, interest-burden ratio and Home
  Purchase affordability stay on salary/bonus income only — recurring side income is irregular and lenders' DTI should
  not silently rise. The Budget Allocation card shows a "Recurring" outflow row and uses the cash-flow income
  (salary + recurring inflow) as its denominator so row percentages stay consistent with the Net figure.
- **Zero-amount policy**: income behaves like subscription/reimbursement; transfers still require > 0.
