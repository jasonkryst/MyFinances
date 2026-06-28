
# MyFinances

_A modern, privacy-first web app to track accounts, debts, income, and spending, helping you plan and visualize your path to financial freedom._

All calculations happen locally in your browser — no accounts, no servers, no tracking.

**Security Status**: ✅ Production-Ready | **Risk Level**: LOW | **Audit Date**: June 19, 2026 | **Last Scan**: Static security scan passed (0 HIGH, 0 MEDIUM)

---

## 🚀 Quick Start

```bash
# Development (Python)
python -m http.server 5500

# Docker (recommended for consistent environments)
docker compose up -d        # Build and run at http://localhost:5500
docker compose down         # Stop

# Open browser
http://localhost:5500

# Run tests
pytest tests/ -v                  # Run all tests
pytest tests/security/ -v         # Security tests only
pytest tests/features/ -v         # Feature tests only
pytest tests/ui/ -v               # UI/UX tests only
pytest tests/integration/ -v      # End-to-end tests only
pytest -m "not slow" -v           # Skip slow tests
```

See [tests/README.md](tests/README.md) for comprehensive test documentation.  
See [CHANGELOG.md](CHANGELOG.md) for version history and release notes.  
For production deployment, see [DEPLOYMENT.md](DEPLOYMENT.md).

---

## 🔒 Security & Privacy

MyFinances prioritizes your financial data security:

### Security Features
- ✅ **Zero Data Transmission** — All data stays on your device
- ✅ **XSS Prevention** — All user input sanitized and HTML-encoded via `escapeHtml()`
- ✅ **Strong CSP** — `script-src 'self' https://cdn.jsdelivr.net`, `style-src 'self'` — no inline scripts or styles
- ✅ **Security Headers** — X-Content-Type-Options, X-Frame-Options, frame-ancestors protection
- ✅ **No External Dependencies** — Vanilla JavaScript (no npm supply-chain risk)
- ✅ **Secure File Imports** — JSON validation + 2 MB size limit + full re-sanitization on import
- ✅ **Input Validation** — Numeric bounds, date validation, text sanitization at every entry point
- ✅ **Client-Side Only** — No server, no authentication surface

### Privacy Guarantee
- ✅ All calculations run entirely in your browser
- ✅ No data is sent to any server
- ✅ No accounts, no tracking, no analytics
- ✅ Data stored only in your browser's `localStorage` (same-origin isolated)

### Documentation
- [SECURITY.md](SECURITY.md) — Detailed security practices, CSP policy, vulnerability reporting
- [docs/audit/security/](docs/audit/security/) — Full security audit reports
- [DEPLOYMENT.md](DEPLOYMENT.md) — Production deployment with security headers

---

## 📋 Features

### Navigation & Accessibility
- **Grouped main navigation** — Three labeled groups: **Overview** (Health, Accounts, Income), **Manage** (Liabilities, Recurring, Savings, Plan), **Analyze** (Reports, Ledger, Reconcile); active-group highlighting, `aria-current`, hamburger menu on ≤768px
- **Command palette** — Ctrl/Cmd+K or the 🔍 toolbar button opens a fuzzy-search jump list across all 10 pages and common actions; Arrow-key navigation, Enter to activate, Escape restores focus; full `role="dialog"` / `role="listbox"` ARIA semantics
- **Dark mode** — toggle in the header toolbar; preference persisted to localStorage
- **Print / Save as PDF** — 🖨️ Print button on every page; `@media print` hides forms/controls so only read-only data content prints; browser print-to-PDF doubles as a PDF export
- **Keyboard navigation** — all interactive elements reachable by keyboard; modals trap focus and Escape-to-close; calendar day-cells keyboard-activatable
- **Reduced motion** — `prefers-reduced-motion: reduce` collapses all CSS transitions/animations; `Chart.defaults.animation` disabled app-wide when the OS preference is set
- **Screen-reader chart tables** — every Chart.js canvas has a paired visually-hidden `.sr-only` `<table>` with the same data, rebuilt on every chart re-render via `renderChartDataTable()` in `utils.js`
- **localStorage quota monitoring** — soft-warning banner when usage crosses ~80% of the estimated 5 MB limit; hard-failure banner if `setItem` actually throws
- **In-app guide** — the ❓ Help button opens `guide.html` in a new tab; theme and dark mode follow the main app preference

---

### Financial Health Dashboard
The app's default landing page — six at-a-glance metric cards:

| Card | What it shows |
|------|---------------|
| **Debt-to-Income Ratio** | Monthly debt payments ÷ income; Healthy / Moderate / High Risk badge |
| **Savings Rate** | Emergency + sinking fund contributions as % of income; Strong / Moderate / Low badge |
| **Emergency Fund Runway** | Months of expenses covered per fund; Critical → Excellent badge |
| **Debt Payoff Timeline** | Years to debt-free at minimum payments (avalanche); % progress bar |
| **Monthly Cash Flow** | Income minus all outflows; Surplus / Break Even / Deficit badge with breakdown |
| **Budget Allocation** | Bill + expense categories as % of income with colour-coded bars; debt payments row included |

Internal links on each card navigate directly to the relevant page (Savings, Liabilities, Plan).

---

### Account Management
- **Account types** — Checking, Savings, Cash, Investment, Credit Card, Loan, or Other; name and starting balance
- **Account linking** — income sources, one-time entries (bonuses/deposits), debts, recurring templates, and expense budgets can all be linked to an account
- **Projected monthly balance** — each account card shows a projected end-of-month balance: starting balance ± all linked income, debt payments, recurring transactions, and expenses for the current month, including any ledger amount overrides
- **Net worth widget** — current net worth and change from the prior snapshot shown on the Accounts page
- **Export / Import** — accounts are included in the JSON backup (format version `"4.0.0"`)

---

### Debt Management
- **Unlimited debts** — credit cards (revolving balance + APR) or fixed-amount recurring payments (subscriptions, rent, instalments)
- **Single-page add & manage** — add form and debt list side by side; no page switching
- **Inline editing** — Edit button populates the form for editing; list updates immediately on save
- **Update Balance** — record a new balance for any credit card while preserving the original for progress tracking
- **Category labels** — tag debts and filter the list by category
- **Priority levels** — assign 1–100 priority for custom strategy ordering
- **Payoff Date display** — every debt card shows a 📅 Payoff Date sourced from the plan calculation; shows "Run a plan to see" hint until a plan exists
- **Interest Paid to Date** — estimate shown on each debt card, based on original balance and opened date

---

### Income Tracking
- **Income sources** — name, amount per paycheck, first pay date, and frequency (bi-weekly or monthly); automatic pay-schedule projection for the current month
- **One-time entries** — bonus, tax refund, cash deposit, check deposit, or other; linkable to an account
- **Monthly summary** — expected income this month, regular pay, one-time entries, estimated annual total
- **Debt-to-income ratio** — Plan page shows monthly debt payment as a % of income with a warning above 40%

---

### Budget Tracking (Expenses)
- **Expense budgets** — variable monthly spending targets with date tracking (for calendar and ledger); inline editing in the list
- **Bills** — fixed monthly costs with due day and category (data model; no standalone add UI — use Recurring Templates for new fixed costs)
- **Cash Flow Summary** — live panel: Income − Debt minimums − Bills − Budgeted expenses = Net remaining
- **Persisted to storage** — expenses and bills are saved to localStorage and included in JSON export/import

---

### Recurring Transaction Templates
- **Three types** — Subscription (outflow), Reimbursement (inflow), Transfer (debit one account, credit another)
- **Flexible frequency** — Weekly, bi-weekly, monthly, quarterly, yearly
- **Start and end dates** — constrain to a specific date range
- **Pause & skip controls** — temporarily pause a template or skip individual months without deleting
- **Mark as Paid** — one-click "paid this month" toggle per template (`paidMonths`); distinct from Skip; resets each calendar month
- **Integrated** — recurring templates generate projected transactions in the ledger and appear in all Reports views

---

### Savings (Emergency Fund & Sinking Funds)
- **Emergency Fund** — target amount, current savings, monthly contribution, auto-contribution toggle; progress bar + % badge
- **Sinking Funds** — named savings goals with three allocation methods: Fixed Monthly Amount, Annual Cost ÷ 12, or Target Date Planning (app calculates required monthly amount)
- **Auto-contribute** — auto-contributions appear as dedicated outflows in the Ledger, Reports, and Account projections
- **Integrated with Reports** — contributions appear in Income vs. Expenses, Money Flow chart, Variance Dashboard, and account projections

---

### Account Reconciliation
- **Reconcile page** — per-account statement balance entry with a live colour-coded difference vs. tracked balance; "Expected transactions since {date}" listing helps identify discrepancies
- **Two modes** — **Adjust Balance** (reconciliation updates `startingBalance` going forward) or **Visible Only** (recorded and shown on Ledger but does not mutate the tracked balance); changeable any time via the Settings modal (⚙ gear icon or command palette)
- **Ledger integration** — every reconciliation appears as a marker row on the unified Ledger with previous → statement balance and difference; an inline ℹ icon shows whether the current mode is active (blue) or informational (muted)
- **History log** — each reconciliation records previous balance, statement balance, difference, and an optional note; per-entry delete does not revert the balance
- **Quick-reconcile modal** — "🔄 Reconcile this account" button on the Ledger page (when a single account is selected)
- **Export/Import** — `app.reconciliations` and `app.settings` round-trip through JSON backup

---

### Ledger
- **Unified transaction list** — income, one-time entries, debts, bills, expenses, recurring templates, savings contributions, and reconciliation markers in one scrollable view
- **Account + date range filters** — filter by account and by range (All, Past & Today, Next 30/60/90 Days, Through Next Month)
- **Amount overrides** — modal-based Override / Edit override / Reset per transaction; overrides are keyed by type+id+account+date so they survive ledger re-sorts; changing an override immediately recalculates running balances, Reports, and account projections
- **Running balance** — continuous balance column; snaps to the statement balance at each reconciliation marker when "Adjust Balance" mode is active
- **CSV export** — column-picker modal (date, account, name, amount, category, running balance, type); exports respect the current filter and sort; selected columns persist between sessions

---

### Calendar & Reports
- **Month-by-month calendar** — income paydays, recurring occurrences, expenses, debt payments, and bonuses pinned to their dates; compact dot-count cells open a full event modal on click/Enter
- **Income vs. Expenses** — chart with income, recurring costs, and debt minimums for the current month
- **Money Flow** — cumulative income/outflow/net tracked day-by-day through the month; per-account balance table
- **Variance Dashboard (What Changed)** — current vs. previous month deltas for income, expenses, recurring costs, debt minimums, and net available
- **Net Worth** — historical trend chart (3/6/12 month), Net Worth vs. Liabilities, Asset Growth vs. Debt Reduction, snapshot history audit table, manual snapshot capture; milestone celebrations at +$5K increments
- **Spending Analysis** — doughnut pie of all outflows for the selected month; 6-month stacked bar trend; ranked category list with month-over-month % badges; drill-down modal per category
- **Cash Flow Forecast** — project balances 1/2/3/6/12 months ahead for total cash position or a single account; notable-month driver flags; negative-balance and intra-month dip warnings
- **Summary Report** — Monthly/Yearly toggle with cash flow, per-account balance changes, and net worth for the selected period

---

### Calculation Engine
- **Daily compounding interest** — `monthlyInterest = balance × ((1 + APR/365)^daysInMonth − 1)`
- **Four strategies** — Avalanche (highest APR first), Snowball (lowest balance first), Priority-Low, Priority-High
- **Per-month stimulus** — add a one-time extra payment for any month; plan recalculates instantly
- **Negative-amortisation warning** — badge flags any debt where the minimum payment is below the monthly interest
- **Strategy comparison panel** — runs all four strategies and shows interest/time saved vs. your current choice
- **What-If simulator** — drag a slider to add extra monthly payment and instantly see months saved / interest saved
- **Target Payoff Date** — enter a desired payoff date; binary-search back-calculator (up to 60 iterations) finds the required monthly payment

### Charts (Chart.js)
- Payoff Timeline — one line per debt declining to zero
- Cumulative Progress — Total Paid, Principal Paid, Interest Paid running totals
- Principal vs. Interest doughnut
- Debt Balance Distribution pie
- Monthly Debt-to-Income pie (requires income sources)

---

### Data Management
- **Persistent storage** — all data auto-saved to `localStorage`; key `debtTrackerData`, format `"4.0.0"`
- **JSON export** — one-click full backup including accounts, debts, income, bills, expenses, recurring templates, snapshots, overrides, reconciliations, and settings
- **JSON import** — Replace (full restore) or Merge (append debts; restore income, bills, expenses, overrides); legacy v1.0 files accepted; 2 MB max; full re-sanitization after import
- **CSV export** — debt payment schedule + per-debt summary; Ledger CSV with custom column picker
- **Clear All Data** — wipe everything and start fresh

---

## How to Use

Click **❓ Help** in the toolbar to open the full usage guide (`guide.html`) in a new tab.

### 1 — Add your debts
Navigate to **Liabilities**. The page shows the add form and the debt list side by side.

| Field | Notes |
|-------|-------|
| Debt Name | Any label (e.g. "Visa", "Car Loan") |
| Debt Type | Credit Card (revolving) or Fixed Amount (recurring) |
| Balance / Amount | Current balance or fixed monthly cost |
| APR | Annual interest rate, e.g. `18.9` |
| Minimum Payment | The minimum you must pay each month |
| Due Date | Day of month the payment is due (used in Calendar view) |
| Priority | 1–100, used by Priority strategies |
| Opened Date | Optional — enables the Interest Paid to Date estimate |
| Category | Optional label for filtering |

### 2 — Set up your accounts (optional)
Navigate to **Accounts**. Define the bank accounts, wallets, or credit cards your money flows through. Each account card shows a **projected end-of-month balance** factoring in all linked income, debts, and expenses.

### 3 — Set your strategy and view results
Navigate to **Plan**.
1. Enter your **Total Monthly Payment**.
2. Choose a **Payment Strategy**.
3. Optionally use **Back-calculate from target payoff date**.
4. Click **Calculate Payment Plan**.

Results appear in three tabs:

| Tab | Contents |
|-----|----------|
| **📊 Overview** | Strategy comparison panel; What-If extra-payment simulator |
| **📋 Debt Summary** | Sortable per-debt table with payoff dates and progress bars; amortization modal |
| **📅 Schedule** | Tabular (monthly schedule with editable stimulus), Calendar, Chart |

### 4 — Track your income
Navigate to **Income**. Add one row per income source. Use the one-time entry section for bonuses, tax refunds, and irregular deposits.

### 5 — Track your budget
Navigate to **Liabilities** (Budget sub-tab). Add bills (fixed monthly costs) and expense budgets (variable spending targets with category and date). The Cash Flow Summary panel shows net remaining after all outflows.

### 6 — Export / Import
The **⬇ Export** and **⬆ Import** buttons are in the top-right toolbar on every page.

- **Export (JSON)** — complete backup of all data as a single `.json` file
- **Import (JSON)** — choose Replace (full restore) or Merge (append debts)
- **Export CSV** — payment schedule or Ledger with custom columns
- **Print / Save as PDF** — 🖨️ Print button on every page

---

## Payment Strategies Explained

| Strategy | Order | Best for |
|----------|-------|----------|
| **Avalanche** | Highest APR first | Minimising total interest paid |
| **Snowball** | Lowest balance first | Psychological momentum |
| **Priority – Low first** | Lowest priority number first | Custom ordering (deprioritise debts manually) |
| **Priority – High first** | Highest priority number first | Tackling the most important debt first |

The **Strategy Comparison** panel on the Plan page always shows all four strategies simultaneously.

---

## 📚 Technical Details

### File Structure

```
index.html                  — Main page shell + responsive nav + CSP meta tag
guide.html                  — In-app usage guide (opened by Help button)
guide.css                   — Styles for guide.html (externalized for CSP compliance)
styles.css                  — Responsive styles + dark mode + utilities + print stylesheet
styles-csp-classes.css      — CSP-compliant utility classes + dynamic CSS variable rules
src/
  ├─ app.js                — Main app controller & state (DebtTrackerApp)
  ├─ ui.js                 — Event listeners, page navigation, mobile menu
  ├─ commandPalette.js     — Ctrl+K command palette
  ├─ settings.js           — App settings (reconciliation mode, etc.)
  ├─ setupWizard.js        — First-run setup wizard
  ├─ strategy.js           — Debt payoff calculations & results rendering
  ├─ debts.js              — Debt management (CRUD & inline editing)
  ├─ accounts.js           — Account management & balance projections
  ├─ income.js             — Income sources & one-time entries
  ├─ bills.js              — Bills data model (no standalone add UI — use Recurring)
  ├─ recurring.js          — Recurring transaction templates
  ├─ savings.js            — Emergency fund & sinking fund tracking
  ├─ ledger.js             — Transaction ledger with amount overrides & CSV export
  ├─ reconciliation.js     — Account statement reconciliation
  ├─ health.js             — Financial health dashboard (DTI, savings rate, runway)
  ├─ spending.js           — Spending analysis (category breakdowns, trends)
  ├─ reports.js            — Reports & calendar views
  ├─ forecast.js           — Cash Flow Forecast (Reports tab)
  ├─ charts.js             — Chart rendering & lifecycle
  ├─ storage.js            — Persistence, import/export, data validation
  ├─ debtCalculator.js     — Pure calculation engine (no side effects, no DOM access)
  ├─ guideTheme.js         — Applies saved dark-mode theme to guide.html
  └─ utils.js              — Formatting, date utilities, sanitization, chart tables
tests/ (452 tests across 51 files)
  ├─ conftest.py              — Shared fixtures & utilities
  ├─ README.md                — Comprehensive test documentation
  ├─ security/ (56 tests)     — XSS, CSP, input validation, static scan
  │   ├─ test_xss.py, test_csp.py
  │   └─ test_input_validation.py, test_static_scan.py
  ├─ features/ (203 tests)    — Per-feature CRUD, calculations, business logic
  │   ├─ test_accounts.py, test_debts.py, test_income.py, test_bills.py
  │   ├─ test_expenses.py, test_recurring.py, test_recurring_occurrences.py
  │   ├─ test_ledger.py, test_reports.py, test_savings.py, test_networth.py
  │   ├─ test_health.py, test_forecast.py, test_reconciliation.py
  │   ├─ test_spending_analysis.py, test_storage_import.py, test_storage_quota.py
  │   ├─ test_debt_calculator.py, test_strategy.py, test_settings.py
  │   └─ test_main_nav_groups.py, test_reports_nav_groups.py
  ├─ ui/ (170 tests)          — UI/UX, responsiveness, accessibility
  │   ├─ test_mobile.py, test_modals.py, test_dark_mode.py
  │   ├─ test_css_load.py, test_accessibility.py, test_main_nav.py
  │   ├─ test_charts.py, test_chart_accessibility.py, test_guide_theme.py
  │   ├─ test_guide_nav.py, test_reduced_motion.py, test_command_palette.py
  │   ├─ test_setup_wizard.py, test_overview_print.py, test_remaining_pages_print.py
  │   ├─ test_table_mobile_scroll.py
  │   ├─ test_debt_actions.py, test_recurring_actions.py, test_reports_actions.py
  │   └─ test_reports_nav.py, test_reconciliation_actions.py, test_spending_ui.py
  ├─ a11y/ (10 tests)         — Site-wide WCAG 2.1 AA accessibility audit
  │   └─ test_a11y_audit.py, run_a11y_audit.py
  └─ integration/ (13 tests)  — End-to-end workflows, import/export, data persistence
      ├─ test_smoke.py, test_workflows.py
tools/
  └─ debug/                   — Ad-hoc manual debugging scripts (not part of pytest suite)
```

> **Known gap:** The standalone Bills UI (`#billForm`/`#billList`) was removed in favor of Recurring Templates, but `bills.js` still defines the full bills data model and calculation logic — `app.bills` is read by `accounts.js`, `health.js`, `ledger.js`, and `strategy.js`, and round-trips through import/export. There is currently no reachable UI to add or edit a bill.

### Documentation Files

- **[README.md](README.md)** — You are here
- **[CHANGELOG.md](CHANGELOG.md)** — Version history and release notes
- **[ROADMAP.md](ROADMAP.md)** — Planned features, known gaps, technical debt tracking
- **[SECURITY.md](SECURITY.md)** — Security practices, CSP policy, vulnerability reporting
- **[DEPLOYMENT.md](DEPLOYMENT.md)** — Production deployment guides (Nginx, Apache, Docker)
- **[tests/README.md](tests/README.md)** — Comprehensive test documentation
- **[docs/audit/security/](docs/audit/security/)** — Security audit reports
- **[docs/audit/a11y/](docs/audit/a11y/)** — Accessibility audit reports
- **[docs/audit/test/](docs/audit/test/)** — Test suite audit and coverage reports
- **[guide.html](guide.html)** — In-app user guide

### Key Technologies

- **Frontend**: Vanilla ES6+ JavaScript — no frameworks, no build step
- **Storage**: Browser localStorage (same-origin isolated)
- **Charts**: Chart.js 4.4.3 via CDN
- **Testing**: pytest + Playwright (browser automation)

### Formulas & Algorithms

#### Interest Calculation (Daily Compounding)
```
monthlyInterest = balance × ((1 + APR / 100 / 365)^daysInMonth − 1)
```

#### Interest Paid to Date
```
totalAccrued = originalBalance × ((1 + APR/100/365)^daysSinceOpened − 1)
interestPaid = max(0, totalAccrued − principalPaidDown)
```

#### Target Payoff Date Back-Calculator (Binary Search)
```
lo  = sum of all minimum payments
hi  = 2 × totalBalance + 10,000
for 60 iterations:
    mid = (lo + hi) / 2
    if calculatePaymentPlan(mid) pays off by target date → hi = mid
    else → lo = mid
```

### Security Implementation

#### Input Validation & Sanitization
- `normalizeText()` — strips dangerous characters from text fields
- `sanitizeFiniteNumber()` — validates numbers with optional min/max bounds
- `sanitizeInteger()` — integer validation
- `sanitizeDateISO()` — strict YYYY-MM-DD format validation
- `escapeHtml()` — HTML entity encoding for all output via `innerHTML`

#### Import Safety
- Maximum file size: 2 MB
- JSON validation with try-catch
- Complete re-sanitization on every import (all `sanitize*` functions run again)
- Duplicate detection and filtering
- Type checking on all fields

#### Content Security Policy (CSP)
```
default-src 'self';
script-src 'self' https://cdn.jsdelivr.net;
style-src 'self';
img-src 'self' data:;
font-src 'self';
connect-src 'self' https://cdn.jsdelivr.net;
object-src 'none';
base-uri 'self';
form-action 'self'
```

> `frame-ancestors 'none'` is enforced via `X-Frame-Options: DENY` HTTP header (browsers ignore `frame-ancestors` in `<meta>` CSP tags per spec). Server deployments in [DEPLOYMENT.md](DEPLOYMENT.md) add it via the HTTP CSP header.

---

## 🧪 Testing Suite (Updated June 28, 2026)

### Test Statistics
- **Total Tests**: 452 comprehensive tests, all passing
- **Test Files**: 51 organized across 5 categories
- **Framework**: pytest with Playwright browser automation
- **Coverage**: All major features + security + UI + accessibility + integration paths

### Test Categories

#### 🔐 Security Tests (56 tests)
- **XSS Prevention** — Input sanitization across accounts, income, debts, recurring, savings, reconciliation, spending, health, ledger
- **CSP Compliance** — Strict Content Security Policy enforcement; meta tag / nginx header sync check
- **Input Validation** — Bounds checking, unicode, special characters, negative-amount guards on all forms
- **Static Analysis** — Code patterns, hardcoded secrets, dependencies

#### 🎯 Feature Tests (203 tests)
- **Accounts** — CRUD, projections, graceful orphaning of linked items on deletion
- **Debts** — Liability management, interest, amortization, fixed-amount validation
- **Debt Calculator** — Strategies (incl. multi-debt priority ordering), daily compounding, back-calculator, stimulus edge cases
- **Strategy / Plan** — Avalanche/Snowball/Priority switching, comparison panel, stimulus validation
- **Income** — Sources, frequencies, totals, negative-amount rejection (add + inline edit paths)
- **Expenses** — Add/edit/delete, amount/date validation
- **Bills** — Data model, sanitization, calculation integration
- **Recurring** — All frequencies, pause/resume, skip-month, mark-as-paid, account linkage, validation
- **Ledger** — Filtering, amount-override modal, key collision checks, CSV export column picker
- **Reports** — Income vs expenses, money flow, net worth analytics, tab grouping, date-boundary handling
- **Savings** — Emergency funds, sinking funds, persistence
- **Net Worth** — Snapshots, milestones, historical calculations
- **Financial Health** — All six cards, empty states, nav links
- **Cash Flow Forecast** — Horizon/account selection, notable months, negative-balance warnings, intra-month dip detection
- **Account Reconciliation** — Statement balance adjustments, expected-transaction matching, sanitization, import/export
- **Spending Analysis** — Category breakdowns, month-over-month trends
- **Settings** — Reconciliation mode persistence and import/export round-trip
- **Storage Import** — Sanitizer primitives, adversarial inputs for all record types, legacy v1.0 format
- **Storage Quota** — Soft warning at ~80%, dismissibility, re-arming, hard-failure on write error
- **Main Nav Groups** — Grouped navigation structure (Overview/Manage/Analyze)

#### 🎨 UI/UX Tests (170 tests)
- **Mobile Responsiveness** — Hamburger menu, viewport handling, touch sizing, table horizontal scroll
- **Modals** — Visibility toggling, close buttons, amortization, calendar day-detail, ledger export
- **Dark Mode** — Theme switching, contrast, persistence, corrupted-localStorage fallback
- **CSS Loading** — External stylesheet, utility classes, responsive breakpoints
- **Accessibility** — Keyboard navigation, ARIA labels, semantic HTML, Results tab-bar semantics
- **Guide Theme** — `guide.html` dark/light mode sync, nav back-link
- **Charts** — Chart.js instance destroy-before-recreate on repeated re-render
- **Chart Accessibility** — `.sr-only` data-table fallback present for health, spending, forecast, net-worth charts
- **Reduced Motion** — CSS transition-duration collapse and `Chart.defaults.animation` disabled under `prefers-reduced-motion`
- **Command Palette** — Ctrl+K / toolbar open, filtering, empty-state, arrow-key navigation, Enter-to-navigate, Escape/backdrop close
- **Setup Wizard** — First-run modal, setting persistence, skip flow
- **Print Buttons** — Present on Overview pages (Health/Accounts/Income) and all remaining pages; `@media print` stylesheet hides forms
- **Table Mobile Scroll** — Ledger, reconciliation expected, and report tables scroll within `.table-wrapper` on narrow viewports
- **Main Nav** — Grouped active-state highlighting and keyboard reachability
- **Reports Nav / Actions** — Tab-bar grouping, sticky positioning, dark mode, tab-switching visibility
- **Debt / Recurring / Reconciliation Actions** — Inline edit, mark-paid, reconcile-modal flows
- **Spending UI** — Pie/bar charts, ranked list, drill-down modal

#### ♿ Accessibility Audit (10 tests)
Site-wide sweep across all 10 pages × 2 themes + guide.html: dangling ARIA refs, duplicate IDs, orphaned form inputs, unnamed interactive elements, missing alt text, computed WCAG 1.4.3 colour contrast, modal Escape-to-close, mobile nav `aria-expanded`.

#### 🔄 Integration Tests (13 tests)
- **End-to-End Workflows** — Complete user journeys (account → debt → net worth → reconciliation)
- **Data Persistence** — Cross-navigation data integrity
- **Import/Export** — JSON roundtrip, CSV schedule export (incl. comma/quote escaping), full clear-all-data → reimport → render-every-page consistency check
- **Ledger CSV Export** — Column-picker modal, filtered export, column persistence

### Quick Test Commands

```bash
pytest tests/ -v                  # All 452 tests
pytest tests/security/ -v         # 56 security tests
pytest tests/features/ -v         # 203 feature tests
pytest tests/ui/ -v               # 170 UI/UX tests
pytest tests/a11y/ -v             # 10 accessibility audit tests
pytest tests/integration/ -v      # 13 integration tests
pytest -m "security" -v           # All security tests by marker
pytest -m "not slow" -v           # Skip slow tests
```

### Security Scan Results (June 19, 2026)

| Severity | Count | Status |
|----------|-------|--------|
| HIGH | 0 | ✅ |
| MEDIUM | 0 | ✅ |
| LOW | 12 | ✅ All properly handled |

---

## 📱 Browser Support & Requirements

| Browser | Version | Support |
|---------|---------|---------|
| Chrome | 60+ | ✅ Full |
| Firefox | 55+ | ✅ Full |
| Safari | 12+ | ✅ Full |
| Edge | 79+ | ✅ Full |
| IE 11 | — | ❌ Not supported |

**Required**: ES6+ JavaScript, localStorage enabled, CSS Grid & Flexbox, CSS custom properties.

---

## 🚀 Deployment

```bash
# Development
python -m http.server 5500
```

See [DEPLOYMENT.md](DEPLOYMENT.md) for Nginx, Apache, and Docker configurations including security headers, HTTPS, and caching.

---

## 🐛 Troubleshooting

**My data disappeared.**
> Browser storage may have been cleared. Use **⬇ Export** regularly as a portable JSON backup you can re-import any time.

**Import says "duplicate skipped" but I wanted to update.**
> Delete or rename the existing item first, then re-import. Or use inline editing to update manually.

**The payoff date is very far away.**
> Increase your monthly payment, switch to Avalanche strategy, or use the What-If slider to see required payment increase.

**Payment is less than minimum required.**
> The app will show an error. Your total monthly budget must cover every debt's minimum payment.

**A debt shows a ⚠️ neg-amort badge.**
> Your minimum payment is too low to cover monthly interest. Increase the payment or reduce the APR (e.g. balance transfer).

**Mobile menu isn't working.**
> Check that JavaScript is enabled and no CSP violations appear in the browser console.

**Data isn't persisting between refreshes.**
> Verify localStorage is enabled. Safari may require explicit permission in Storage settings.

**The storage quota warning appeared.**
> Export a JSON backup immediately. Consider clearing old net-worth snapshots or unused data to free space.

---

## 📞 Support & Contributions

### Security Issues
If you discover a security vulnerability:
1. **Do not** create a public GitHub issue
2. Contact the repository owner privately
3. Include steps to reproduce + impact assessment
4. See [SECURITY.md](SECURITY.md) for details

### Bug Reports
Open an issue with steps to reproduce, browser version, and OS. Run the test suite and include output.

### Contributions
- All changes should pass the security and feature test suites
- Add tests for new features (security, feature, and UI coverage)
- Follow the existing modular pattern: feature logic in a module function `featureFn(app, ...)`, thin wrapper on `DebtTrackerApp`
- All user-supplied strings rendered via `innerHTML` must use `escapeHtml()`
- New persisted fields must have a `sanitize*` entry in `storage.js`
- See [SECURITY.md](SECURITY.md) for security guidelines and [ROADMAP.md](ROADMAP.md) for planned work

---

**Start your journey to being debt-free today!** 💰

---

*MyFinances v4.2.1 — Updated June 28, 2026*
