
# MyFinances

_A modern, privacy-first web app to track accounts, debts, income, and spending, helping you plan and visualize your path to financial freedom._


All calculations happen locally in your browser — no accounts, no servers, no tracking.

**Security Status**: ✅ Production-Ready | **Risk Level**: LOW | **Audit Date**: June 19, 2026 (Updated) | **Last Scan**: Static security scan passed (0 HIGH, 0 MEDIUM)

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

# Run tests (pytest-based, reorganized May 31, 2026)
pytest tests/ -v                  # Run all tests
pytest tests/security/ -v         # Security tests only
pytest tests/features/ -v         # Feature tests only
pytest tests/ui/ -v               # UI/UX tests only
pytest tests/integration/ -v      # End-to-end tests only
pytest -m "security" -v           # All security tests by marker
pytest -m "not slow" -v           # Skip slow tests
```

See [tests/README.md](tests/README.md) for comprehensive test documentation.

For production deployment, see [DEPLOYMENT.md](DEPLOYMENT.md).

---

## 🔒 Security & Privacy

MyFinances prioritizes your financial data security with enterprise-grade protections:

### Security Features
- ✅ **Zero Data Transmission** — All data stays on your device
- ✅ **XSS Prevention** — All user input sanitized and HTML-encoded
- ✅ **Strong CSP** — Content Security Policy blocks malicious scripts (no unsafe-inline)
- ✅ **Security Headers** — X-Content-Type-Options, X-Frame-Options, frame-ancestors protection
- ✅ **No External Dependencies** — Vanilla JavaScript (no npm vulnerabilities)
- ✅ **Secure File Imports** — JSON validation + size limits + data re-sanitization
- ✅ **Input Validation** — Numeric bounds, date validation, text sanitization
- ✅ **Client-Side Only** — No server, no authentication needed
- ✅ **CSS Extracted** — All styles in external stylesheet (CSP compliant)

### Privacy Guarantee
- ✅ All calculations run entirely in your browser
- ✅ No data is sent to any server
- ✅ No accounts, no tracking, no analytics
- ✅ Data is stored only in your browser's `localStorage` (same-origin policy)

### Documentation
- [SECURITY.md](SECURITY.md) — Detailed security practices & implementation
- [docs/SECURITY_AUDIT.md](docs/SECURITY_AUDIT.md) — Full security audit report (updated May 31, 2026)
- [DEPLOYMENT.md](DEPLOYMENT.md) — Production deployment with security headers

### Recent Security Improvements (May 31, 2026)
- ✅ Extracted all inline styles to CSS classes for strict CSP compliance
- ✅ Implemented X-Content-Type-Options and X-Frame-Options security headers
- ✅ Completed static security scan with zero HIGH/MEDIUM severity findings
- ✅ Enhanced SECURITY.md with comprehensive contributor guidelines

---

## 🎯 Key Product Updates

### Grouped Main Navigation (NEW)
- **Three Groups** — Top nav buttons are organized into labeled groups: **Overview** (Health, Accounts, Income), **Manage** (Liabilities, Recurring, Savings, Plan), **Analyze** (Reports, Ledger, Reconcile)
- **Active Group Highlighting** — The group label dims/highlights based on whether the active page belongs to it
- **Hamburger Menu** — Collapsible navigation on tablets and mobile (≤768px)
- **Touch-Friendly** — 44x44px minimum button sizes on mobile
- **Auto-Close** — Menu collapses after page selection
- **Accessibility** — ARIA labels, `aria-current`, and keyboard navigation support

### Financial Health Dashboard (NEW)
- **Landing Page** — The "Health" tab (Overview group) is the app's default landing page
- **Debt-to-Income Ratio** — Status badge (Healthy / Moderate / High Risk) based on monthly debt payments vs. income
- **Savings Rate** — Status badge (Strong / Moderate / Low) based on monthly savings contributions vs. income
- **Emergency Fund Runway** — Months of expenses covered, with status badges from "Critical" to "Excellent"
- **At-a-Glance Metrics** — Pulls from accounts, debts, income, bills, expenses, and recurring templates without requiring a separate data entry step

### Account Reconciliation (NEW)
- **Reconcile Tab** — Compare an account's tracked balance against a real bank/card statement balance
- **Expected Transactions** — Lists ledger-derived transactions expected in the statement period so discrepancies are easy to trace
- **Adjustment Log** — Each reconciliation records previous balance, statement balance, difference, and an optional note
- **Reconciliation Mode (NEW)** — A global setting (changeable any time via the Settings modal — gear icon or command palette) controls whether a reconciliation **adjusts** the account's `startingBalance` going forward, or is **visible only** on the ledger without changing the tracked balance. A first-run setup wizard asks new users to choose once; existing users default to visible-only.
- **Reconciliations on the Ledger (NEW)** — Every reconciliation appears as a marker row on the unified Ledger, showing the previous → statement balance and the difference, for full transparency regardless of mode
- **Export/Import Ready** — Reconciliation history (`app.reconciliations`) and the settings array (`app.settings`) round-trip through JSON backup

### CSP-Compliant CSS Architecture (ENHANCED May 31, 2026)
- **No Unsafe-Inline CSS** — All styles extracted to `styles.css`
- **Strong CSP** — `style-src 'self'` only (no inline styles)
- **Utility Classes** — `.sr-only`, `.help-icon`, and display utilities (`.hidden`, `.visible`, `.flex-visible`)
- **Dynamic Classes** — All display toggles use classList API instead of inline styles
- **Breakpoints** — Desktop (>768px), Tablet (768px), Mobile (≤480px)
- **Dark Mode** — Full dark mode support with CSS variables

### Net Worth Tracking & Historical Snapshots (NEW)
- **Monthly Snapshots** — Automatically captured and manually capturable snapshots of assets, liabilities, and net worth
- **Trend Analytics** — 3/6/12 month net worth views in Reports with comparison charts
- **Snapshot Audit Table** — Date, assets, liabilities, net worth, income, and debt paid shown in a quick monthly history table
- **Motivation Milestones** — Celebration notifications at +$5K net worth growth increments from your first snapshot
- **Accounts Dashboard Widget** — Current net worth and change from the prior snapshot shown on Accounts page
- **Export/Import Ready** — Snapshot history and milestone state are included in JSON backup flow

### Cash Flow Forecast (NEW)
- **Selectable Horizon** — Project account balances 1, 2, 3, 6, or 12 months ahead
- **Total Cash Position or Per-Account** — View combined balances across all asset accounts (checking/savings/cash/investment) or drill into a single account
- **Summary Stats & Chart** — Current, lowest, and highest projected balances, plus a line chart that highlights the lowest (red) and highest (green) months and turns red for any negative balance
- **Notable Month Detection** — Months with outflow above a configurable threshold (default 130% of average) are flagged with their top spending drivers
- **Negative-Balance Warnings** — Banner alert when a projected month-end balance goes negative
- **Intra-Month Dip Detection (NEW)** — Surfaces mid-month cash crunches that month-end balances hide (e.g. rent due before a paycheck arrives):
  - Warning banner when a month dips negative mid-month but recovers by month-end, with the dip date/amount and recovery balance
  - "Lowest Projected" stat reflects the true intra-month low and its date, not just the lowest month-end balance
  - Table notes flag "Dips to $X on \<date\> before recovering" for any month with a mid-month low below its ending balance
- **Settings Persisted** — Horizon, account selection, and notable-month threshold are saved to localStorage and included in JSON export/import

### Debt Payoff Date Display (NEW)
- **Payoff Date on Every Debt Card** — Credit Card and Fixed Amount debts both show a "📅 Payoff Date" once a payment plan has been calculated on the Plan page
- **"Run a Plan to See" Hint** — Shown until a plan is calculated, consistent with the existing "Total Interest (projected)" hint

### Recurring Template "Mark as Paid This Month" (NEW)
- **Paid Status Toggle** — Mark a subscription, reimbursement, or transfer as paid for the current month with a single click
- **Distinct from Skip Month** — "Paid" confirms an occurrence that happened; "Skip" suppresses an occurrence that won't happen — both can be tracked independently
- **Automatic Monthly Reset** — Paid status is tracked per `'YYYY-MM'` month key (`paidMonths`), so each new month starts unmarked
- **Export/Import Ready** — `paidMonths` round-trips through JSON backup like `skippedMonths`

### Spending Analysis by Category (NEW)
- **Spending Tab in Reports** — a dedicated "🏷️ Spending" tab joins the existing Calendar, Income vs Expenses, Money Flow, What Changed, Net Worth, and Forecast tabs
- **Doughnut Pie Chart** — visual slice-by-slice breakdown of all outflows (expenses, bills, recurring subscriptions, debt minimums, savings contributions) for the selected month; click a slice to drill down
- **Ranked Category List** — categories sorted by total spend with month-over-month % change badges (↑/↓)
- **6-Month Stacked Bar Trend** — current month highlighted at full opacity; prior 5 months at reduced opacity; category union taken across all 6 months so no data is missing
- **Drill-Down Modal** — click any category row or pie slice to see the individual transactions (name, date, type icon, amount)

### Command Palette / Quick-Jump (NEW)
- **Ctrl+K (or Cmd+K)** — opens a searchable command palette from anywhere in the app; also reachable via the 🔍 toolbar button
- **Jump to Any Page** — fuzzy-filters across all 10 top-level pages plus common actions (export/import JSON, toggle dark mode, calculate payment plan)
- **Keyboard-First** — Arrow keys to move selection, Enter to activate, Escape to close and restore focus to whatever was focused before opening
- **Accessible** — `role="dialog"`/`role="listbox"`/`aria-activedescendant` semantics, with mouse-click and backdrop-click fallbacks

### Reduced Motion Support (NEW)
- **Respects OS Preference** — when `prefers-reduced-motion: reduce` is set, all CSS transitions/animations (confetti, toasts, accordion toggles, hover effects) collapse to near-instant
- **Chart.js Animations Disabled** — `Chart.defaults.animation` is turned off app-wide so every chart (gauges, pie/bar/line charts) renders without entrance or update animation under reduced motion

### Screen-Reader Chart Data Tables (NEW)
- **Text Equivalent for Every Chart** — Health gauges, Spending pie/bar charts, the Cash Flow Forecast line chart, and the Net Worth trend chart each get a visually-hidden (`.sr-only`) `<table>` with the same data, so screen-reader users aren't limited to a `<canvas>` with no accessible content
- **Kept in Sync** — tables are rebuilt on every chart re-render via a shared `renderChartDataTable()` helper in `utils.js`

### localStorage Quota Monitoring (NEW)
- **Soft Usage Warning** — every save estimates the serialized payload size against a conservative 5MB browser-storage estimate and shows a dismissible banner once usage crosses ~80%
- **Write-Failure Fallback** — if a write still fails (quota actually exceeded), the same banner explains the failure and recommends exporting a backup immediately
- **Self-Resetting** — the warning re-arms itself if usage drops back under the threshold and is crossed again later

### Enhanced Data Export (NEW)
- **Ledger CSV Export with Custom Columns** — an "⬇️ Export CSV" button on the Ledger page opens a column-picker modal (date, account, transaction name, amount, category, running balance, type); exports respect the ledger's current account/date-range filter and sort order, and the selected columns persist between sessions
- **Summary Report Tab** — a new "Summary" tab on the Reports page with a Monthly/Yearly toggle, showing cash flow, per-account balance changes, and net worth for the selected period
- **Print / Save as PDF** — a "🖨️ Print" button on every page (Health, Accounts, Income, Liabilities, Recurring, Savings, Plan, Reports, Ledger, Reconcile) triggers the browser's native print dialog (Save as PDF works there too); a `@media print` stylesheet hides navigation/controls/data-entry forms and prints only the active page's read-only content

---

## 🔐 Security & Compliance

### Content Security Policy (CSP)
The application enforces a strict CSP header:
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

> **Note**: `frame-ancestors 'none'` is enforced via the `X-Frame-Options: DENY` HTTP header (see below) and by adding `frame-ancestors 'none'` to the server-level CSP header in [DEPLOYMENT.md](DEPLOYMENT.md). The `frame-ancestors` directive is ignored in `<meta>` CSP tags per the spec.

### Security Headers
Production deployments include:
- `X-Content-Type-Options: nosniff` — Prevents MIME-sniffing attacks
- `X-Frame-Options: DENY` — Prevents clickjacking/iframe injection
- `Strict-Transport-Security` — HTTPS enforcement (production only)
- `Referrer-Policy: strict-origin-when-cross-origin` — Privacy-friendly referrer policy

---

## 🧪 Testing Suite (Updated June 20, 2026)

The test suite is organized by functional category for maximum cohesiveness and maintainability:

### Test Statistics
- **Total Tests**: 365 comprehensive tests, all passing
- **Test Files**: 45 organized across 5 categories
- **Coverage**: All major features + security + UI + accessibility, including positive and negative/edge-case paths for every sanitizer and calculation primitive
- **Framework**: pytest with Playwright browser automation

### Test Categories

#### 🔐 Security Tests (51 tests)
- **XSS Prevention** — Input sanitization across accounts, income, debts, recurring templates, sinking funds, reports calendar, ledger, health dashboard, reconciliation, spending
- **CSP Compliance** — Strict Content Security Policy enforcement
- **Input Validation** — Bounds checking, unicode handling, special characters
- **Static Analysis** — Code patterns, hardcoded secrets, dependencies

Run: `pytest tests/security/ -v`

#### 🎯 Feature Tests (184 tests)
- **Accounts** — CRUD operations, account types, balance calculations, graceful orphaning of items linked to a deleted account
- **Debts** — Liability management, interest calculation, amortization schedules, negative fixed-amount-payment rejection
- **Debt Calculator** — Pure calculation engine: strategies (incl. multi-debt priority-lowest/highest ordering), daily compounding, target-date back-calculator, fixedAmount date-window boundaries, stimulus edge cases
- **Strategy/Payment Plan** — Switching between Avalanche/Snowball/Priority strategies, strategy comparison panel, per-month stimulus input (valid + non-numeric fallback)
- **Income** — Multiple income sources, frequency types, total calculations, negative income/bonus amount rejection on both add and inline-edit paths
- **Expenses** — Add/edit/delete via UI, amount/date validation (empty, negative, zero, malformed), category totals
- **Bills** — Data model, sanitization, and calculation integration (no add/edit UI — see Known Gap note)
- **Recurring** — Templates across all frequencies, pause/resume persistence, skip-month, account linkage, amount/date validation
- **Ledger** — Transaction history, filtering, amount-override modal (apply, persist across reload, no key collisions)
- **Reports** — Income vs expenses, money flow, net worth analytics, grouped report tabs, empty-state/year-boundary date handling, variance deltas
- **Savings** — Emergency funds, sinking funds, persistence
- **Net Worth** — Multi-asset calculations, historical snapshots, milestones
- **Financial Health** — Debt-to-income, savings rate, emergency fund coverage, payoff timeline, cash flow, budget allocation
- **Cash Flow Forecast** — Horizon/account selection, notable months & drivers, negative-balance warnings, intra-month dip detection
- **Account Reconciliation** — Statement balance adjustments, expected-transaction matching
- **Spending Analysis** — Category breakdowns, month-over-month trends
- **Storage Import** — Direct unit tests of the `utils.js` sanitizer primitives, adversarial/negative-input import tests for every record-type sanitizer (net worth snapshots, forecast settings, emergency/sinking funds, bonuses, ledger overrides), legacy v1.0 format support
- **Main Nav Groups** — Grouped navigation structure (Overview/Manage/Analyze)
- **localStorage Quota Monitoring** — Soft warning banner above the ~80% estimated-quota threshold, dismissibility, no-duplicate-banner on repeated saves, and re-arming after dropping back under threshold

Run: `pytest tests/features/ -v`

#### 🎨 UI/UX Tests (111 tests)
- **Mobile Responsiveness** — Hamburger menu, viewport handling, touch sizing
- **Modal Functionality** — Visibility toggling, close buttons, amortization displays
- **Dark Mode** — Theme switching, color contrast, persistence, corrupted-localStorage fallback
- **CSS Loading** — External stylesheet, utility classes, responsive breakpoints
- **Accessibility** — Keyboard navigation, ARIA labels, semantic HTML, Results tab bar (`.results-tab-btn`/`.results-tab-panel`) tablist semantics
- **Guide Theme** — `guide.html` dark/light mode sync with the main app's saved theme preference (`tests/ui/test_guide_theme.py`)
- **Charts** — Chart.js instance destroy-before-recreate on repeated re-render (balance, health DTI, net worth trend, forecast)
- **Main Nav** — Grouped nav active-state highlighting and keyboard reachability
- **Reports Nav / Actions** — Tab bar grouping, sticky positioning, dark mode, tab-switching panel visibility
- **Debt/Recurring/Reconciliation Actions** — Inline edit, mark-paid, reconcile-modal flows
- **Spending UI** — Pie/bar charts, ranked list, drill-down modal
- **Command Palette** — Ctrl+K / toolbar open, filtering, empty-state, arrow-key navigation, Enter-to-navigate, Escape/backdrop close with focus restoration, action commands (theme toggle)
- **Reduced Motion** — CSS transition-duration collapse and `Chart.defaults.animation` disabled under `prefers-reduced-motion: reduce`; left enabled otherwise
- **Chart Accessibility** — `.sr-only` data-table fallback present (with caption + rows) for health gauges, spending pie/bar, forecast, and net worth trend charts

Run: `pytest tests/ui/ -v`

#### ♿ Accessibility Audit (8 tests)
- **Site-wide sweep** (`tests/a11y/`) — Dangling ARIA references, duplicate IDs, orphaned form inputs, unnamed interactive elements, missing image alt text, and computed WCAG 1.4.3 color contrast across all 10 pages in light + dark mode + guide.html, plus modal Escape-to-close and mobile nav `aria-expanded` behavior. Wraps the standalone `run_a11y_audit.py` script so regressions are caught by `pytest tests/`, not just on manual runs. Complements (does not duplicate) `tests/ui/test_accessibility.py`'s 28 targeted checks.

Run: `pytest tests/a11y/ -v`

#### 🔄 Integration Tests (11 tests)
- **End-to-End Workflows** — Complete user journeys (account → debt → net worth)
- **Data Persistence** — Cross-navigation data integrity
- **Import/Export** — JSON roundtrip validation, file handling, CSV schedule export (incl. comma/quote escaping in debt names), full clear-all-data → reimport → render-every-page consistency check

Run: `pytest tests/integration/ -v`

### Quick Test Commands

```bash
# Run all tests
pytest tests/ -v

# Run by category
pytest tests/security/ -v         # 51 security tests
pytest tests/features/ -v         # 184 feature tests
pytest tests/ui/ -v               # 111 UI/UX tests
pytest tests/a11y/ -v             # 8 accessibility audit tests
pytest tests/integration/ -v      # 11 integration tests

# Run with markers
pytest -m "security" -v           # All security tests
pytest -m "feature" -v            # All feature tests
pytest -m "ui" -v                 # All UI tests
pytest -m "a11y" -v               # All accessibility audit tests
pytest -m "integration" -v        # All integration tests
pytest -m "not slow" -v           # Skip slow tests

# Generate coverage report
pytest --cov=. --cov-report=html
```

### Test Organization

```
tests/
├── conftest.py              # Shared fixtures, test data, helpers
├── README.md                # Comprehensive test documentation
├── security/                # Security & compliance tests (4 files)
├── features/                # Feature-specific tests (21 files)
├── ui/                      # UI/UX & responsive tests (17 files)
├── a11y/                    # Site-wide accessibility audit (1 file + standalone script)
├── integration/             # End-to-end tests (2 files)
└── debug/                   # Legacy debug files (archived)
```

### For Developers

See [tests/README.md](tests/README.md) for:
- Prerequisites and installation
- Detailed test organization
- Fixture reference and usage examples
- Coverage matrix (feature-to-test mapping)
- Common test patterns and best practices
- Troubleshooting guide
- Contributing guidelines

### Security Scan Results (June 19, 2026)

Static security analysis:
- **HIGH severity issues**: 0 ✅
- **MEDIUM severity issues**: 0 ✅
- **LOW severity findings**: 12 (all properly handled) ✅

Run: `pytest tests/security/ -v` for current security test results

---

## 🏗️ Architecture

### Technology Stack
- **Frontend**: Vanilla ES6+ JavaScript (no frameworks)
- **Storage**: Browser localStorage only
- **Charts**: Chart.js via CDN
- **Styling**: Responsive CSS3 with mobile-first design
- **Deployment**: Static files (any web server or Docker/nginx)

### Core Modules

```
index.html              Main page shell + responsive navigation
guide.html              In-app usage guide (opened by Help button)
guide.css               Styles for guide.html (externalized for CSP compliance)
styles.css              Responsive styles + dark mode + utilities
styles-csp-classes.css  CSP-compliant utility classes (dynamic styles via CSS variables)
src/
  ├─ app.js             Main controller & app state
  ├─ ui.js              Event listeners & page navigation
  ├─ strategy.js        Debt payoff calculation engine
  ├─ debts.js           Debt management
  ├─ accounts.js        Account management
  ├─ income.js          Income tracking
  ├─ bills.js           Bills & expense budgeting (data model only — see note below)
  ├─ recurring.js       Recurring transaction templates
  ├─ savings.js         Emergency fund & sinking fund tracking
  ├─ ledger.js          Transaction ledger & amount overrides
  ├─ reconciliation.js  Account statement reconciliation
  ├─ health.js          Financial health dashboard (DTI, savings rate, emergency runway)
  ├─ spending.js        Spending analysis (category breakdowns, trends)
  ├─ reports.js         Reports & calendar view
  ├─ forecast.js        Cash Flow Forecast (Reports tab)
  ├─ charts.js          Chart rendering
  ├─ storage.js         Persistence & import/export
  ├─ debtCalculator.js  Pure calculation engine (no side effects)
  ├─ guideTheme.js      Applies saved dark-mode theme to guide.html
  └─ utils.js           Shared utilities & formatters
```

> **Known gap:** The standalone Bills UI (`#billForm`/`#billList`) was removed in favor of Recurring Templates, but `bills.js` still defines the full bills data model and calculation logic — `app.bills` is read by `accounts.js`, `health.js`, `ledger.js`, and `strategy.js`, and round-trips through import/export, so existing bills data continues to work. There is currently no reachable UI to add or edit a bill. See `ROADMAP.md`'s Bill Payment Tracker entry for context.

### Design Principles
- **Client-Side Only** — No server dependencies
- **LocalStorage-Based** — All data persists locally
- **Modular Architecture** — Independent feature modules
- **Pure Functions** — Calculation engine has no side effects
- **Responsive Design** — Works on desktop, tablet, mobile
- **Accessibility** — ARIA labels, keyboard navigation, screen reader support
- **Security First** — Input validation, XSS prevention, CSP enforcement

### Browser Compatibility
- Chrome/Chromium 60+
- Firefox 55+
- Safari 12+
- Edge 79+
- ES6+ JavaScript required
- localStorage required

---

## 📋 Features
- **Dedicated HTML guide page** — the in-app help button opens `guide.html` in a new tab
- **Theme-matched styling** — guide visuals follow the app look and dark mode preference
- **Fixed back link** — a persistent **Back to Application** link at the top-left returns to the main app

### Ledger Filters & Contents
- **Account filter** — filter transactions by account
- **Date range filter** — filter transactions to show (default: **Next 30 Days**):
  - All
  - Past & Today Only
  - Next 30 Days
  - Through Next Month
  - Next 60 Days
  - Next 90 Days
  - Hide or show future transactions
- **Includes all transaction types** — The Ledger tab provides a running table of all account transactions, including **income, one-time entries (bonuses/deposits), debts, expenses, and recurring templates**, with filters for account and date range (including future transactions and custom ranges like 30/60/90 days or through next month). All date filtering uses precise date-only comparisons to ensure accurate transaction display.
- **Amount overrides (modal-based)** — each non-rollover transaction in the **Amount** column supports **Override / Edit override / Reset** using an in-app modal dialog (no browser prompt). Overrides preserve the original amount for history and display both values in the ledger row.
- **Automatic recalculation after override** — changing a transaction amount recalculates account running balances and updates Reports totals/charts and account projections immediately.

### Debt Management
- **Add unlimited debts** — credit cards (revolving balance with APR) or fixed-amount recurring payments (subscriptions, rent, instalments)
- **Single-page add & manage** — the Debts page shows the add form and the debt list side by side; no page switching needed
- **Inline editing** — click Edit on any debt card to populate the form for editing; the list updates immediately on save
- **Update Balance** — quickly record a new balance for any credit-card debt while preserving the original balance for progress tracking
- **Category labels** — tag debts (e.g. "Housing", "Credit Card") and filter the list by category
- **Priority levels** — assign a 1–100 priority to each debt for custom strategy ordering

### Account Management
- **Add accounts** — define checking, savings, cash, investment, credit card, loan, or other accounts with a name, type, and starting balance
- **Link to accounts** — assign income sources, one-time entries (bonuses/deposits), debts, recurring templates, and expense budgets to specific accounts
- **Projected monthly balance** — each account card shows a projected end-of-month balance: starting balance ± all linked income, debt payments, recurring transactions, and expenses for the current month, including any ledger amount overrides
- **Money Flow report** — the Reports › Money Flow tab includes a per-account balance table alongside the cumulative cash-flow chart
- **Export / Import** — accounts are included in the JSON backup (version 4.0.0 format)

### Income Tracking
- **Add income sources** — name, amount per paycheck, first pay date, and frequency (bi-weekly or monthly)
- **Add one-time entries** — record irregular deposits using the one-time area (bonus, tax refund, cash deposit, check deposit, or other)
- **Automatic pay-schedule projection** — the app walks each source's pay cadence forward from its first pay date to calculate how many paydays fall in the current month
- **Monthly income summary** — shows expected income this month, regular pay, one-time entries, and estimated annual total
- **Debt-to-income ratio** — the Strategy page shows what percentage of your expected monthly income your planned payment represents, with a warning if it exceeds 40%

### Budget Tracking (Expenses)
- **Expense budgets** — set monthly spending targets for variable categories (groceries, dining, health, entertainment, clothing, personal care, education, childcare); each expense tracks the date it was incurred for calendar and ledger integration
- **Expense date tracking** — expenses are captured with specific dates, allowing them to appear in the calendar view alongside income and recurring items for a complete monthly overview
- **Inline editing** — edit any expense budget directly in the list without a separate form
- **Persisted to storage** — expenses are saved to `localStorage` and included in JSON export / import

### Recurring Transaction Templates
- **Support non-debt recurring items** — subscriptions, reimbursements, and transfers with flexible frequency (weekly, bi-weekly, monthly, quarterly, yearly)
- **Start and end dates** — constrain recurring templates to specific date ranges
- **Pause & skip controls** — temporarily pause a template or skip individual months without deleting
- **Three types** — Subscription (outflow), Reimbursement (inflow), Transfer (debit one account, credit another)
- **Integrated with ledger** — recurring templates automatically generate projected transactions in the ledger and appear in all Reports views
- **Monthly totals** — quickly see total recurring costs or income for the current month
- **Account linking** — link recurring items to source/destination accounts for accurate account projections

### Savings (Emergency Fund & Sinking Funds)
- **Emergency Fund** — track a dedicated emergency fund per account with target amount, current savings, monthly contribution, and auto-contribution toggle
- **Progress visualization** — completion percentage badges and progress bars showing how close you are to your emergency fund target
- **Sinking Funds (Goal-Based Budgets)** — create multiple named savings goals with three flexible allocation methods:
  - **Fixed Monthly Amount** — save a set amount each month
  - **Annual Cost ÷ 12** — provide annual cost and save equal monthly installments automatically
  - **Target Date Planning** — specify target amount and date; the app calculates the required monthly allocation
- **Auto-contribute** — toggle automatic monthly contributions for emergency funds and sinking funds; auto-contributions appear as dedicated outflows in the Ledger and Reports
- **Current vs. Target tracking** — each savings goal displays current amount, target amount, and projected completion date
- **Integrated with Reports** — Emergency Fund and Sinking Fund contributions appear as dedicated line items in:
  - **Income vs. Expenses report** — shows total savings contributions alongside other outflows
  - **Money Flow chart** — savings outflows included in cumulative cash flow
  - **Variance Dashboard** — month-to-month comparison of savings contributions
  - **Account projections** — auto-contributed amounts factor into projected end-of-month account balances

### Calculation Engine
- **Daily compounding interest** — matches real credit-card billing cycles:
  ```
  monthlyInterest = balance × ((1 + APR/365)^daysInMonth − 1)
  ```
- **Four payment strategies** — Avalanche, Snowball, Priority-Lowest, Priority-Highest
- **Per-month stimulus** — add a one-time extra payment for any month in the schedule table; the plan recalculates instantly
- **Negative-amortisation warning** — a badge flags any debt where the minimum payment is too low to cover the monthly interest

### Results & Analysis
- **Monthly schedule table** — rows = months, columns = debts + Stimulus + Total Paid, editable stimulus inputs per row
- **Debt summary table** — per-debt totals for principal paid, interest paid, payoff date, and a snowball/avalanche progress bar
- **Strategy comparison panel** — runs all four strategies and shows how much interest and time each saves relative to your current choice
- **What-If simulator** — drag a slider to add extra monthly payment and instantly see months saved / interest saved
- **Target Payoff Date calculator** — enter a desired payoff date; a binary-search algorithm back-calculates the required monthly payment

### Charts (Chart.js)
- **Payoff Timeline** — one line per debt showing projected balance declining to zero
- **Cumulative Progress** — three lines: Total Paid, Principal Paid, Interest Paid (running totals)
- **Principal vs. Interest doughnut** — visualises how much of your total outlay is interest
- **Debt Balance Distribution pie** — shows how your current balances are split across all debts
- **Monthly Debt-to-Income pie** — shows your monthly debt payment vs. remaining income (requires income sources)

### Calendar & Reports
- **Month-by-month calendar** — paginated calendar with income paydays, recurring template occurrences, expenses, debt payments, and bonuses pinned to their dates
- **Tap-to-open day detail (NEW)** — day cells stay compact (a count of small colored dots, one per event type) at every screen width; click/tap a day, or focus it and press Enter/Space, to open a modal with the full event list (icon, name, amount)
- **Reports sections** — Income vs. Expenses chart showing income, recurring costs, and debt minimums; Money Flow chart tracking cumulative income/outflow/net day-by-day through the month; Variance Dashboard comparing this month vs last month with clear deltas for income, expenses, recurring costs, and debt; account balance projections for each account
- **Recurring integration** — all recurring template transactions are fully integrated into calendar events, income vs. expenses breakdown, and money flow calculations
- **Variance Dashboard** — "What Changed" tab comparing current month vs previous month with color-coded deltas for income, expenses, recurring costs, debt minimums, and net available funds; quickly identify spending patterns and budget trends
- **Net Worth tab** — dedicated reporting view with: historical net worth trend, liabilities comparison, asset growth vs debt reduction chart, snapshot history audit table, 3/6/12 month range selector, and manual snapshot capture
- **🔮 Forecast tab** — projects account balances 1/2/3/6/12 months ahead for "Total Cash Position" or any individual account, with summary stats, a chart, notable-month outflow drivers, negative-balance warnings, and intra-month dip detection that flags mid-month cash crunches even when a month ends positive

### Interest Paid to Date
- Record the date you opened each credit-card debt (`debtStartDate`)
- The app estimates the interest you have already paid using daily compounding on the original balance, minus the principal you have paid down
- Shown on each debt card, in the summary table, and persisted to localStorage

### Data Management
- **Persistent storage** — debts, income, stimulus data, monthly payment, strategy, recurring templates, net worth snapshots, milestone markers, and ledger amount overrides are auto-saved to `localStorage`
- **Export (JSON)** — one-click full backup from the header toolbar; downloads debts, income sources, strategy settings, recurring templates, net worth snapshots, milestone markers, and ledger amount overrides as a single `.json` file
- **Import (JSON)** — restore from any previously exported backup; choose **Replace** (full restore) or **Merge** (append debts, always restores income & strategy)
- **Export to CSV** — full payment schedule plus per-debt summary in one spreadsheet-ready file
- **Clear All Data** — wipe everything and start fresh

---

## How to Use

### Open the usage guide

Click the **❓ Help** button in the header toolbar to open the full usage guide in a separate tab. The guide lives at `guide.html` and includes a fixed **Back to Application** link that returns you to `index.html`.

### 1 — Add your debts

Navigate to **Debts**. The page has a two-column layout: the **Add Debt form** stays pinned on the left, and your **debt list** fills the right. You can add, view, and edit all your debts without ever leaving the page.

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

Click **Add Debt**. The new debt appears immediately in the list on the right. Repeat for every debt. Use the **Edit** button on any debt card to populate the form with that debt's values for inline editing.

### 2 — Set up your accounts (optional)

Navigate to **Accounts**. Define the bank accounts, wallets, or credit cards your money flows through.

| Field | Notes |
|-------|-------|
| Account Name | A label, e.g. "Chase Checking" |
| Account Type | Checking / Savings / Cash / Investment / Credit Card / Loan / Other |
| Starting Balance | Current balance of the account |

Click **Add Account**. Each account card shows the starting balance and a **projected end-of-month balance** that factors in all linked income, one-time entries (bonuses/deposits), debt payments, bills, and expense budgets. When adding income sources, one-time entries, debts, bills, or expenses you can optionally link them to one of your accounts.

### 3 — Set your strategy and view results

Navigate to **Plan**.

1. Enter your **Total Monthly Payment** — the total you can put toward all debts each month.
2. Choose a **Payment Strategy** (see below).
3. Optionally expand **🎯 Back-calculate from a target payoff date** and click *Calculate* to find the required monthly payment for a specific deadline.
4. Click **Calculate Payment Plan**.

The results appear immediately below the controls on the same page, split into three tabs:

| Tab | Contents |
|-----|----------|
| **📊 Overview** | Strategy comparison panel; What-If extra-payment simulator |
| **📋 Debt Summary** | Sortable per-debt table (min due, interest rate, principal/interest paid, payoff date, progress bar); per-debt amortization schedule (modal) |
| **📅 Schedule** | Three sub-tabs — **Tabular** (monthly payment schedule with editable stimulus column), **Calendar** (month-by-month calendar with bill and payment events), **Chart** (payoff timeline, cumulative progress, principal vs. interest doughnut, balance distribution, debt-to-income) |

Click **Clear All Data** to reset everything and hide the results.

### 4 — Track your income

Navigate to **Income**.

| Field | Notes |
|-------|-------|
| Name | Label for this source, e.g. "Main Job" |
| Amount per Paycheck | The amount received each pay period (gross or net) |
| First Pay Date | The date of the first (or next) payday for this source |
| Frequency | **Every other week** (bi-weekly, 26 pays/year) or **Once per month** (12 pays/year) |

Click **Add Income**. Add one row per income source.

The page shows a summary of how much income is expected in the **current calendar month** (the app projects each source's schedule from its first pay date). The **Strategy** page also shows a debt-to-income ratio widget whenever income sources exist, plus a net cashflow row when bills or expense budgets have been entered.

Use the one-time entry section on the Income page to add irregular deposits such as bonuses, tax refunds, cash deposits, or check deposits. These entries can be linked to an account and are included in monthly income calculations.

### 5 — Track your budget

Navigate to **Budget**.

**Bills** (left column) — recurring fixed costs billed monthly:

| Field | Notes |
|-------|-------|
| Name | e.g. "Electricity", "Netflix" |
| Monthly Amount | What you pay each month |
| Due Day | Day of month the bill is due (optional) |
| Category | Utilities / Internet·Phone / Insurance / Subscription / Rent·Mortgage / Transport / Other |

**Expense Budgets** (right column) — variable monthly spending targets:

| Field | Notes |
|-------|-------|
| Name | e.g. "Groceries", "Gym" |
| Cost | The amount spent |
| Date | The date the expense was incurred (tracked for calendar and ledger integration) |
| Category | Food·Groceries / Dining Out / Health·Fitness / Entertainment / Clothing / Personal Care / Education / Childcare / Costco / Target / Reconciliation / Other |

The **Cash Flow Summary** panel at the bottom automatically updates as you add items, showing:

```
Income (this month)
  − Debt minimums
  − Bills
  − Budgeted expenses
= Net remaining
```

### 6 — Export / Import

The **⬇ Export** and **⬆ Import** buttons sit in the top-right corner of every page, next to the dark-mode toggle.

**Export (JSON)** — click *⬇ Export* to download a complete backup of everything:

```json
{
  "version": "4.0.0",
  "exportedAt": "2026-05-26T12:00:00.000Z",
  "accounts": [ { "id": 1, "name": "Chase Checking", "type": "Checking", "startingBalance": 2500 } ],
  "debts":    [ { "id": 1, "name": "Visa", "accountBalance": 4200, "accountId": 1, ... } ],
  "incomes":  [ { "id": 1, "name": "Main Job", "amount": 2000, "accountId": 1, ... } ],
  "bills":    [ { "id": 2, "name": "Electricity", "amount": 120, "dueDay": 15, "category": "Utilities", "accountId": 1 } ],
  "expenses": [ { "id": 3, "name": "Groceries", "budgetAmount": 400, "category": "Food & Groceries", "accountId": 1 } ],
  "ledgerAmountOverrides": {
    "bill|2|1|2026-06-15": {
      "amount": -95,
      "originalAmount": -120,
      "transactionName": "Electricity"
    }
  },
  "strategy": { "monthlyPayment": 800, "paymentStrategy": "avalanche" }
}
```

**Import (JSON)** — click *⬆ Import* and select a previously exported file. You will be prompted to choose:

| Choice | Behaviour |
|--------|-----------|
| **OK (Replace)** | Everything is replaced by the file contents (debts, income, bills, expenses, strategy, and ledger overrides) |
| **Cancel (Merge)** | Imported debts are appended (duplicates by name are skipped); income, bills, expenses, strategy settings, and ledger overrides are restored from the file |

> Legacy v1.0 files (debts only) are also accepted.

---

## Payment Strategies Explained

| Strategy | Order | Best for |
|----------|-------|----------|
| **Avalanche** | Highest APR first | Minimising total interest paid |
| **Snowball** | Lowest balance first | Psychological momentum |
| **Priority – Low first** | Lowest priority number first | Custom ordering (manually deprioritise debts) |
| **Priority – High first** | Highest priority number first | Tackling the most important debt first |

The **Strategy Comparison** panel on the Results page always shows how your chosen strategy compares to all others so you can make an informed decision.

---

## Target Payoff Date (Back-Calculator)

Enter a target date in the **Strategy** section. The app uses a binary-search algorithm (up to 60 iterations) to find the smallest monthly payment that pays off all debts by that date.

---

## 📚 Technical Details

### File Structure

```
index.html                  — Main page with responsive nav + security headers
guide.html                  — In-app usage guide (opened by Help button)
guide.css                   — Styles for guide.html (externalized for CSP compliance)
styles.css                  — Responsive styles + dark mode + utilities + mobile menu
styles-csp-classes.css      — CSP-compliant utility classes + dynamic CSS variable rules
src/
  ├─ app.js                — Main app controller & state management
  ├─ ui.js                 — Event listeners, navigation, mobile menu toggle
  ├─ strategy.js           — Debt payoff calculations & results rendering
  ├─ debts.js              — Debt management (CRUD & inline editing)
  ├─ accounts.js           — Account management & projections
  ├─ income.js             — Income sources & one-time entries
  ├─ bills.js              — Bills & expense budgets (bills: data model only, no UI — see note above)
  ├─ recurring.js          — Recurring transaction templates
  ├─ savings.js            — Emergency fund & sinking fund tracking
  ├─ ledger.js             — Transaction ledger with amount overrides
  ├─ reconciliation.js     — Account statement reconciliation
  ├─ health.js             — Financial health dashboard (DTI, savings rate, emergency runway)
  ├─ spending.js           — Spending analysis (category breakdowns, trends)
  ├─ reports.js            — Reports & calendar views
  ├─ forecast.js           — Cash Flow Forecast (Reports tab)
  ├─ charts.js             — Chart rendering & lifecycle
  ├─ storage.js            — Persistence, import/export, data validation
  ├─ debtCalculator.js     — Pure calculation engine
  ├─ guideTheme.js         — Applies saved dark-mode theme to guide.html
  └─ utils.js              — Formatting, date utilities, sanitization
tests/ (344 tests across 5 categories)
  ├─ conftest.py              — Shared fixtures & utilities
  ├─ README.md                — Comprehensive test documentation
  ├─ security/                — 51 security & compliance tests
  │   ├─ test_xss.py, test_csp.py
  │   ├─ test_input_validation.py, test_static_scan.py
  ├─ features/                — 179 feature-specific tests
  │   ├─ test_accounts.py, test_debts.py, test_income.py, test_bills.py
  │   ├─ test_expenses.py, test_recurring.py, test_recurring_occurrences.py
  │   ├─ test_ledger.py, test_reports.py, test_savings.py, test_networth.py
  │   ├─ test_health.py, test_forecast.py, test_reconciliation.py
  │   ├─ test_spending_analysis.py, test_storage_import.py, test_debt_calculator.py
  │   ├─ test_strategy.py, test_main_nav_groups.py, test_reports_nav_groups.py
  ├─ ui/                      — 95 UI/UX & responsive tests
  │   ├─ test_mobile.py, test_modals.py, test_dark_mode.py
  │   ├─ test_css_load.py, test_accessibility.py, test_main_nav.py
  │   ├─ test_charts.py, test_guide_theme.py
  │   ├─ test_debt_actions.py, test_recurring_actions.py, test_reports_actions.py
  │   ├─ test_reports_nav.py, test_reconciliation_actions.py, test_spending_ui.py
  ├─ a11y/                    — 8 site-wide accessibility audit tests
  │   └─ test_a11y_audit.py, run_a11y_audit.py
  ├─ integration/              — 11 end-to-end workflow tests
  │   ├─ test_smoke.py, test_workflows.py
  └─ (debug scripts relocated to tools/debug/ — not part of the pytest suite)
tools/
  └─ debug/                   — Ad-hoc manual debugging scripts (no test_* functions; run directly with python, not pytest)
```

### Documentation Files

- **README.md** — You are here
- **ROADMAP.md** — Planned features, known gaps, and audit-driven technical debt tracking
- **SECURITY.md** — Security practices, deployment headers, vulnerability reporting
- **docs/audit/security/** — Security audit reports with findings & recommendations
- **docs/audit/a11y/** — Site-wide accessibility audit reports
- **docs/audit/test/** — Test suite audit/coverage reports
- **DEPLOYMENT.md** — Production deployment guides for Nginx, Apache, Docker
- **docs/implementation/IMPLEMENTATION_SUMMARY.md** — Security enhancement documentation
- **guide.html** — In-app user guide

### Key Technologies

- **Frontend Framework**: Vanilla ES6+ JavaScript (no dependencies)
- **Storage**: Browser localStorage (same-origin isolated)
- **Charts**: Chart.js 4.4.3 via CDN
- **Build**: No build step required (static files)
- **Testing**: Playwright (browser automation)

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

#### Back-Calculator (Binary Search)
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
- `normalizeText()` — Removes dangerous characters
- `sanitizeFiniteNumber()` — Validates numbers with bounds
- `sanitizeInteger()` — Integer validation
- `sanitizeDateISO()` — Strict date format validation (YYYY-MM-DD)
- `escapeHtml()` — HTML entity encoding for output

#### Import/Export Security
- Maximum file size: 2 MB
- JSON validation with try-catch
- Complete re-sanitization after import
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

> **Note**: The meta tag omits `frame-ancestors 'none'` (browsers ignore it there per spec). Server deployments in [DEPLOYMENT.md](DEPLOYMENT.md) add it via the HTTP CSP header alongside `X-Frame-Options: DENY`.

---

## 💾 Data Privacy & Security

### Your Data Stays Private
- ✅ All calculations run entirely in your browser
- ✅ No data is sent to any server
- ✅ No accounts, no tracking, no analytics
- ✅ Data is stored only in your browser's `localStorage`
- ✅ Encrypted by browser (same-origin isolation enforced by browser security model)

### Data Backup Strategy
- **Regular Exports** — Use **⬇ Export** button to download JSON backup
- **Secure Storage** — Keep backups in secure personal storage
- **Multiple Copies** — Maintain copies on different devices
- **Version Control** — Backups include version number for compatibility

### Import Safety
- **Malicious JSON Detection** — Comprehensive validation prevents injection
- **File Size Limits** — 2 MB maximum prevents memory exhaustion
- **Data Re-sanitization** — All imported data is validated and sanitized
- **Merge vs. Replace** — Choose whether to append or replace existing data

---

## 🧪 Testing

### Automated Test Suite

**Run all tests:**
```bash
pytest tests/ -v                  # All 140 tests
pytest tests/security/ -v         # Security & CSP tests
pytest tests/features/ -v         # Feature tests
pytest tests/ui/ -v               # UI/UX & accessibility tests
pytest tests/integration/ -v      # End-to-end workflow tests
```

**Test Coverage:**
- ✅ XSS attack prevention
- ✅ Input validation & bounds checking
- ✅ Data persistence & restoration
- ✅ File import sanitization
- ✅ Mobile menu functionality
- ✅ CSS responsive breakpoints
- ✅ No console errors

### Security Test Categories

1. **XSS Protection** — HTML/script tag injection prevention
2. **Input Validation** — Special characters, numeric bounds
3. **Data Persistence** — localStorage integrity & JSON format
4. **File Import** — Malicious JSON handling & size limits
5. **Accessibility** — ARIA attributes, keyboard navigation

---

## 📱 Browser Support & Requirements

| Browser | Version | Support |
|---------|---------|---------|
| Chrome | 60+ | ✅ Full |
| Firefox | 55+ | ✅ Full |
| Safari | 12+ | ✅ Full |
| Edge | 79+ | ✅ Full |
| IE 11 | — | ❌ Not supported |

### Required Features
- ES6+ JavaScript support
- localStorage enabled
- CSS Grid & Flexbox
- CSS custom properties (variables)

---

## 🚀 Deployment

### Quick Start (Development)
```bash
python -m http.server 5500
# Visit http://localhost:5500
```

### Production Deployment

**Recommended Setup:**
- Web server: Nginx or Apache
- HTTPS: Required with valid SSL certificate
- Security headers: See [DEPLOYMENT.md](DEPLOYMENT.md)
- Caching: Static asset caching configured
- Monitoring: Set up error tracking

**For detailed deployment instructions:**
- See [DEPLOYMENT.md](DEPLOYMENT.md) for Nginx, Apache, Docker configurations
- See [SECURITY.md](SECURITY.md) for security header implementation

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
> Your minimum payment is too low to cover monthly interest. Increase the payment or reduce the APR (e.g., balance transfer).

**Mobile menu isn't working.**
> Check that JavaScript is enabled and no CSP violations appear in browser console.

**Data isn't persisting between refreshes.**
> Verify localStorage is enabled. Check browser's Storage settings (Safari may require explicit permission).

---

## 📞 Support & Contributions

### Security Issues
If you discover a security vulnerability:
1. **Do not** create a public GitHub issue
2. Contact the repository owner privately
3. **Include** steps to reproduce + impact assessment
4. See [SECURITY.md](SECURITY.md) for more details

### Bug Reports
- Open an issue with steps to reproduce
- Include browser version and operating system
- Run tests and include output

### Contributions
- All changes should pass security tests
- Add tests for new features
- Follow the existing code style
- See [SECURITY.md](SECURITY.md) for security guidelines

### Future Considerations
- See [ROADMAP.md](ROADMAP.md) for planned features and improvements

---

**Start your journey to being debt-free today!** 💰

---

*MyFinances v3.9.0 — Updated June 20, 2026*