# MyFinances Feature Audit
_2026-10-06 — Comprehensive review of all 12 pages and cross-cutting concerns_

---

## Methodology

Each feature was analyzed against three criteria:

- **Current capabilities** — what exists and works today
- **Gaps** — missing functionality, discoverability issues, or usability friction
- **Improvement opportunities** — specific, actionable changes with estimated impact and cost

Issues are grouped into four priority tiers based on **Impact × Cost**:

| Tier | Label | Criteria |
|------|-------|----------|
| P0 | **Quick Win** | High impact, low cost (≤1–2 days) — ship these first |
| P1 | **High Value** | High impact, medium cost (3–5 days) — schedule next sprint |
| P2 | **Strategic** | High impact, high cost (1+ week, needs own spec) — plan and spec separately |
| P3 | **Improvement** | Medium impact, any cost — quality-of-life, ship when convenient |

---

## Feature 1 — Health Dashboard

### Current Capabilities
- Debt-to-income (DTI) ratio card with green/yellow/red status
- Savings rate card
- Emergency fund coverage (months)
- Debt payoff timeline
- Cash flow card (monthly income minus expenses)
- Budget category breakdown with per-category thresholds
- Credit utilization aggregate card
- Surplus Analysis card (rolling window, sparkline, allocation slider, transparency view, payoff acceleration badges)
- i18n support for all health strings

### Gaps
- Metric cards show current values but no trend vs. last month (getting better or worse?)
- Cards are informational but not navigable — no click-through to the relevant page
- Budget category thresholds are hardcoded (`housing < 28%`, others `< 10/15%`) — not customizable
- Credit utilization shows an aggregate number but not per-card breakdowns
- No actionable guidance — a red card tells you it's bad but not how to fix it
- Surplus analysis accounts are selected one at a time; no multi-account aggregate view

### Issues

| # | Tier | Title |
|---|------|-------|
| H-01 | P0 | Health metric cards — add month-over-month trend arrows (↑↓ delta) |
| H-02 | P0 | Health metric cards — clicking navigates to the relevant page |
| H-03 | P1 | Customizable budget category thresholds (user-defined healthy/warn/danger ranges per category) |
| H-04 | P1 | "Top 3 recommendations" panel — context-aware tips based on which metrics are red/yellow |
| H-05 | P3 | Per-card credit utilization breakdown in health dashboard |

---

## Feature 2 — Accounts

### Current Capabilities
- CRUD for all account types (Checking, Savings, Cash, Investment, Retirement, Credit Card, Loan, Other)
- Account type icons
- Projected balance computation (forward-projects from starting balance using all linked income/bills/debts/recurring)
- Retirement subtype support (401k, IRA, HSA, Pension)
- Balance history integration

### Gaps
- No archive/unarchive — can only delete accounts, which destroys linked history
- No interest rate field for savings/checking accounts (missed input to interest income calculation)
- Projected balance is displayed but not explained — no drill-down into contributing transactions
- No account notes field
- No transfer tracking between accounts (moving money between checking and savings is invisible)
- Account type groups are not visually grouped on the page

### Issues

| # | Tier | Title |
|---|------|-------|
| A-01 | P0 | Account archive/unarchive — hide from active lists without deleting linked history |
| A-02 | P0 | Interest rate field for Savings/Checking accounts (feeds interest income projections) |
| A-03 | P1 | Balance breakdown drill-down — show which transactions compose the projected balance |
| A-04 | P3 | Account notes/memo field |
| A-05 | P2 | Transfer tracking between accounts (inflow to one, outflow from other, zero-sum) |

---

## Feature 3 — Income

### Current Capabilities
- Regular income with frequency (weekly, biweekly, semi-monthly, monthly, etc.)
- One-time bonuses/deposits with year filter (recently added)
- Person linking and account linking
- Bonus Advisor modal for one-time windfall optimization

### Gaps
- No income categories (Salary, Freelance, Rental, Investment, Other)
- No income trend chart — no way to see if income is growing year-over-year
- No gross vs. net concept — tax withholding isn't modeled, so all cash-flow calculations are pre-tax
- Annual bonuses lack a "recurring annually" structure (they're each entered as one-off entries)
- No income goals or raise tracking
- Bonus Advisor is accessed via a button at the bottom of the income list and is easy to miss

### Issues

| # | Tier | Title |
|---|------|-------|
| I-01 | P0 | Income categories (Salary, Freelance, Rental, Investment, Other) |
| I-02 | P1 | Income history trend chart (year-over-year income comparison) |
| I-03 | P1 | Promote Bonus Advisor discoverability — surface in command palette and Health page |
| I-04 | P2 | Gross vs. net — tax withholding field per income source for true net cash-flow modeling |
| I-05 | P3 | "Recurring annual bonus" type (structured vs. ad-hoc one-time entries) |

---

## Feature 4 — People

### Current Capabilities
- CRUD for family members / household people
- Link people to income entries and debts (multi-select on debt)
- Person pills displayed on debt cards and ledger rows
- Replacement modal when deleting a person linked to records

### Gaps
- People are labels — there's no financial summary per person
- People page shows a list but gives no insight into each person's financial picture
- No shared vs. individual classification on debts and income
- No household budget allocation or per-person view

### Issues

| # | Tier | Title |
|---|------|-------|
| P-01 | P0 | Per-person summary card — show total linked income, total linked debt, and net contribution |
| P-02 | P1 | Shared vs. individual flag on debts and income (split % or equal-share) |

---

## Feature 5 — Liabilities (Debts)

### Current Capabilities
- CRUD with rich form (type, APR, minimum payment, category, credit limit, original balance, account, person)
- Archive/unarchive with clear visual distinction
- Inline edit + full-screen edit modes
- Balance update modal
- Balance history chart per debt (with seeding from prior records)
- Break-even analysis (extra payment vs. invest)
- Comprehensive sort & filter controls (balance, APR, min payment, progress, utilization, due soonest)
- Payoff progress bars with percentage
- Debt category, account, and interest-type filter chips

### Gaps
- No notes/memo field per debt (why this debt exists, institution contact info, etc.)
- No "interest paid to date" running total per debt — users have to calculate this manually
- Break-even analysis is powerful but buried — no link to it from the debt card
- No "next payment due date" field — only inferred from account-linked recurring templates
- No bulk actions (select multiple → archive/export/delete)
- Debt grouping by institution or person not available
- No "paid off" celebration/confirmation flow after archiving

### Issues

| # | Tier | Title |
|---|------|-------|
| D-01 | P0 | Debt notes/memo field (free-text, per debt) |
| D-02 | P0 | "Interest paid to date" running total shown on each debt card |
| D-03 | P0 | Link to break-even analysis directly from debt card (promote discoverability) |
| D-04 | P1 | Next payment due date field per debt |
| D-05 | P1 | Bulk debt actions (multi-select → archive/export/delete) |
| D-06 | P1 | Group debts by person or institution |
| D-07 | P3 | "Debt paid off" celebration modal when archiving a zero-balance debt |

---

## Feature 6 — Recurring Templates

### Current Capabilities
- CRUD with frequency options (weekly, biweekly, semi-monthly, monthly, quarterly, annually)
- Skip occurrence per month
- Mark as paid per month (informational only, does not affect balance)
- Pause/unpause
- Archive/unarchive
- Account linking, category field
- Sort & filter controls (recently added)
- Calendar integration

### Gaps
- No "upcoming this month" summary at the top of the page
- No overdue detection — if the 25th arrives and a template due on the 1st is unmarked
- Marking paid doesn't allow entering the actual paid amount (which may differ from template)
- Category is free-text with no suggestions or standardization
- No recurring income templates — only outflow (income goes through the Income page)
- No attachment/receipt support
- Pause duration has no end date — you have to manually unpause

### Issues

| # | Tier | Title |
|---|------|-------|
| R-01 | P0 | "Upcoming this month" summary panel at top — count and total of this month's recurring |
| R-02 | P0 | Overdue indicator — visual flag when a template is past its due date and unmarked |
| R-03 | P1 | Actual-amount override when marking paid (capture real spend vs. template estimate) |
| R-04 | P1 | Category suggestions/autocomplete (standardized list with free-text fallback) |
| R-05 | P2 | Recurring income templates (not just outflow — e.g., side income on a schedule) |
| R-06 | P3 | Pause with auto-resume date |

---

## Feature 7 — Savings

### Current Capabilities
- Emergency fund per account (target, current amount, monthly contribution, auto-contribute toggle)
- Sinking funds (per goal, target amount, current, deadline, required monthly contribution auto-calculated)
- Sub-tab navigation between Emergency and Sinking Funds

### Gaps
- Emergency fund "current amount" is manually entered — it doesn't auto-read from the linked account balance
- Sinking funds have no priority ordering
- No "fully funded" completion / archive flow for sinking funds
- No savings rate calculation (what % of total income flows into all savings goals)
- Savings auto-contribute toggle exists but has no visible effect in the ledger or projections
- No savings history chart (how did my emergency fund balance change over time?)

### Issues

| # | Tier | Title |
|---|------|-------|
| S-01 | P0 | Option to auto-sync emergency fund current amount from linked account balance |
| S-02 | P1 | Priority ordering of sinking funds (drag-to-reorder or numeric priority) |
| S-03 | P1 | Sinking fund completion flow — "fully funded" state, archive when reached |
| S-04 | P3 | Savings rate summary (total monthly savings / total monthly income %) |
| S-05 | P3 | Emergency fund balance history chart |

---

## Feature 8 — Plan (Strategy)

### Current Capabilities
- Debt payoff strategy selector (Avalanche, Snowball, Priority Lowest, Priority Highest)
- Monthly payment input with income widget showing DTI warning
- Strategy comparison table (all 4 strategies side by side)
- What-if simulator (extra payment or interest rate change)
- Month-by-month payment schedule table
- Plan history (save/restore/compare named snapshots)
- Milestone tracking

### Gaps
- Monthly payment requires manual entry — no auto-fill from (income − bills − expenses)
- Payment schedule has no CSV export
- What-if simulator is powerful but only shows aggregate totals — no per-debt view
- No refinancing scenario (change APR on a debt to model a balance transfer or refi)
- Plan history comparison is limited — just total interest and payoff date, not full debt view
- No Gantt-style visual timeline for debt elimination
- No alert when new debts are added after a plan was run (plan may be stale)

### Issues

| # | Tier | Title |
|---|------|-------|
| ST-01 | P0 | Auto-fill suggested monthly payment (income minus bills/expenses/recurring) |
| ST-02 | P0 | Export payment schedule to CSV |
| ST-03 | P1 | Visual payoff Gantt chart (debt elimination timeline per debt, per month) |
| ST-04 | P1 | Refinancing what-if scenario — change APR on one debt and recompute |
| ST-05 | P1 | "Plan may be stale" warning when data changes after last calculation |
| ST-06 | P3 | Plan history comparison — full per-debt breakdown between saved snapshots |

---

## Feature 9 — Reports

### Current Capabilities
- **Spending Analysis** — pie chart, category breakdown, month navigation, prior-month comparison badges
- **Net Worth** — balance chart, monthly snapshot capture, history table, assets vs. liabilities breakdown
- **Cash Flow** — forecast table (1–12 months), trend chart (recent actual months)
- **Money Flow Sankey** — income → category → account visualization
- **Calendar** — monthly event view (bills, income, debts), iCal download, webcal server feed
- **Variance** — budget vs. actual per category for the selected month
- **Summary** — one-page monthly financial summary
- **Retirement** — retirement sub-report pulling from Retirement page data

### Gaps
- No custom date range — all reports navigate month-by-month only
- No year-over-year comparison in spending
- Spending category is not clickable — can't drill down to the underlying transactions
- Net worth doesn't project forward (where will I be in 1/3/5 years at current pace?)
- Variance report has no budget configuration page — "budget" is derived from bills/recurring which users may not expect
- No print-friendly / PDF export for reports (some pages have print buttons, coverage is incomplete)
- Ledger and reports are siloed — no cross-navigation (clicking a category in Spending doesn't filter the Ledger)

### Issues

| # | Tier | Title |
|---|------|-------|
| RP-01 | P0 | Spending category drill-down — click a category to see its transactions |
| RP-02 | P0 | Print-friendly CSS coverage for all report sub-pages |
| RP-03 | P1 | Custom date range selector for Spending and Variance reports |
| RP-04 | P1 | Year-over-year spending comparison (current month vs. same month last year) |
| RP-05 | P1 | Net worth projection — model trajectory at current savings/debt-payoff rate |
| RP-06 | P2 | Budget configuration page — explicit per-category budget amounts separate from recurring templates |
| RP-07 | P3 | Cross-navigation: Spending category → Ledger filtered to that category/month |

---

## Feature 10 — Ledger

### Current Capabilities
- Unified transaction view across all accounts, all types (income, debts, bills, recurring, overrides)
- Amount overrides per transaction (modal-based, keyed by type/id/account/date)
- Cleared checkbox per transaction with visual distinction
- Column visibility toggle (Date, Account, Transaction, Amount, Running Balance, Cleared)
- Filter by type, account, date range, search text
- Running balance column
- CSV export with per-column selection

### Gaps
- No visual indicator that a given transaction has an override applied (override is silent)
- No bulk clear/unclear action — marking 30 transactions cleared one by one is tedious
- Override notes/memo field is missing — no way to record why a transaction was overridden
- Filter state is not persisted across page navigations
- No "this month" quick filter shortcut
- No bank CSV/OFX import — reconciliation is entirely manual

### Issues

| # | Tier | Title |
|---|------|-------|
| L-01 | P0 | Visual indicator (icon or style) when a transaction has an override applied |
| L-02 | P0 | Bulk clear/unclear — select visible transactions and mark all at once |
| L-03 | P1 | Filter state persistence — remember last filter settings across page navigations |
| L-04 | P1 | Memo/notes field on overrides (record why the amount was changed) |
| L-05 | P2 | Bank CSV/OFX import — import real transactions and auto-clear matched ledger entries |

---

## Feature 11 — Reconciliation

### Current Capabilities
- Per-account reconciliation modal
- Statement balance entry with date
- Expected transactions since last reconciliation (from ledger engine)
- Adjustment history log
- Option to adjust account starting balance when reconciling

### Gaps
- Expected transactions list doesn't show each transaction's cleared status — can't see at a glance what's uncleared
- No partial/in-progress reconciliation state (close mid-reconcile, come back later)
- Reconciliation history log is sparse — no breakdown of what was cleared at each reconcile
- No "bank statement date" concept — reconciliation date is loosely defined
- No reconciliation report export

### Issues

| # | Tier | Title |
|---|------|-------|
| RC-01 | P0 | Show cleared status in expected transactions list within reconciliation modal |
| RC-02 | P0 | Bank statement start/end date fields (distinct from reconciliation entry date) |
| RC-03 | P1 | Partial reconciliation — save in-progress state and resume |
| RC-04 | P3 | Reconciliation report export (printable/CSV summary) |

---

## Feature 12 — Retirement

### Current Capabilities
- Retirement account type with full subtype support (401k, Traditional IRA, Roth IRA, HSA, Pension, Other)
- Snapshot logging (date, balance, contribution amount, annual salary for pensions)
- Employer match percentage per account
- Three Chart.js charts: balance over time, contribution vs. growth, current breakdown
- Forward projection to a user-set target retirement date
- Coast FIRE is not yet modeled

### Gaps
- No annual contribution limit tracker — IRS limits ($23,000 for 401k, $7,000 for IRA in 2024) not surfaced
- No "monthly income in retirement" withdrawal simulation — projection shows a future balance but not what it buys
- Projection assumes a single constant rate of return — no conservative/moderate/aggressive scenarios
- Coast FIRE ("stop contributing now and still hit your goal") not calculated
- No Social Security estimate integration
- No Required Minimum Distributions (RMD) modeling

### Issues

| # | Tier | Title |
|---|------|-------|
| RT-01 | P0 | Annual contribution limit tracker — warn when approaching or exceeding IRS limits per account type |
| RT-02 | P1 | Monthly withdrawal simulation — "at 4% withdrawal rate, this becomes ~$X/mo" |
| RT-03 | P1 | Coast FIRE calculation — when can you stop contributing and still hit your target? |
| RT-04 | P2 | Multi-scenario projections — conservative / moderate / aggressive rate-of-return comparison |

---

## Feature 13 — Planned / New Feature Areas

### 13a — Home Purchase Planning

**Rationale:** The app already has all required data (income, DTI, sinking funds, cash flow). A mortgage-specific layer surfaces it in the context users need when planning to buy.

**What it would include:**
- Down payment goal tracker (extends sinking funds with mortgage-specific logic)
- Mortgage affordability calculator (front-end ratio ≤28%, back-end ratio ≤43%)
- PMI threshold tracker (how far from 20% down to avoid PMI?)
- "Debts to clear before qualifying" — which debts improve DTI enough to qualify?
- Timeline to purchase at current savings rate

**Architecture:** New sub-tab under Savings (or a "Goals" page), reusing `computeMonthlyIncomeForMonth`, sinking fund model, and DTI data already on Health.

| # | Tier | Title |
|---|------|-------|
| NEW-01 | P1 | Home purchase planning — mortgage affordability, PMI tracker, down payment timeline, qualifying DTI check |

---

### 13b — FIRE Number / Financial Independence

**Rationale:** Annual expenses are derivable from the ledger, net worth is already tracked, savings rate is calculable. A FIRE card on the Health dashboard is cheap to build and high-value.

**What it would include:**
- FIRE number (25× annual expenses, from ledger outflow)
- Current net worth vs. FIRE target (progress bar)
- Projected FI date at current savings rate
- Lean FIRE / Fat FIRE variants (user-adjustable multiplier)

| # | Tier | Title |
|---|------|-------|
| NEW-02 | P0 | FIRE number card on Health — 25× annual expenses target, current progress, projected FI date |

---

### 13c — Credit Factors (Not a Score)

**Rationale:** A real credit score is impossible without a bureau pull. But the factors that drive it — utilization, DTI, account mix, debt age — are all in-app. An explainer panel on the existing Health credit utilization card adds value without misleading.

| # | Tier | Title |
|---|------|-------|
| NEW-03 | P3 | Credit factors explainer on Health utilization card — no fake score, just factor education and link to AnnualCreditReport.com |

---

### 13d — DTI Math Models and Debt Analytics

**Rationale:** The app computes one DTI model (consumer DTI: debt minimums ÷ gross income). Several additional models are cheap to add and serve distinct real-world use cases.

**Model landscape:**

| Model | Formula | Standard Threshold | Buildable? |
|-------|---------|-------------------|-----------|
| Consumer DTI (current) | all debt mins ÷ gross income | <36% general | ✅ already done |
| Mortgage front-end ratio | housing costs only ÷ gross income | <28% | ✅ filter debts by type |
| Mortgage back-end ratio | all debt + housing ÷ gross income | <43% conventional, <50% FHA | ✅ easy |
| Net DTI | all debt mins ÷ net income | <25% take-home (Ramsey) | ⚠️ requires I-04 (gross/net field) |
| Interest burden rate | monthly interest cost ÷ income | <5% healthy | ✅ month-1 interest from strategy engine |
| Debt-to-asset ratio | total liabilities ÷ total assets | <1.0 is solvent | ✅ net worth already tracked |

**Minimum payment trap:** `DebtCalculator.calculatePaymentPlan` already supports running each debt at minimum payment — just needs a per-debt display.

| # | Tier | Title |
|---|------|-------|
| NEW-04 | P0 | Interest burden rate card on Health — monthly interest cost ÷ income (% of income burned on interest) |
| NEW-05 | P1 | Multi-model DTI view — Consumer, Mortgage Front-End, and Mortgage Back-End side by side on Health |
| NEW-06 | P1 | "Minimum payment trap" per debt — total cost and payoff date if only minimums ever paid |
| NEW-07 | P3 | Debt-to-asset ratio on Health (net worth already tracked, expose as a ratio) |

---

## Cross-Cutting Concerns

### App-Wide UX

| # | Tier | Title |
|---|------|-------|
| X-01 | P0 | Keyboard shortcuts help panel — document Ctrl+K and other shortcuts in-app |
| X-02 | P0 | In-app "What's New" notification — surface CHANGELOG entries after version bumps |
| X-03 | P1 | Empty state improvements — new-user pages with example data prompts and first-action CTAs |
| X-04 | P1 | Inter-page cross-navigation — e.g., clicking a debt from the Ledger navigates to that debt's card |
| X-05 | P3 | Settings modal tabbed layout — group by UX, Data, Storage, Notifications |

### Data & Import/Export

| # | Tier | Title |
|---|------|-------|
| X-06 | P0 | Auto-capture monthly net worth snapshot option — no longer requires manual "Capture" each month |
| X-07 | P1 | JSON import error surface — show per-field validation errors with context, not just a generic fail |
| X-08 | P2 | Bank CSV import — map imported transactions to ledger entries, auto-clear matches |
| X-09 | P3 | Separate settings export/import — back up only settings (theme, storage pref, etc.) |

### Performance & Scalability

| # | Tier | Title |
|---|------|-------|
| X-10 | P1 | Ledger pagination — cap initial render to the current month; lazy-load earlier months |
| X-11 | P3 | List pagination on Liabilities and Recurring for users with 50+ items |

### Accessibility

| # | Tier | Title |
|---|------|-------|
| X-12 | P1 | `renderChartDataTable` missing on 4 new charts (rptIncomeChart, rptOutflowChart, rptMoneyFlowChart, rptNetWorthCompositionChart) |
| X-13 | P1 | Focus-trap + restore missing on 4 new modals (ledger export, mark-all-cleared, calendar day, spending drill-down) |
| X-14 | P3 | ARIA label audit on all interactive elements (filter chips, tab buttons, inline edit controls) |
| X-17 | P1 | `role="tabpanel"` missing on 8 Reports tab panels (tab buttons have roles, panels don't) |
| X-18 | P1 | Strategy sub-tabs missing `role="tablist"` / `role="tab"` / `aria-selected` / `aria-controls` |
| X-19 | P1 | Enforce chart a11y in CI — add canvas IDs to accessibility test so new charts can't ship without sr-table |

### Internationalization

| # | Tier | Title |
|---|------|-------|
| X-15 | P1 | Complete i18n coverage for all non-translated pages (Liabilities, Ledger, Strategy, etc.) |
| X-16 | P3 | Additional locales — community-contributed translations infrastructure |

---

## Consolidated Priority List

### P0 — Quick Wins (High Impact, Low Cost)
_Ship these without a spec — each is ≤1–2 days._

| # | Feature | Title |
|---|---------|-------|
| H-01 | Health | Month-over-month trend arrows on health metric cards |
| H-02 | Health | Clickable health cards navigate to their relevant page |
| A-01 | Accounts | Account archive/unarchive |
| A-02 | Accounts | Interest rate field on Savings/Checking accounts |
| I-01 | Income | Income categories |
| P-01 | People | Per-person financial summary card |
| D-01 | Liabilities | Debt notes/memo field |
| D-02 | Liabilities | Interest paid to date per debt card |
| D-03 | Liabilities | Break-even analysis link from debt card |
| R-01 | Recurring | Upcoming-this-month summary panel |
| R-02 | Recurring | Overdue indicator |
| S-01 | Savings | Auto-sync emergency fund from linked account balance |
| ST-01 | Plan | Auto-fill suggested monthly payment |
| ST-02 | Plan | Export payment schedule to CSV |
| RP-01 | Reports | Spending category click → transaction drill-down |
| RP-02 | Reports | Print-friendly CSS for all report sub-pages |
| L-01 | Ledger | Visual override indicator on transactions |
| L-02 | Ledger | Bulk clear/unclear transactions |
| RC-01 | Reconcile | Cleared status in expected transactions list |
| RC-02 | Reconcile | Bank statement start/end date fields |
| RT-01 | Retirement | Annual contribution limit tracker |
| CI-01 | CI | Assign 9 unsharded test files to CI shard jobs (~172 tests never run in CI) |
| SEC-01 | Server | Add rate limiter to `POST /auth/reset-password` (5-line fix, DoS amplification surface) |
| I18N-01 | i18n | People nav button + 3 Settings strings hardcoded English — add `data-i18n` and locale keys |
| I18N-02 | i18n | Surplus sparkline `renderChartDataTable` caption hardcoded English — add locale key |
| NEW-02 | Health | FIRE number card — 25× annual expenses target, projected FI date |
| NEW-04 | Health | Interest burden rate — monthly interest cost ÷ income |
| X-01 | App | Keyboard shortcuts help panel |
| X-02 | App | In-app "What's New" notification after version bumps |
| X-06 | App | Auto-capture monthly net worth snapshot option |

### P1 — High Value (High Impact, Medium Cost)
_Schedule for upcoming sprints._

| # | Feature | Title |
|---|---------|-------|
| H-03 | Health | Customizable budget category thresholds |
| H-04 | Health | "Top 3 recommendations" panel |
| A-03 | Accounts | Balance breakdown drill-down |
| I-02 | Income | Income trend chart (YoY) |
| I-03 | Income | Promote Bonus Advisor discoverability |
| P-02 | People | Shared vs. individual flag on debts/income |
| D-04 | Liabilities | Next payment due date per debt |
| D-05 | Liabilities | Bulk debt actions |
| D-06 | Liabilities | Group debts by person or institution |
| R-03 | Recurring | Actual-amount override when marking paid |
| R-04 | Recurring | Category suggestions / autocomplete |
| S-02 | Savings | Priority ordering of sinking funds |
| S-03 | Savings | Sinking fund completion flow |
| ST-03 | Plan | Visual payoff Gantt chart |
| ST-04 | Plan | Refinancing what-if scenario |
| ST-05 | Plan | "Plan may be stale" warning |
| RP-03 | Reports | Custom date range for Spending and Variance |
| RP-04 | Reports | Year-over-year spending comparison |
| RP-05 | Reports | Net worth trajectory projection |
| L-03 | Ledger | Filter state persistence |
| L-04 | Ledger | Memo/notes on overrides |
| RC-03 | Reconcile | Partial/in-progress reconciliation |
| RT-02 | Retirement | Monthly withdrawal simulation |
| RT-03 | Retirement | Coast FIRE calculation |
| NEW-01 | Savings | Home purchase planning — mortgage affordability, PMI tracker, qualifying DTI |
| CI-02 | CI | Extend Stryker scope to sanitizers.js lines 154–343 + unit tests for 8 uncovered sanitizer functions |
| EX-01 | Data Export | PNG/chart image export (designed in spec, never built) |
| NEW-05 | Health | Multi-model DTI view — Consumer, Mortgage Front-End, Back-End side by side |
| NEW-06 | Liabilities | "Minimum payment trap" per debt — true cost if only minimums ever paid |
| X-03 | App | Empty state improvements |
| X-04 | App | Inter-page cross-navigation |
| X-07 | App | JSON import error surface with per-field context |
| X-10 | App | Ledger pagination |
| X-12 | App | `renderChartDataTable` on 4 new charts missing it (rptIncomeChart, rptOutflowChart, rptMoneyFlowChart, rptNetWorthCompositionChart) |
| X-13 | App | Focus-trap + restore on 4 new modals missing it (ledger export, mark-all-cleared, calendar day, spending drill-down) |
| X-17 | App | `role="tabpanel"` missing on 8 Reports tab panels |
| X-18 | App | Strategy sub-tabs missing `role="tablist"` / `role="tab"` / `aria-selected` / `aria-controls` |
| X-19 | App | Enforce chart a11y in CI — add canvas IDs to accessibility test so new charts can't ship without sr-table |
| X-15 | i18n | Complete i18n coverage across all pages (Retirement, Liabilities, Ledger, etc.) |
| X-20 | i18n | Retirement page fully hardcoded English — no `t()` calls in `retirement.js` |
| MISC-01 | App | New circular import leg via `people.js` (ui.js → people.js → postgresSync.js → ui.js) — document and audit cycle safety |

### P2 — Strategic (High Impact, High Cost — each needs its own spec)

| # | Feature | Title |
|---|---------|-------|
| A-05 | Accounts | Transfer tracking between accounts |
| I-04 | Income | Gross vs. net (tax withholding per income source) |
| R-05 | Recurring | Recurring income templates |
| RP-06 | Reports | Budget configuration page (explicit per-category budgets) |
| L-05 | Ledger | Bank CSV/OFX import with auto-clear |
| RT-04 | Retirement | Multi-scenario projections (conservative/moderate/aggressive) |
| X-08 | App | Bank CSV import (full pipeline) |
| PERF-01 | App | `saveToStorage()` debounce — re-serializes full state on every call with no batching |
| PERF-02 | App | Dynamic `import()` for non-critical modules — no code-splitting at all, entire app loads on first paint |

### P3 — Improvements (Medium Impact, Low–Medium Cost)

| # | Feature | Title |
|---|---------|-------|
| H-05 | Health | Per-card credit utilization breakdown |
| A-04 | Accounts | Account notes field |
| I-05 | Income | Recurring annual bonus type |
| D-07 | Liabilities | "Debt paid off" celebration modal |
| R-06 | Recurring | Pause with auto-resume date |
| S-04 | Savings | Savings rate summary |
| S-05 | Savings | Emergency fund balance history chart |
| ST-06 | Plan | Plan history full per-debt comparison |
| RP-07 | Reports | Spending → Ledger cross-navigation |
| RC-04 | Reconcile | Reconciliation report export |
| X-05 | App | Settings modal tabbed layout |
| X-09 | App | Settings-only export/import |
| X-11 | App | List pagination on large Liabilities/Recurring sets |
| X-14 | App | ARIA label audit |
| X-16 | i18n | Community-contributed translation infrastructure |
| SEC-02 | Server | Document no-user-data contract on `i18n.js` `t()` var substitutions (comment, not a code change) |
| MISC-02 | App | PWA offline test coverage — 2 tests exist, neither exercises real page interactions |
| NEW-03 | Health | Credit factors explainer on utilization card (no fake score, just education) |
| NEW-07 | Health | Debt-to-asset ratio on Health (net worth already tracked, expose as ratio) |
| CI-01 | CI | Assign 9 unsharded test files to CI shard jobs (~172 tests never run in CI) |
| EX-01 | Data Export | PNG/chart image export — designed in data-export spec but never built |

---

## Total Issue Count

| Tier | Count |
|------|-------|
| P0 — Quick Wins | 30 |
| P1 — High Value | 40 |
| P2 — Strategic | 9 |
| P3 — Improvements | 19 |
| **Total** | **98** |
