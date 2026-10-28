# Category Budgets (issue #255) - Design

## Problem
The Variance report has no budget line. Users expect to set e.g. "Housing: $2,000/month" and track actual spending against it. Today the only implicit "budget" is whatever recurring templates, bills and expense budgets happen to exist per category.

## Data
`app.budgetCategories`: plain object keyed by category name.
`{ [category]: { mode: 'fixed' | 'derived', amount: number } }`

- Default `{}`. A category with no entry is **derived**, so existing users see no change.
- `mode: 'derived'` entries are allowed (explicitly pinned to derived); `amount` is ignored for them and stored as 0.
- `sanitizeBudgetCategories(raw, warnings)` (`src/sanitizers.js`): non-object -> `{}`; keys via `normalizeText(key, 40)` (same limit as expense category); empty / `__proto__` / `constructor` / `prototype` keys dropped; unknown mode -> entry dropped; fixed amount must be finite, `>= 0`, capped at 1e9, else entry dropped; max 200 entries. The result is a plain object populated only with own-property assignments on validated keys.

## Derivation (single helper)
`computeDerivedBudgetByCategory(app, year, month)` in `src/categoryBudgets.js`: sum of the **scheduled (pre-override) amount** (`originalAmount`) of the month's ledger transactions, bucketed with the exact classifier the Spending report uses for actuals (bills, expenses, outflow recurring templates by category; debt payments and savings under their fixed buckets). Using the same classifier keeps budget and actual comparable; a derived budget differs from its actual only by ledger amount overrides.

## Effective budget
`computeCategoryBudgets(app, year, month, rangeMonths)` returns rows `{ category, mode, budget, actual, difference, pctUsed }` for the range ending at (year, month):
- fixed: `amount * rangeMonths`
- derived: sum of per-month derived amounts across the range
- actual: summed `computeSpendingByCategoryRange`
- difference = budget - actual (negative = over budget); pctUsed = actual / budget (null when budget is 0)
- Rows: union of derived categories, actual categories and explicitly configured categories.

## UI
1. **Liabilities -> Budget sub-tab: "Category Budgets" panel.** One row per known category (union of expense/bill/recurring categories, current-month derived categories, configured ones): name, Fixed/Derived select, amount input (enabled only for Fixed; for Derived the current-month derived amount is shown read-only), per-row Save and Reset buttons (aria-labels name the category). An "Add category budget" mini form adds a new category name + amount. Validation (blank, negative, non-numeric for Fixed) is shown inline in a `role="alert"` element; never `alert()`. Category names are `escapeHtml`'d everywhere including attributes.
2. **Reports -> Variance:** a "Budget vs. Actual" table below the comparison, honoring the #329 range selector. Columns: category (+ Fixed/Derived badge), budget, actual, difference, % used. Over-budget rows get `.bva-row--over`. Below the mobile breakpoint rows restack into label/value cards via `data-label`. Empty state when no categories.

## Storage
- Local/session: `budgetCategories` in saved state, loaded through `sanitizeParsedState`.
- JSON export/import: `budgetCategories` key (format stays 3.0; absent key = `{}`). Replace: set. Merge: imported keys overwrite/add, existing others kept.
- Postgres: nullable `budget_categories jsonb` on `plan_settings` (migration `1755600000027`), through `/api/plan-settings` GET/PATCH with server-side re-sanitize (same recipe as `home_purchase_plan`, #405); `pgDeleteAll`, replace/merge/rollback in `postgresImport.js` carry it. Migration `down()` drops the column (discards configured budgets; accepted, small re-enterable object).

## Edge cases
- A category removed everywhere but still configured keeps its row (so it can be reset).
- Rename is unsupported; budgets are keyed by name (add the new one, reset the old).
- Fixed $0 is valid (explicit "spend nothing").
- Budget 0 with actual > 0 is over budget; % used shown as an em dash.
