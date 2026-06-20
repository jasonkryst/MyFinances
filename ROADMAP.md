# MyFinances Product Roadmap

**Last Updated**: June 19, 2026  
**Current Version**: v3.6.4  
**Status**: Production-Ready (Security Audit: LOW Risk)

---

## 🔍 Latest Audit Results (June 19, 2026)

Fresh security, accessibility, and test-suite audits were run against the current codebase (324 tests, post-PR #18). Full reports:

| Audit | Result | Report |
|---|---|---|
| Security | ✅ LOW risk — 0 Critical/High, 1 Medium, 2 Low, 51/51 security tests pass | [`docs/audit/security/SECURITY_AUDIT_2026-06-19.md`](docs/audit/security/SECURITY_AUDIT_2026-06-19.md) |
| Accessibility (WCAG 2.1 AA) | ✅ 0 Serious/Moderate defects across 10 pages × 2 themes, mobile, 3 modals, guide.html | [`docs/audit/a11y/A11Y_AUDIT_REPORT_2026-06-19.md`](docs/audit/a11y/A11Y_AUDIT_REPORT_2026-06-19.md) |
| Test Suite | ✅ 324/324 passing; gap analysis across all 41 test files vs. 20 `src/` modules | [`docs/audit/test/TEST_SUITE_AUDIT_2026-06-19.md`](docs/audit/test/TEST_SUITE_AUDIT_2026-06-19.md) |

The app remains in good shape overall. The technical-debt items these audits surfaced are tracked in **Tier 0** below, ahead of new feature work, since two independent audits (security + test-suite) converged on the same bug class.

---

## 🛠️ Tier 0: Audit-Driven Technical Debt (Do First)

#### Fix negative-amount validation bypass in Income/Bonus/Fixed-Debt forms
**Priority**: HIGH | **Effort**: LOW | **Status**: 📋 PROPOSED | **Source**: Security audit M1 + Test-suite audit gap #1

`sanitizeFiniteNumber(raw, NaN, {min: 0.01})` clamps a negative input **up to 0.01** rather than to the fallback, so the subsequent `amount <= 0` check never fires. This exact bug class was found and fixed in `src/bills.js` (`addExpense`/`saveEditExpense`) and `src/recurring.js` (`addRecurringTemplate`/`saveEditRecurring`) this session — but is still live in:
- `src/income.js`: `addIncome`, `saveEditIncome`, `addBonus`, `saveEditBonus`
- `src/debts.js`: fixed-amount debt type branch in `addDebt`

A negative income/bonus/payment amount is silently saved as `$0.01` instead of being rejected, which can quietly skew cash-flow forecasts, health-dashboard ratios, and net-worth snapshots. Fix: validate against the raw input string before clamping, matching the `bills.js`/`recurring.js` pattern. Add `tests/features/test_income.py::test_add_income_negative_amount_rejected` (and bonus/debt equivalents).

---

#### Escape caught-exception messages consistently
**Priority**: LOW | **Effort**: LOW | **Status**: 📋 PROPOSED | **Source**: Security audit L1

`src/ui.js:123` renders `err.message` into `innerHTML` without `escapeHtml()`, unlike the equivalent paths in `src/strategy.js:102,542`. Not currently exploitable (message text isn't user-controlled today) but inconsistent with the rest of the codebase's convention — fix for defense-in-depth before any future exception path echoes user input.

---

#### Document/harden the `accounts.js` raw-`innerHTML` option-list helper
**Priority**: LOW | **Effort**: LOW | **Status**: 📋 PROPOSED | **Source**: Security audit L2

`src/accounts.js:16` (`el.innerHTML = opts`) has no escaping contract at its boundary; all current callers pre-escape, but nothing stops a future caller from passing raw text. Add a contract comment or defensive escaping.

---

#### Close test-coverage gaps flagged by the test-suite audit
**Priority**: MEDIUM | **Effort**: MEDIUM | **Status**: 📋 PROPOSED | **Source**: Test-suite audit, Section 7

1. `tests/features/test_strategy.py` (new file) — `strategy.js` is the only `src/` module with no dedicated feature-test file; cover strategy switching (Avalanche/Snowball/Priority-Lowest/Priority-Highest) and stimulus-amount validation.
2. `tests/features/test_accounts.py::test_delete_account_with_linked_items_orphans_gracefully` — account deletion with linked income/debts/bills/recurring items has no test (the reverse direction — orphaned reconciliation history — is already covered).
3. `tests/ui/test_charts.py` (new file) — assert Chart.js instances are `.destroy()`'d on re-render across health/spending/forecast/networth charts, to catch a memory-leak regression.
4. `tests/ui/test_guide_theme.py` (new file) — `guideTheme.js` has zero automated coverage; the only verification today is manual.
5. Add `.results-tab-btn`/`.results-tab-panel` a11y tests to `tests/ui/test_accessibility.py` mirroring the existing Reports-tab-bar tests (a11y audit finding A2 — the Strategy results tab bar is implemented correctly but has no regression coverage).

---

#### Housekeeping: relocate `tests/debug/`
**Priority**: LOW | **Effort**: LOW | **Status**: 📋 PROPOSED | **Source**: Test-suite audit, Section 6

`tests/debug/` holds 10 ad-hoc manual debugging scripts with no `test_*` functions (pytest silently no-ops on them). Move to a `scripts/` or `tools/` directory outside `tests/` so the test tree only contains real tests.

---

## 🎯 Strategic Vision

MyFinances is evolving from a focused debt payoff calculator into a comprehensive personal financial management tool. The roadmap prioritizes features that:

1. **Provide visibility** — Show users their complete financial picture
2. **Enable motivation** — Display progress and milestones
3. **Support decision-making** — Compare scenarios and forecast outcomes
4. **Maintain simplicity** — Stay client-side, no servers, no complexity

---

## 🔑 Status Legend

| Symbol | Meaning |
|---|---|
| ✅ | **Implemented** — shipped and available today |
| 📋 | **Proposed** — not yet started |
| ⏭️ | **Deferred** — folded into another roadmap item |

---

## 📌 At a Glance

| Feature | Tier | Status | Notes |
|---|---|---|---|
| Fix Income/Bonus/Fixed-Debt negative-amount validation bypass | 0 | 📋 | Security audit M1 + test-suite audit gap #1 |
| Close audit-flagged test-coverage gaps (strategy, charts, guideTheme, account orphans) | 0 | 📋 | Test-suite audit Section 7 |
| Escape exception messages / harden `accounts.js` option helper | 0 | 📋 | Security audit L1/L2 |
| Net Worth Tracker & Historical Snapshots | 1 | ✅ | Delivered May 30, 2026 |
| Financial Health Dashboard | 1 | ✅ | Delivered June 8, 2026 |
| Budget Alerts & Overspend Warnings | 1 | 📋 | Absorbs Quick Wins #2 and #5 |
| Savings Goals with Progress Tracking | 2 | 📋 | |
| Spending Analysis by Category | 2 | ✅ | Delivered June 16, 2026 |
| Multiple Scenario Comparison | 2 | 📋 | |
| Cash Flow Forecasting | 2 | ✅ | Delivered June 10, 2026 — shipped early, was planned for v3.3 |
| Break-Even Analysis per Debt | 2 | 📋 | |
| Advanced Ledger Features | 3 | 📋 | |
| Bill Payment Tracker | 3 | 📋 | "Mark as paid" seeded for Recurring Templates via Quick Win #4 |
| Income Growth Projections | 3 | 📋 | |
| Account Reconciliation Tool | 3 | ✅ | Delivered June 13, 2026 — shipped early, was planned for v3.4+ |
| Debt Consolidation Calculator | 3 | 📋 | |
| Custom Categories for Transactions | 4 | 📋 | |
| Tax Planning Helpers | 4 | 📋 | |
| Retirement Planning | 4 | 📋 | |
| Credit Score Estimator | 4 | 📋 | |
| Inflation Calculator | 4 | 📋 | |
| Enhanced Data Export | 4 | 📋 | |
| Quick Win #1: Debt Payoff Timeline Display | Quick Win | ✅ | Delivered June 14, 2026 |
| Quick Win #2: Month-to-Date Spending Summary | Quick Win | ⏭️ | Folded into Budget Alerts & Overspend Warnings (Tier 1) |
| Quick Win #3: Dashboard Page | Quick Win | ✅ | Delivered in v3.1 as Financial Health Dashboard |
| Quick Win #4: Bill Payment Status | Quick Win | ✅ | Delivered June 14, 2026 — retargeted to Recurring Templates "Mark as paid" |
| Quick Win #5: Budget Overspend Badges | Quick Win | ⏭️ | Folded into Budget Alerts & Overspend Warnings (Tier 1) |

---

## 📊 Feature Tiers

### Tier 1: High-Impact Features (Recommended Next)
These features have the highest user impact and are feasible with existing architecture.

#### 🏆 Net Worth Tracker & Historical Snapshots
**Priority**: HIGH | **Effort**: MEDIUM | **Status**: IMPLEMENTED (May 30, 2026)

**Description**:
Users need to see the big picture: total wealth growth, not just debt reduction. Monthly snapshots of net worth (total assets - total liabilities) create a powerful motivational tool and help users understand their complete financial trajectory.

**Delivered Features**:
- Monthly net worth snapshot with month-level upsert (auto-captured and manual capture)
- Historical trend chart with 3/6/12 month controls
- Net worth vs. liabilities trend visualization
- Asset growth vs. debt reduction composition chart
- Snapshot history audit table (date, assets, liabilities, net worth, income, debt paid)
- Milestone celebrations at +$5K net worth increments from first snapshot
- Accounts dashboard widget showing current net worth and change from prior snapshot

**Why This Matters**:
- Complements debt-focused view with holistic perspective
- Motivates users with visible wealth accumulation
- Shows impact of income + savings + debt payoff together
- Integrates naturally with existing account + debt data

**Technical Approach**:
```javascript
// Add to app state
this.monthlySnapshots = [
  {
    date: '2026-05-29',
    totalAssets: 15000,      // sum of positive account balances
    totalLiabilities: 8500,  // sum of all debts
    netWorth: 6500,
    debtPaymentMade: 1200,
    incomeReceived: 4500
  }
];
```

**Implementation Notes**:
- Data persisted via localStorage, JSON export/import, and sanitization pipeline
- Reports tab now includes a dedicated Net Worth panel
- Manual snapshot capture is available directly from Reports
- Snapshot metrics include `totalAssets`, `totalLiabilities`, `netWorth`, `debtPaymentMade`, and `incomeReceived`

**Follow-up Enhancements**:
- Optional snapshot history table export
- Configurable milestone thresholds

---

#### 📈 Financial Health Dashboard
**Priority**: HIGH | **Effort**: LOW-MEDIUM | **Status**: IMPLEMENTED (June 8, 2026)

**Description**:
A single-page overview of key financial metrics using industry-standard indicators. Reuses existing calculations and presents them as gauges, progress bars, and summary cards.

**Delivered Features**:
- **Debt-to-Income Ratio** — Chart.js doughnut gauge; Healthy (<28%) / Moderate (<40%) / High Risk (≥40%) badge
- **Savings Rate** — Emergency + sinking fund contributions as % of income; Strong / Moderate / Low badge
- **Emergency Fund Coverage** — Per-fund months of coverage with progress bar; empty-state when no funds
- **Debt Payoff Timeline** — Years to debt-free at minimum payments (avalanche); "Debt Free!" state when no debts; payoff date and % progress bar
- **Monthly Cash Flow** — Income minus all outflows; Surplus / Break Even / Deficit badge with itemized breakdown
- **Budget Allocation** — Bill + expense categories as % of income with color-coded progress bars; debt payments row included
- Internal navigation links route to Savings, Liabilities, or Plan page from each card
- Dark-mode-aware gauge background color

**Implementation Notes**:
- Implemented in `src/health.js` as `renderHealthDashboard(app)`
- All user-sourced strings rendered via `escapeHtml()` (XSS safe)
- Chart instances stored on `app._healthDtiChart` and `app._healthSavingsChart`; destroyed on re-render to prevent memory leaks
- Gauge values clamped to [0, 100] regardless of raw ratio

**Test Coverage**:
- 18 feature tests in `tests/features/test_health.py` covering all six cards, nav links, empty states, and error-free rendering
- 2 XSS tests in `tests/security/test_xss.py` (bill category names, emergency fund account names)
- 2 validation tests in `tests/security/test_input_validation.py` (gauge clamping above 100%)
- Health dashboard step added to `tests/integration/test_smoke.py`

---

#### 🛑 Budget Alerts & Overspend Warnings
**Priority**: HIGH | **Effort**: LOW | **Status**: PROPOSED

**Description**:
Real-time spending alerts help users stay within budget. Warn at 80%, 100%, and 110% of category limits with visual indicators and optional badge notifications.

**Features**:
- Alert when spending exceeds budget threshold (80%, 100%, 110%)
- Month-to-date spending by category summary
- Projected month-end total based on current pace
- Highlight overspent categories in red
- Header badge showing count of overspent categories

**Example Display**:
```
⚠️ Groceries: $245 / $200 (122%) — Over budget!
✓ Dining Out: $87 / $150 (58%)
⚠️ Entertainment: $165 / $100 (165%) — SIGNIFICANTLY OVER
```

**Technical Approach**:
- Compare cumulative expenses vs. budget each month
- Calculate daily burn rate and project month-end total
- Store alert preferences (80/100/110% thresholds)

---

### Tier 2: Medium-Impact Features
Valuable additions that enhance core functionality.

#### 🎯 Savings Goals with Progress Tracking
**Priority**: MEDIUM-HIGH | **Effort**: MEDIUM | **Status**: PROPOSED

**Description**:
Balance debt payoff focus with asset building. Users can define savings goals (target amount + deadline) and track progress with visual indicators.

**Features**:
- Define goal: "Save $5,000 by Dec 2026" or "Build 6-month emergency fund"
- Automatic progress calculation from savings/sinking funds
- Month-by-month breakdown to meet goal
- Progress bars with percentage complete
- Milestone notifications
- Link to emergency/sinking funds for contribution planning

**Example**:
```
Goal: Build 3-month Emergency Fund
Target: $9,000 by December 2026
Current: $2,500 (28%)
Required Monthly: $650
On track: ✓ Yes
```

---

#### 📊 Spending Analysis by Category
**Priority**: MEDIUM | **Effort**: MEDIUM | **Status**: ✅ DELIVERED June 16, 2026

**Description**:
Visual breakdown of where money is going. Pie charts, trend analysis, and category rankings help users understand spending patterns and identify areas to optimize.

**Features**:
- Pie chart: spending by category (interactive, expandable)
- Bar chart: category trends (month-over-month comparison)
- Ranked list: highest spending categories
- Category drill-down: see individual transactions
- Month comparison: "Groceries up 15% vs. last month"
- Annual summary by category

**Why This Matters**:
- Identifies spending patterns and anomalies
- Helps users find areas to cut
- Motivates with visible progress in categories
- Leverages existing bill/expense categorization

---

#### 🔄 Multiple Scenario Comparison
**Priority**: MEDIUM | **Effort**: MEDIUM | **Status**: PROPOSED

**Description**:
"What if?" analysis for debt payoff planning. Users save different payment scenarios and compare outcomes side-by-side.

**Features**:
- Save current plan as "Scenario 1"
- Create variations: "Plan A: Pay extra $200/month" vs. "Plan B: Aggressive approach"
- Compare metrics: payoff date, total interest, total paid
- Show interest saved between scenarios
- Restore any saved scenario to make it current

**Example**:
```
Scenario Comparison:
                    Baseline    +$200/mo    Aggressive
Payoff Date:        May 2029    Dec 2028    Oct 2027
Total Interest:     $4,200      $3,100      $1,800
Total Paid:         $24,200     $23,100     $21,800
Interest Saved:     —           $1,100      $2,400
```

---

#### 🔮 Cash Flow Forecasting
**Priority**: MEDIUM | **Effort**: MEDIUM-HIGH | **Status**: IMPLEMENTED (June 10, 2026)

**Description**:
Project account balances forward 1/2/3/6/12 months based on current income, expenses, and debt payments. Identify periods of cash shortage or surplus — including mid-month dips that month-end balances alone don't reveal.

**Delivered Features**:
- Reports › 🔮 Forecast tab with a selectable horizon (1/2/3/6/12 months)
- Account selector — "Total Cash Position" (sum of all asset-type accounts) or any individual checking/savings/cash/investment account
- Summary stats: Current Balance, Lowest Projected, Highest Projected
- Line chart highlighting the lowest (red) and highest (green) projected month-end balances, with the trend line turning red for any negative balance
- Notable-month detection — months whose total outflow exceeds a configurable threshold (default 130%, range 100-500%) of the average monthly outflow are flagged with their top 3 outflow drivers
- Negative-balance warning banner when any projected month-end balance goes negative
- **Intra-month running-low tracking** — walks each month's transactions in chronological order to find the lowest point the balance actually reaches (e.g. rent due before a paycheck arrives), even when the month ends positive:
  - Warning banner for months that dip negative intra-month but recover by month-end, showing the dip date/amount and the recovery balance
  - "Lowest Projected" stat reflects the true intra-month low (with its date) rather than just the lowest month-end balance
  - Table rows flag "Dips to $X on \<date\> before recovering" for any month where the intra-month low is below the month-end balance
- Horizon, account selection, and notable-month threshold are persisted to localStorage and round-trip through JSON export/import

**Why This Matters**:
- Month-end balances can hide dangerous mid-month cash crunches (e.g. rent due on the 1st, paycheck not until the 15th)
- Helps users plan around irregular or seasonal expenses before they cause an overdraft
- Builds entirely on the existing ledger running-balance and account-projection infrastructure — no new data model

**Implementation Notes**:
- Implemented in `src/forecast.js` as `renderCashFlowForecast(app)`; `getAccountForecastSeries(app, accountId, monthsAhead)` in `src/ledger.js` provides the per-account month-by-month projection plus the intra-month low balance/date
- "Total Cash Position" excludes liability-type accounts (`Credit Card`, `Loan`) via `getForecastAssetAccounts(app)`. Combining accounts re-merges every account's transactions chronologically per month to compute the combined intra-month low, since per-account lows can occur on different days and can't simply be summed
- Floating-point comparisons use a `1e-9` epsilon to avoid false positives from rounding

**Test Coverage**:
- 13 feature tests in `tests/features/test_forecast.py` covering horizon/account selection, notable months and drivers, negative-balance warnings, and intra-month dip detection (per-account, combined "Total Cash Position", and no-dip cases)
- XSS and end-to-end smoke test coverage for the Forecast tab

---

#### 💰 Break-Even Analysis per Debt
**Priority**: MEDIUM | **Effort**: LOW | **Status**: PROPOSED

**Description**:
For each debt, show the payoff math clearly: minimum payment only vs. planned payment. Users see exactly how much faster they'll pay off debt with their plan.

**Features**:
- Per-debt payoff date display
- Days/months/years to payoff at current plan
- Interest savings vs. minimum payment only
- Timeline visualization
- One-click "accelerate this debt" option

**Example Card**:
```
Visa (Credit Card)
Current Balance: $2,400
APR: 18.5%
Your Plan: $450/month
Payoff Date: Dec 2026 (7 months)
Total Interest: $285

Vs. Minimum Only: May 2028 (19 months, $1,200 interest)
You're saving $915 in interest! 🎉
```

---

### Tier 3: Enhancement Features
Polish and quality-of-life improvements.

#### 📋 Advanced Ledger Features
**Priority**: MEDIUM | **Effort**: MEDIUM | **Status**: PROPOSED

**Features**:
- Recurring templates auto-apply (create once, auto-generate)
- Transaction search/filter by name, date, amount
- Flag important transactions (refunds, large expenses)
- Custom categorization per transaction
- Recurring item history and suppression
- Bulk operations (mark multiple as paid)

---

#### 📅 Bill Payment Tracker
**Priority**: MEDIUM | **Effort**: LOW | **Status**: PROPOSED (partially seeded)

**Note**: The standalone "Bills" feature this item was originally written
against (`#billForm`/`#billList`) was removed from the UI on May 29, 2026 in
favor of Recurring Templates (`src/recurring.js`). The "mark as paid" piece of
this item has been delivered for Recurring Templates via Quick Win #4
(`paidMonths`). The remaining items below stay PROPOSED, but would need to be
redefined against Recurring Templates rather than the old Bills model if
pursued.

**Features**:
- [x] Mark items as "due" vs. "paid" — delivered for Recurring Templates (Quick Win #4)
- [ ] Track payment history and dates
- [ ] Late payment warnings (occurrence date passed without being marked paid)
- [ ] Confirmation dates when payment sent
- [ ] Monthly payment checklist

---

#### 💡 Income Growth Projections
**Priority**: MEDIUM | **Effort**: MEDIUM | **Status**: PROPOSED

**Features**:
- Model salary increases (annual % or fixed amount)
- See impact on debt payoff timeline
- Plan for bonuses/commissions
- "What if I get a 5% raise?" scenarios

---

#### 🔧 Account Reconciliation Tool
**Priority**: LOW-MEDIUM | **Effort**: MEDIUM | **Status**: IMPLEMENTED (June 13, 2026)

**Delivered Features**:
- New 🔄 Reconcile page with a card per account showing the current tracked balance, an editable statement date (defaults to today) and statement balance, and a live, color-coded difference as the statement balance is edited
- "Expected transactions since {date}" details per account, listing bills/recurring items due since the last reconciliation (or the start of the month if none yet)
- Reconciling updates the account's tracked balance and records a history entry (previous → statement balance, difference, date, note)
- History table with an account filter and per-entry delete (does not revert the balance)
- 🔄 Reconcile this account button on the Ledger page (when a single account is selected) opens a quick-reconcile modal with the same fields, plus Escape/Enter keyboard handling
- `app.reconciliations` round-trips through localStorage and JSON export/import, with sanitization rejecting entries with a missing `accountId` or non-finite `statementBalance`
- Orphaned history entries (account later deleted) render with an "Unknown account" label instead of crashing

**Why This Matters**:
- Lets users correct drift between the tracked balance and their bank's actual balance after fees, interest, or missed transactions
- Surfaces upcoming/expected transactions so users can spot what's likely causing a discrepancy before adjusting the balance

**Implementation Notes**:
- Implemented in `src/reconciliation.js`: `renderReconciliationPage`, `applyReconciliation`, `reconcileAccount`, `deleteReconciliationEntry`, `getExpectedTransactionsInRange`, `openReconcileModal`
- `getExpectedTransactionsInRange` reuses `getLedgerTransactionsForMonth` from `src/ledger.js`, walking month-by-month across the requested date range
- `todayISO()` added to `src/utils.js`; `sanitizeReconciliation` added to `src/storage.js` following the existing sanitize/round-trip conventions

**Test Coverage**:
- 11 feature tests in `tests/features/test_reconciliation.py` covering `applyReconciliation`, history entries, expected-transactions lookups, sanitization, and import/export/clear round-trips
- 8 UI tests in `tests/ui/test_reconciliation_actions.py` covering the empty state, live diff, history filter/delete, expected-transactions details, and the Ledger quick-reconcile modal
- XSS, input-validation, and accessibility coverage added to `tests/security/test_xss.py`, `tests/security/test_input_validation.py`, and `tests/ui/test_accessibility.py`

---

#### 🏦 Debt Consolidation Calculator
**Priority**: LOW-MEDIUM | **Effort**: MEDIUM | **Status**: PROPOSED

**Features**:
- Compare consolidating multiple debts
- New APR impact calculation
- Consolidation fee considerations
- Break-even analysis: when consolidation saves money
- Payoff comparison

---

### Tier 4: Specialized Features
Domain-specific tools for advanced users.

#### 📊 Custom Categories for Transactions
**Priority**: LOW | **Effort**: LOW-MEDIUM | **Status**: PROPOSED

**Features**:
- User-defined expense categories
- Custom bill types
- Spending rules by category
- Merge categories

---

#### 🎓 Tax Planning Helpers
**Priority**: LOW | **Effort**: MEDIUM-HIGH | **Status**: PROPOSED

**Features**:
- Deductible expense tracking
- Quarterly tax payment planning
- Capital gains/losses tracking
- Tax summary export

---

#### 🎯 Retirement Planning
**Priority**: LOW | **Effort**: MEDIUM-HIGH | **Status**: PROPOSED

**Features**:
- Years to retirement countdown
- Savings needed for retirement
- With/without debt comparison
- Retirement readiness score

---

#### 💰 Credit Score Estimator
**Priority**: LOW | **Effort**: MEDIUM | **Status**: PROPOSED

**Features**:
- Estimate credit score based on debt-to-income, payment history
- Show impact of different actions on score
- Best practices for score improvement

---

#### 📈 Inflation Calculator
**Priority**: LOW | **Effort**: LOW | **Status**: PROPOSED

**Features**:
- Adjust currency for inflation
- Show real purchasing power
- Real vs. nominal returns

---

#### 📄 Enhanced Data Export
**Priority**: LOW | **Effort**: MEDIUM | **Status**: PROPOSED

**Features**:
- CSV export with custom columns
- Monthly/yearly summary reports
- PDF report generation
- Chart export as images

---

### Tier 5: New Ideas (June 19, 2026 Audit Cycle)

Identified while reviewing the current featureset against the audit results — not yet effort/priority-ranked against the existing tiers above, but worth tracking. Grouped by the lens that surfaced them.

#### 🧩 Featureset
- **PWA / offline installability** — add a manifest + service worker so the app can be installed and used offline; fits the "client-side only, no server" architecture naturally and improves mobile usability.
- **Bank statement / CSV transaction import** — a mapping wizard to bulk-import transactions into the ledger, rather than manual entry only. Bigger lift than Enhanced Data Export (Tier 4) since it's import, not export.
- **Reminders for due bills/recurring items** — browser Notification API (with explicit opt-in) or an in-app "due soon" digest on the Health dashboard, building on `recurringTemplates`' existing occurrence-date math.
- **Scheduled/auto-export reminders** — since there's no cloud backup, periodically nudge users (e.g. "last export was 45 days ago") to export their JSON backup, directly addressing the single-point-of-failure risk of localStorage-only persistence.
- **FIRE / net-worth goal calculator** — extends the existing Net Worth Tracker with a target net-worth + timeline projection, reusing `monthlySnapshots` trend data.

#### 🎨 UI/UX
- **Command palette / quick-jump (Ctrl+K)** — fast keyboard navigation across the now 10-page app; pairs well with the recent grouped-nav redesign.
- **Customizable Health Dashboard card order** — let users reorder/hide the six health cards (drag-and-drop or simple up/down controls), persisted like other preferences.
- **Print-friendly Reports view** — a `@media print` stylesheet for the Reports page so users can print/PDF a monthly summary without browser print clutter.
- **Empty-state onboarding flow** — guided first-run walkthrough (create first account → add income/debt → see Health dashboard populate) for new users instead of a single guide.html page.

#### ♿ Accessibility
- **`prefers-reduced-motion` support** — Chart.js animations and modal transitions currently always animate; respect the OS-level reduced-motion preference.
- **Screen-reader data-table fallback for charts** — every Chart.js canvas (Health gauges, Spending pie/bar, Forecast line, Net Worth trend) has no text-equivalent table for screen-reader users; add a visually-hidden `<table>` alternative per chart.
- **High-contrast theme option** — a third theme beyond light/dark tuned for WCAG AAA contrast, for users who need it beyond the already-passing AA baseline.
- *(Process item, not a UI feature — tracked in Tier 0 above)* dedicated Strategy results-tab-bar a11y regression tests.

#### 🔒 Security
- **Optional passphrase-encrypted localStorage** — client-side encryption (e.g. WebCrypto AES-GCM) of the persisted JSON blob, opt-in, for users on shared devices — the app already has no server, so this stays fully consistent with the privacy-first model.
- **"Lock app" / idle session timeout** — auto-blur/hide financial data after N minutes of inactivity on a shared device, independent of the encryption feature above.
- **Automated SRI/CSP regression check in CI** — the Chart.js CDN `integrity` hash and CSP sync are currently verified by manual audit + one static test; consider a CI step that re-fetches the pinned Chart.js version's hash periodically to catch silent CDN drift.
- *(Bug fixes, tracked in Tier 0 above)* income/debt validation bypass, exception-message escaping, `accounts.js` option-list helper contract.

#### 🖥️ FED (Frontend / UI layer)
- **`tests/ui/test_charts.py`** — chart-instance-destroyed-on-rerender coverage (Tier 0, test-suite audit gap #3).
- **`tests/ui/test_guide_theme.py`** — close the only `src/` file with zero automated coverage (Tier 0, test-suite audit gap #4).
- **Lightweight build step evaluation** — the project deliberately has no build step (CLAUDE.md), which keeps things simple but means no minification/tree-shaking; worth an explicit decision record on whether that tradeoff still holds as `src/` grows past 20 modules, rather than revisiting it ad hoc.

#### 🗄️ BED (Storage / data-layer logic)
- **`tests/features/test_strategy.py`** — the one `src/` module with no dedicated feature-test file (Tier 0, test-suite audit gap #1).
- **localStorage quota monitoring** — `storage.js` has no check for approaching the ~5-10MB browser quota; large multi-year ledgers could eventually hit it silently. Add a soft warning before writes start failing.
- **Web Worker for `debtCalculator.js`** — the daily-compounding payoff engine runs synchronously on the main thread; fine today, but a future "10 debts × 30-year amortization schedule" scenario could janky the UI. Worth profiling before committing to this.
- **Formal storage-schema migration framework** — sanitizers currently double as the de facto migration layer (format `"3.0"` plus legacy v1.0 support). As more format versions accumulate, consider an explicit `migrations/` pipeline keyed by version number rather than growing the sanitizers further.

---

## 🚀 Implementation Roadmap by Release

### v3.1 (Released - June 8, 2026)
**Focus**: Financial Visibility & Motivation

- [x] Financial Health Dashboard (HIGH impact, LOW-MEDIUM effort)
- [ ] Budget Alerts & Warnings (HIGH impact, LOW effort)
- [x] Net Worth Tracker (HIGH impact, MEDIUM effort)

**Shipped with v3.1**:
- Financial Health Dashboard (`src/health.js`) with all six metric cards
- Multi-account ledger: items without account links route to a sentinel bucket and appear in report-wide aggregations but are excluded from the per-account ledger view
- Import/export: `recurringTemplates`, `emergencyFunds`, and `sinkingFunds` now fully round-trip through backup JSON
- Import: account IDs are now preserved on import so all `accountId` cross-references in income, debt, bills, and recurring items remain valid after a restore
- Reports tab: aggregations now include items not linked to any account (previously only linked items were counted)
- Test suite expanded: 22 new tests covering the Health Dashboard (feature, security, integration)

**Shipped post-v3.1 (June 10, 2026)**:
- Cash Flow Forecasting (`src/forecast.js`), originally planned for v3.3, shipped early — see Tier 2 entry above for details
- Test suite expanded: 13 new tests covering the Forecast tab (`tests/features/test_forecast.py`)

**Shipped post-v3.1 (June 13, 2026)**:
- Account Reconciliation Tool (`src/reconciliation.js`), originally planned for v3.4+, shipped early — see Tier 3 entry above for details
- Test suite expanded: 26 new tests covering reconciliation (feature, UI, security, accessibility)

**Shipped post-v3.1 (June 15-16, 2026)**:
- Spending Analysis by Category (`src/spending.js`), originally planned for v3.2, shipped early — see Tier 2 entry for details
- Main nav redesigned into three labeled groups (Overview/Manage/Analyze) with active-group highlighting, `aria-current`, and keyboard reachability
- Reports nav redesigned with a sticky, grouped tab bar
- Test suite expanded: tests covering spending analysis, grouped main nav, and grouped reports nav

**Shipped post-v3.1 (June 16-17, 2026)**:
- Fixed two CSP violations surfaced after the nav redesign: `connect-src` now allows `https://cdn.jsdelivr.net` (Chart.js sourcemap fetch) in both `index.html`'s meta tag and `nginx.conf`'s header; `guide.html`'s inline `<script>` and `<style>` blocks were externalized to `src/guideTheme.js` and `guide.css` so they aren't blocked by nginx's CSP header in production
- Added a static test that asserts `index.html`'s CSP meta tag and `nginx.conf`'s CSP header stay in sync, to catch this class of bug going forward
- Mobile button-height and main-nav label text-content test fixes
- Test suite expanded to 264 tests (up from 140); added coverage for the dormant Bills data model/calculations (`tests/features/test_bills.py`) and CSV schedule export (`tests/integration/test_workflows.py`)

---

### v3.2 (Q3 2026)
**Focus**: Goal Setting & Progress Tracking

- [ ] Budget Alerts & Warnings (HIGH impact, LOW effort) — carried from v3.1
- [ ] Savings Goals (MEDIUM-HIGH impact)
- [x] ~~Spending Analysis (MEDIUM impact)~~ — shipped early, June 16, 2026
- [ ] Enhanced Ledger Features (MEDIUM impact)

---

### v3.3 (Q1 2027)
**Focus**: Scenario Planning & Forecasting

- [ ] Multiple Scenario Comparison (MEDIUM impact)
- [x] ~~Cash Flow Forecasting (MEDIUM impact)~~ — shipped early, June 10, 2026
- [ ] Break-Even Analysis per Debt (MEDIUM impact)

---

### v3.4+ (Future)
- [ ] Bill Payment Tracker
- [x] ~~Account Reconciliation~~ — shipped early, June 13, 2026
- [ ] Debt Consolidation Calculator
- [ ] Advanced Tax/Retirement tools

---

## 📋 Quick Wins (Low Effort, Noticeable Impact)

These can be implemented quickly and add immediate value:

1. ~~**Debt Payoff Timeline Display** (30 min)~~ ✅ **Delivered June 14, 2026** — each debt card shows a "📅 Payoff Date" row sourced from `app._debtSummaryRows` (populated when the user clicks "Calculate Payment Plan" on the Plan page)

2. ⏭️ **Month-to-Date Spending Summary** — **Deferred**, folded into Tier 1 "🛑 Budget Alerts & Overspend Warnings" (requires a per-category monthly budget limit concept that doesn't exist yet)

3. ~~**Dashboard Page** (2-3 hours)~~ ✅ **Delivered in v3.1** — Financial Health Dashboard (`src/health.js`)

4. ~~**Bill Payment Status** (1 hour)~~ ✅ **Delivered June 14, 2026** — retargeted to Recurring Templates: a "Mark as paid this month" toggle (`paidMonths` per template, mirrors `skippedMonths`). The standalone Bills feature this item originally targeted was removed in favor of Recurring Templates (May 29, 2026).

5. ⏭️ **Budget Overspend Badges** — **Deferred**, folded into Tier 1 "🛑 Budget Alerts & Overspend Warnings" (same underlying budget-limit concept as #2)

---

## 🏗️ Technical Considerations

### Data Structure Additions

```javascript
// New app state properties
this.monthlySnapshots = [];      // Net worth history
this.savingsGoals = [];           // User-defined goals
this.scenarios = [];              // Saved payment scenarios
this.budgetAlerts = {};           // Alert preferences
this.reconciliationEntries = [];  // Account adjustments
```

### Storage Impact
- Current localStorage usage: ~50-200KB typical
- Monthly snapshots: ~100 bytes each (12 months/year = 1.2KB/year)
- No breaking changes needed

### UI/UX Changes
- New "Dashboard" page in navigation
- "Goals" tab
- "Scenarios" comparison modal
- Notification badge in header
- Enhanced Reports page

### Performance
- All calculations client-side (no server needed)
- Monthly aggregations can be lazy-loaded
- Charts use existing Chart.js infrastructure

---

## 🎯 Success Metrics

### User Engagement
- Dashboard page views per session
- Time spent comparing scenarios
- Goal progress check-ins per month
- Budget alert interactions

### Business Impact
- User retention (sessions per week)
- Feature usage (% of users using new features)
- Motivation indicators (goal achievements)
- Export/backup frequency

---

## 📝 Notes for Contributors

### Before Starting Implementation
1. Review [SECURITY.md](SECURITY.md) — All new features must follow security guidelines
2. Check [DEPLOYMENT.md](DEPLOYMENT.md) — Deployment requirements
3. Add tests to [tests/](tests/) folder before/after implementation
4. Maintain mobile responsiveness (test at 480px, 768px, 1024px)

### Architecture Principles
- Keep client-side only (no server)
- Maintain modular structure (one feature per file if possible)
- All user input must be sanitized
- Use `escapeHtml()` for all output
- No external dependencies beyond Chart.js

### Testing Requirements
- Unit tests for calculations
- Integration tests for UI changes
- Security tests for any input handling
- Mobile/responsive tests

---

## 📞 Feedback & Discussion

**Status**: Open for feedback  
**Last Review**: June 19, 2026  
**Next Review**: July 31, 2026

Have ideas? Found issues? See opportunities? [Open an issue or discussion](SECURITY.md#security-issues).

---

**Version**: 1.2  
**Status**: Active Roadmap  
**Last Updated**: June 19, 2026
