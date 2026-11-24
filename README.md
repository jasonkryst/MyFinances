# MyFinances

[![CI](https://github.com/jasonkryst/MyFinances/actions/workflows/ci.yml/badge.svg)](https://github.com/jasonkryst/MyFinances/actions/workflows/ci.yml)
[![CodeQL](https://github.com/jasonkryst/MyFinances/actions/workflows/codeql.yml/badge.svg)](https://github.com/jasonkryst/MyFinances/actions/workflows/codeql.yml)
[![Copilot](https://github.com/jasonkryst/MyFinances/actions/workflows/agents/copilot-pull-request-reviewer/badge.svg)](https://github.com/jasonkryst/MyFinances/actions/workflows/agents/copilot-pull-request-reviewer)
[![Docker Release](https://github.com/jasonkryst/MyFinances/actions/workflows/docker-image.yml/badge.svg)](https://github.com/jasonkryst/MyFinances/actions/workflows/docker-image.yml)

_A modern, privacy-first web app to track accounts, debts, income, and spending, helping you plan and visualize your path to financial freedom._

Self-hosted: your data lives in your own PostgreSQL server. MyFinances runs as a small Docker stack (nginx + Node.js API + PostgreSQL) that you deploy yourself (see [DEPLOYMENT.md](DEPLOYMENT.md)); the calculations run in your browser, and your data syncs across every device you sign in from. Since 7.0.0 the server is required: browser-only storage was removed.

**Security Status**: ✅ Production-Ready | **Risk Level**: LOW | **Audit Date**: November 4, 2026 (v7.0.0, [report](docs/audit/security/SECURITY_AUDIT_2026-11-04.md)) | **Last Scan**: 0 HIGH, 0 MEDIUM; CodeQL 0 open alerts

---

## 🚀 Quick Start

```bash
# Run the stack (nginx + API + PostgreSQL); first time: ./setup.sh or .\setup.ps1
docker compose up -d        # Build and run at http://localhost:32900
docker compose down         # Stop

# Frontend development: bind-mount the working tree so edits need only a refresh
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d

# Open browser and sign in (or create the account on first run)
http://localhost:32900

# Run tests (needs the running stack; set TEST_EMAIL/TEST_PASSWORD for its user;
# tests WIPE the server's data, so never point them at real data)
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
- ✅ **Self-Hosted Data** — Your data goes only to the server you deploy; nothing is sent to third parties
- ✅ **XSS Prevention** — All user input sanitized and HTML-encoded via `escapeHtml()`
- ✅ **Strong CSP** — `script-src 'self' https://cdn.jsdelivr.net`, `style-src 'self'` — no inline scripts or styles (plus `googletagmanager.com`/`google-analytics.com`, allow-listed for the opt-in analytics feature below but never contacted unless you configure it)
- ✅ **Security Headers** — X-Content-Type-Options, X-Frame-Options, frame-ancestors protection
- ✅ **Minimal Dependencies** — Vanilla JavaScript frontend with no npm packages; the server uses a small set of npm packages (Express, `pg`, argon2, nodemailer) covered by Dependency Review and Trivy
- ✅ **Secure File Imports** — JSON validation + 2 MB size limit + full re-sanitization on import
- ✅ **Input Validation** — Numeric bounds, date validation, text sanitization at every entry point
- ✅ **Authenticated Server** — argon2id password hashing, server-side sessions (opaque token), httpOnly/Secure/SameSite=Strict cookies, CSRF double-submit tokens on every mutating request, NIST-style new-password rules with a strength meter and an optional Have I Been Pwned breach check, and a Settings → Security change-password form
- ✅ **Active Sessions** — Settings → Security lists every browser signed in to your account (browser, system, last active, and only a truncated network address), with Sign out for one session or all the others; a sign-in from a new browser or system sends an email unless you turn it off
- ✅ **Read-Only API Tokens** — Settings → Security can create named tokens (shown once, stored only as a hash) for scripts that read your data with `GET` requests under `/api`; they can't write, can't manage sessions or tokens, and are revoked when the password changes

### Continuous Security Scanning
The CI pipeline runs five automated scans on every push and pull request to `main`:
- **CodeQL** — GitHub SAST engine; detects XSS, injection, and logic bugs in `src/` JavaScript
- **Trivy — Docker image** — Gates on fixable CRITICAL/HIGH CVEs in the published container image
- **Trivy — Filesystem** — Scans repo lockfiles and source for known-vulnerable packages and leaked secrets; gates on CRITICAL/HIGH
- **Trivy — IaC** — Scans `Dockerfile` and `docker-compose.yml` for CIS-benchmark misconfigurations (informational)
- **Dependency Review** — Blocks PRs that introduce new dependencies with HIGH or CRITICAL severity CVEs

All findings feed into the [GitHub Security tab](https://github.com/jasonkryst/MyFinances/security) as SARIF reports.

### Privacy Guarantee
- ✅ Self-hosted: your data lives in your own PostgreSQL server, behind your own sign-in
- ✅ No data is sent to anyone but that server
- ✅ No tracking and no analytics by default — self-hosters can opt their own instance into Google Analytics via an env var (see [DEPLOYMENT.md](DEPLOYMENT.md)); nothing is ever sent to Google unless you configure it
- ✅ No financial data is kept in browser storage; only device preferences such as theme and language are

### Documentation
- [SECURITY.md](SECURITY.md) — Detailed security practices, CSP policy, vulnerability reporting
- [docs/audit/security/](docs/audit/security/) — Full security audit reports
- [DEPLOYMENT.md](DEPLOYMENT.md) — Production deployment with security headers

---

## 📋 Features

### Navigation & Accessibility
- **Grouped main navigation** — Three labeled groups: **Overview** (Health, Accounts, Income, People), **Manage** (Liabilities, Recurring, Savings, Plan), **Analyze** (Reports, Ledger, Reconcile, Retirement); active-group highlighting, `aria-current`, hamburger menu on ≤768px
- **Command palette** — Ctrl/Cmd+K or the 🔍 toolbar button opens a search across every page, common actions and your records by name (accounts, debts, incomes, recurring items, savings funds, people; Enter jumps to the card); Arrow-key navigation, Enter to activate, Escape restores focus; full `role="dialog"` / `role="listbox"` ARIA semantics
- **Theme selector (Light / Dark / High Contrast)** — 3-way selector in the Settings modal (gear icon); preference saved on this device. High Contrast targets WCAG AA/AAA with pure black surfaces, bright accent colors, and a bold focus outline on every interactive element; command palette includes a "Cycle theme" action
- **Print / Save as PDF** — 🖨️ Print button on every page; `@media print` hides forms/controls so only read-only data content prints; browser print-to-PDF doubles as a PDF export
- **Keyboard navigation** — all interactive elements reachable by keyboard; modals trap focus and Escape-to-close; calendar day-cells keyboard-activatable
- **Accessible control names** — every button/tab has an accessible name; per-item Edit/Delete/Save/Cancel buttons name the item (e.g. `Delete Visa card`), toggle chips expose `aria-pressed`, and sortable column headers expose `aria-sort` plus a direction-aware label (#331); enforced by `tests/ui/test_aria_labels.py`
- **Reduced motion** — `prefers-reduced-motion: reduce` collapses all CSS transitions/animations; `Chart.defaults.animation` disabled app-wide when the OS preference is set
- **Screen-reader chart tables** — every Chart.js canvas has a paired visually-hidden `.sr-only` `<table>` with the same data, rebuilt on every chart re-render via `renderChartDataTable()` in `utils.js`
- **Save-failure banner** — if a change can't be saved to the server, a persistent banner says so (no silent data loss); if the server can't be reached at startup, a full-page screen offers "Try again"
- **In-app guide** — the ❓ Help button opens `guide.html` in a new tab; theme (including High Contrast) follows the main app preference
- **$0 ledger amount policy** — Settings → Advanced lets you Allow, Warn about, or Block $0 amounts in ledger overrides and recurring templates (transfers always need more than $0)
- **Language support (English / Español / Polski)** — pick a language and a currency under Settings → Language & Region (gear icon). Number and date formatting follow the selected language, and changing it re-renders the page you're on. Most of the app is translated, including Ledger-generated transaction names; a few areas, such as parts of the Health page and the Keyboard Shortcuts panel, are still English (tracked in [ROADMAP.md](ROADMAP.md)). Only the English dictionary loads up front; Spanish and Polish load on demand.
- **Settings** — a grouped list in the style of a phone's settings app: Appearance, Language & Region, Notifications, Backup & Restore, Advanced, Change history, Security and About, plus a Danger zone row for Clear All Data. Every control saves as soon as you change it, so there is no Done button.
- **Save status chip** — a small indicator in the header shows Saving, Saved or Not saved, and the browser warns before you close the tab while a save is still pending
- **Undo** — deleting a debt, income, bonus or recurring template, and archiving a debt, recurring template, account or sinking fund, shows a notice with Undo for 10 seconds (Ctrl/Cmd+Z also works outside text fields)
- **Live refresh** — changes made in another tab or on another device appear when you return to the tab or when another tab in the same browser saves; a refresh waits while you are editing so it never overwrites what you are typing
- **Change history** — Settings → Change history lists every create, update and delete made through the app, with the field names and values that changed; entries older than 90 days are removed
- **Lists are paged** — the Liabilities debt list and the Recurring template list show 25 items per page, with Previous/Next controls once a list is longer than that

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
| **Credit Utilization** | Card balances ÷ credit limits, per person and per card; an expandable **"What affects your credit?"** explainer covers the five common credit factors, with a status line where the app has data and a link to AnnualCreditReport.com — education only, never a score |
| **Budget Allocation** | Bill + expense categories as % of income with colour-coded bars; debt payments row included |

Internal links on each card navigate directly to the relevant page (Savings, Liabilities, Plan).

---

### Account Management
- **Account types** — Checking, Savings, Cash, Investment, Credit Card, Loan, or Other; name, starting balance, and optional interest rate (% APY)
- **Interest income** — optional per-account interest rate (% APY); auto-generates a monthly Interest deposit in the Ledger (last day of month, APY ÷ 12 on projected end-of-month balance, compounding), overridable with the true posted amount
- **Account linking** — income sources, one-time entries (bonuses/deposits), debts, recurring templates, and expense budgets can all be linked to an account
- **Account notes** — optional free-text notes (up to 500 characters, multi-line) on each account, e.g. an institution phone number or why a starting balance is unusual. Cards show the first line; expand to read the whole note.
- **Projected monthly balance** — each account card shows a projected end-of-month balance: starting balance ± all linked income, debt payments, recurring transactions, and expenses for the current month, including any ledger amount overrides
- **Net worth widget** — current net worth and change from the prior snapshot shown on the Accounts page
- **Export / Import** — accounts are included in the JSON backup

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
- **Payoff Analysis badge** — each credit-card debt card shows a break-even comparison: your plan payment vs. minimum-only, with months saved and interest saved; no-plan state shows minimum-only estimate with a clear banner; toggle between Fixed and % of Balance minimum-payment mode
- **Accelerate modal** — "Accelerate this debt →" button opens a live-preview modal: type an extra monthly payment and instantly see updated payoff date and interest saved; "Apply to Plan" wires the total into the Strategy page
- **Promotional APR** — a debt can have an intro rate and an inclusive end date. The payoff plan uses the promo rate until that date and the regular rate after it, and the card shows "0% until Jun 2027 (then 24.99%)". An optional deferred-interest amount adds the interest that accrued during the promo if a balance remains when it ends. A notification fires within 60 days of the end date
- **Shared debts** — a debt can belong to more than one person (see People) with an ownership split; the default is an equal share
- **Weekend due-date shift** — debts and recurring templates can keep a weekend due date, or move it to the Friday before or the Monday after (never out of the month)
- **Refinancing what-if** — a collapsible panel on the Plan page re-runs the plan with a new APR (and optional intro rate) on one debt and shows the interest and months saved or added

---

### Income Tracking
- **Income sources** — name, amount per paycheck, first pay date, and frequency (bi-weekly or monthly); automatic pay-schedule projection for the current month
- **One-time entries** — bonus, tax refund, cash deposit, check deposit, or other; linkable to an account
- **Monthly summary** — expected income this month, regular pay, one-time entries, estimated annual total
- **Debt-to-income ratio** — Plan page shows monthly debt payment as a % of income with a warning above 40%
- **Gross and net pay** — an optional tax withholding percentage turns the entered amount into take-home pay; cash flow, the Ledger and the Forecast use the net amount
- **Amount changes that apply from a date** — raising or cutting an income's amount (or a recurring item's) can take effect on a chosen date, so earlier months keep the old amount
- **End dates** — an income can have an inclusive end date, so a job or contract that stops keeps its history; ended incomes hide behind a *Show ended* toggle
- **Recurring annual bonuses** — a bonus can repeat every year, optionally until a date; each year has its own Ledger entry

---

### People
- **Family members** — add the people in your household on the People page and link debts and income to them
- **Debt ownership split** — a debt linked to two or more people gets an equal share each, or a split you set by percentage
- **Per-person totals** — the page shows each person's income, debt balance, minimum payments and credit utilization, attributed by share; ended incomes are left out

---

### Budget Tracking (Expenses)
- **Expense budgets** — variable monthly spending targets with date tracking (for calendar and ledger); inline editing in the list
- **Bills** — fixed monthly costs with due day and category (data model; no standalone add UI — use Recurring Templates for new fixed costs)
- **Cash Flow Summary** — live panel: Income − Debt minimums − Bills − Budgeted expenses = Net remaining
- **Category budgets** — on Liabilities → Expenses, set a fixed monthly amount per category or let it derive from the month's scheduled transactions; the Variance report adds a Budget vs. Actual table
- **Persisted to the server** — expenses and bills are saved to PostgreSQL and included in JSON export/import

---

### Recurring Transaction Templates
- **Four types** — Subscription (outflow), Income (inflow), Reimbursement (inflow), Transfer (debit one account, credit another; both Ledger legs are marked ⇄, like one-off transfers)
- **Flexible frequency** — Weekly, bi-weekly, monthly, quarterly, yearly
- **Start and end dates** — constrain to a specific date range
- **Pause & skip controls** — temporarily pause a template or skip individual months without deleting
- **Mark as Paid** — confirm each of the month's payments and its actual amount; this marks the matching Ledger transaction Cleared and a different amount becomes its Ledger amount. Checking Cleared in the Ledger marks it paid here too (issue #434). Distinct from Skip; resets each calendar month
- **Integrated** — recurring templates generate projected transactions in the ledger and appear in all Reports views

---

### Savings (Emergency Fund & Sinking Funds)
- **Emergency Fund** — target amount, current savings, monthly contribution, auto-contribution toggle; progress bar + % badge
- **Sinking Funds** — named savings goals with three allocation methods: Fixed Monthly Amount, Annual Cost ÷ 12, or Target Date Planning (app calculates required monthly amount). A target-date fund keeps its date: the card shows the deadline, the amount needed per month now and a status of On track, Behind, Ahead, Past due or Funded
- **Home Purchase** — a sub-tab with a mortgage affordability calculator, a list of debts to clear before qualifying and a PMI threshold tracker
- **Auto-contribute** — auto-contributions appear as dedicated outflows in the Ledger, Reports, and Account projections
- **Integrated with Reports** — contributions appear in Income vs. Expenses, Money Flow chart, Variance Dashboard, and account projections

---

### Notifications
- **Bell and page** — the bell in the header lists alerts with an unread count; *View all* opens the Notifications page, which filters by type, status, account and date range and groups alerts by day. The bell follows the page's saved Type, Status and Account filters
- **Alert types** — bill due soon or today (debts and recurring outflows that aren't Cleared), low balance (a threshold you set per account), overdrawn account, projected low balance, promotional rate ending, and sinking fund behind or past due
- **Delivery** — in-app, email, or both, as one email per alert or a digest; email needs SMTP settings on the server (see [DEPLOYMENT.md](DEPLOYMENT.md)). Each alert type and the *days ahead* window are set under Settings → Notifications, and an account can be muted for balance alerts
- **Keyboard** — j/k/x/e/Enter work on the Notifications page and are listed in the keyboard shortcuts panel

---

### Retirement
- **Retirement accounts** — a Retirement account type (401k, Traditional IRA, Roth IRA, HSA, Other) with an assumed rate of return and an optional employer match; you log balance and contribution snapshots per period
- **Charts and projection** — balance over time, contributions versus growth, a balance breakdown, and a projection to a target date with conservative, moderate and aggressive scenarios
- **Monthly income in retirement** — a withdrawal-rate slider (2% to 8%) turns each projected balance into a monthly estimate
- **Coast FIRE** — shows the earliest month you could stop contributing and still reach your target, using your own target or the FIRE number from Health

---

### Account Reconciliation
- **Reconcile page** — per-account statement balance entry with a live colour-coded difference vs. tracked balance; explicit statement start/end dates (defaulting to the day after the last reconciliation → today, validated so the end can't precede the start) drive an "Expected transactions" listing that helps identify discrepancies; history rows show the statement period
- **Two modes** — **Adjust Balance** (reconciliation updates `startingBalance` going forward) or **Visible Only** (recorded and shown on Ledger but does not mutate the tracked balance); changeable any time via the Settings modal (⚙ gear icon or command palette)
- **Ledger integration** — every reconciliation appears as a marker row on the unified Ledger with previous → statement balance and difference; an inline ℹ icon shows whether the current mode is active (blue) or informational (muted)
- **History log** — each reconciliation records previous balance, statement balance, difference, and an optional note; per-entry delete does not revert the balance
- **Quick-reconcile modal** — "🔄 Reconcile this account" button on the Ledger page (when a single account is selected)
- **Export/Import** — `app.reconciliations` and `app.settings` round-trip through JSON backup

---

### Ledger
- **Unified transaction list** — income, one-time entries, debts, bills, expenses, recurring templates, savings contributions, and reconciliation markers in one scrollable view
- **Account + date range filters** — filter by account and by range (All, Past & Today, Next 30/60/90 Days, Through Next Month)
- **Manual transactions** — an Add Transaction button records a one-off purchase, refund or withdrawal (Expense or Income, amount, date, description, category, memo) on any account; it moves balances and every report, counts as spending but not toward a category's budget, starts out Cleared, and is edited or deleted from its own row (no override); a receipt or deposit made of parts can be split across several categories, which must add up to the total, and each part counts toward its own category in Spending and Budget vs. Actual
- **Search and saved filters** — a Search box matches name, category or memo; account, date range, sort, status, category and page size are saved on the server, so another browser or device sees the same filters
- **Transfers** — a one-off transfer between two accounts shows as two ⇄ legs that net to zero; start one from an account card or the Ledger toolbar
- **Amount overrides** — modal-based Override / Edit override / Reset per transaction; overrides are keyed by type+id+account+date so they survive ledger re-sorts; changing an override immediately recalculates running balances, Reports, and account projections
- **Cleared tracking** — a Cleared checkbox per transaction records whether it has actually posted to the account, plus the timestamp it was marked cleared (shown as the checkbox's tooltip); keyed the same way as amount overrides, so it's independent of ledger re-sorts. Purely informational — it does not affect running balances — useful for spotting scheduled transactions (bills, recurring items) that haven't posted on the day they were expected to
- **Running balance** — continuous balance column; snaps to the statement balance at each reconciliation marker when "Adjust Balance" mode is active
- **CSV export** — column-picker modal (date, account, name, amount, category, running balance, type, cleared, cleared at); exports respect the current filter and sort; selected columns persist between sessions

---

### Calendar & Reports
- **Month-by-month calendar** — income paydays, recurring occurrences, expenses, debt payments, and bonuses pinned to their dates; compact dot-count cells open a full event modal on click/Enter
- **Income vs. Expenses** — chart with income, recurring costs, and debt minimums for the current month
- **Money Flow** — cumulative income/outflow/net tracked day-by-day through the month; per-account balance table
- **Variance Dashboard (What Changed)** — current vs. previous period deltas for income, expenses, recurring costs, debt minimums, and net available; a Range selector (Single Month/Quarter/Half Year/Year) aggregates across multiple months instead of just one, compared against the equivalent-length prior period
- **Year in review** — a Reports tab that sums up a calendar year in short sentences: what happened first, then what your plan says; the current year is compared with the same months last year, and estimates are tagged
- **Net Worth** — historical trend chart (3/6/12 month; before your first snapshot it is estimated from balance history, and the current month shows live), Net Worth vs. Liabilities, Asset Growth vs. Debt Reduction, snapshot history audit table, manual snapshot capture; milestone celebrations at +$5K increments
- **Spending Analysis** — doughnut pie of all outflows for the selected period; 6-month stacked bar trend; ranked category list with change % badges (vs. prior period or vs. same period last year); drill-down modal per category; the same Range selector as the Variance Dashboard aggregates multiple months (e.g. a quarter) into one view
- **Cash Flow Forecast** — project balances 1/2/3/6/12 months ahead for total cash position or a single account; notable-month driver flags; negative-balance and intra-month dip warnings
- **Summary Report** — Monthly/Yearly toggle with cash flow, per-account balance changes, and net worth for the selected period
- **Calendar Feed** — toolbar 📅 button exports bills, debts, recurring items, expenses, and income paydays (`Payday - Name`) as all-day iCal events over a ±12-month window; download a `.ics` file (any backend) or subscribe via a live `webcal://` link (PostgreSQL backend). Archived debts follow Settings → Show archived debts and are titled `Debt (Archived) - Name` when shown

---

### Calculation Engine
- **Daily compounding interest** — `monthlyInterest = balance × ((1 + APR/365)^daysInMonth − 1)`
- **Four strategies** — Avalanche (highest APR first), Snowball (lowest balance first), Priority-Low, Priority-High
- **Per-month stimulus** — add a one-time extra payment for any month; plan recalculates instantly
- **Negative-amortisation warning** — badge flags any debt where the minimum payment is below the monthly interest
- **Strategy comparison panel** — runs all four strategies and shows interest/time saved vs. your current choice
- **What-If simulator** — drag a slider to add extra monthly payment and instantly see months saved / interest saved
- **Break-Even Analysis** — per-debt module (`src/breakEven.js`) runs two single-debt simulations (plan vs. minimum-only) to compute months saved, interest saved, and balance-over-time series for mini charts; supports both fixed-minimum and percent-of-balance modes
- **Target Payoff Date** — enter a desired payoff date; binary-search back-calculator (up to 60 iterations) finds the required monthly payment

### Charts (Chart.js)
- Payoff Timeline — one line per debt declining to zero
- Cumulative Progress — Total Paid, Principal Paid, Interest Paid running totals
- Principal vs. Interest doughnut
- Debt Balance Distribution pie
- Monthly Debt-to-Income pie (requires income sources)

---

### Data Management
- **Server storage** — every change is saved to your PostgreSQL server as you make it; sign in from any device to see the same data. Data left in a browser by a pre-7.0 version is offered for a one-time import (or download/removal) after sign-in
- **JSON export** — one-click full backup including accounts, debts, income, bills, expenses, recurring templates, snapshots, overrides, reconciliations, and settings
- **Settings-only backup** — a small separate file for just your preferences (theme, language, currency and option toggles), never your financial data
- **JSON import** — Replace (full restore) or Merge (append debts; restore income, bills, expenses, overrides); legacy v1.0 files accepted; 2 MB max; full re-sanitization after import; a collapsible warning list reports any coerced fields or rejected records, and a malformed file shows the specific parse error inline
- **CSV export** — debt payment schedule + per-debt summary; Ledger CSV with custom column picker
- **Clear All Data** — wipe everything and start fresh

---

### Installable (PWA)
- **Add to Home Screen / Install** — `manifest.json` plus a generated icon set (`icons/`) make the app installable as a standalone app on desktop and mobile
- **Cached app shell** — a service worker (`sw.js`) precaches the app shell, so the page itself loads quickly; your data always comes from the server (`/api`, `/auth` and `/calendar.ics` are never cached), and with no connection the app shows a "can't reach your server" screen instead of stale data
- **Current releases** — while online, stable app-shell URLs revalidate before use so Chrome receives newly deployed HTML, JavaScript, and styles instead of retaining an older cached release
- **Update prompt** — when a new version is deployed, a dismissible banner offers to reload rather than silently swapping assets mid-session

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

Reloading the app later automatically shows your last-calculated plan's results again — no need to re-enter your payment and re-click Calculate. Every submission is also logged to the collapsible **📜 Plan History** panel (date, payment, strategy, total interest, payoff date), capped at the 20 most recent runs, so you can compare past plans at a glance. With two or more entries, *Compare two plans* shows each debt's payoff month and interest in both plans and the change.

### 4 — Track your income
Navigate to **Income**. Add one row per income source. Use the one-time entry section for bonuses, tax refunds, and irregular deposits.

### 5 — Track your budget
Navigate to **Liabilities** (Budget sub-tab). Add bills (fixed monthly costs) and expense budgets (variable spending targets with category and date). The Cash Flow Summary panel shows net remaining after all outflows.

### 6 — Export / Import
Backup & Restore is a page in Settings (gear icon, or the account menu).

- **Export (JSON)** — complete backup of all data as a single `.json` file
- **Import (JSON)** — choose Replace (full restore) or Merge (append debts)
- **Export CSV** — payment schedule or Ledger with custom columns
- **Export Charts as PNG** — downloads every currently-visible chart as a PNG image
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

The frontend has no build step, so the repository root holds the app itself.

```
index.html, guide.html      — App shell (with the CSP meta tag) and the in-app usage guide
styles.css, styles-csp-classes.css, guide.css — Stylesheets (no inline styles, for the CSP)
manifest.json, sw.js, icons/ — PWA manifest, service worker and generated icon set
env-config.js               — Placeholder for the optional analytics setting (the Docker image generates the real one)
src/                        — Frontend ES modules, one per feature, plus src/locales/ (en, es, pl)
server/                     — Node.js + Express API over PostgreSQL: routes, auth, migrations,
                              background jobs, email templates, scripts and its own tests (server/test/)
tests/                      — pytest + Playwright suites (features, ui, security, a11y, integration,
                              postgres), Jest unit tests (tests/unit/) and the shared harness
tools/                      — Dev tooling: Stryker scope and per-file floors, Lighthouse sign-in, icon generator
docs/                       — architecture/ (module map and internals), audit/ (security, a11y, test reports),
                              history/ (archived roadmap), superpowers/ (design specs), examples/, implementation/
docker-compose.yml, docker-compose.dev.yml, docker-compose.mailpit.yml, Dockerfile, nginx.conf,
docker-entrypoint.d/        — The Docker stack: nginx + server + PostgreSQL, a dev override that
                              bind-mounts the frontend, and a Mailpit override for email testing
setup.sh, setup.ps1, backup.*, restore.* — Secrets setup, backup and restore scripts
```

For the module map (which file owns what), see [CLAUDE.md](CLAUDE.md) and [docs/architecture/](docs/architecture/).

> **Known gap:** The standalone Bills UI (`#billForm`/`#billList`) was removed in favor of Recurring Templates, but `bills.js` still defines the full bills data model and calculation logic — `app.bills` is read by `accounts.js`, `health.js`, `ledger.js`, and `strategy.js`, and round-trips through import/export. There is currently no reachable UI to add or edit a bill.

### Documentation Files

- **[README.md](README.md)** — You are here
- **[CHANGELOG.md](CHANGELOG.md)** — Version history and release notes
- **[ROADMAP.md](ROADMAP.md)** — Current roadmap (Now / Next / Later) and recent releases; the earlier v4-era roadmap is in [docs/history/ROADMAP-v4.md](docs/history/ROADMAP-v4.md)
- **[SECURITY.md](SECURITY.md)** — Security practices, CSP policy, vulnerability reporting
- **[DEPLOYMENT.md](DEPLOYMENT.md)** — Production deployment guides (Nginx, Apache, Docker)
- **[AGENTS.md](AGENTS.md)** — Operational notes for automated agents (running the test suite locally)
- **[CLAUDE.md](CLAUDE.md)** — Project rulebook: commands, architecture, conventions
- **[docs/architecture/](docs/architecture/)** — Module map and internals: [features](docs/architecture/features.md), [storage](docs/architecture/storage.md), [testing](docs/architecture/testing.md)
- **[tests/README.md](tests/README.md)** — Comprehensive test documentation
- **[docs/audit/security/](docs/audit/security/)** — Security audit reports
- **[docs/audit/a11y/](docs/audit/a11y/)** — Accessibility audit reports
- **[docs/audit/test/](docs/audit/test/)** — Test suite audit and coverage reports
- **[guide.html](guide.html)** — In-app user guide

### Key Technologies

- **Frontend**: Vanilla ES6+ JavaScript — no frameworks, no build step
- **Storage**: Self-hosted PostgreSQL via a Node.js + Express API (required)
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
- JSON validation with try-catch — a malformed file surfaces the native parse error (position/line/column when the browser provides it) inline in the Import tab's error banner, never a popup alert
- Complete re-sanitization on every import (all `sanitize*` functions run again)
- Per-field coercion/rejection warnings — a collapsible "Import succeeded — N issues found" list names every field that was coerced to a default and every record dropped for missing/invalid required fields, across all importable collections
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

## 🧪 Testing Suite

Every Playwright test runs against a real stack and wipes the server's data, so never point the tests at a deployment that holds real data. Setup, environment variables and the shard layout are in [tests/README.md](tests/README.md) and [docs/architecture/testing.md](docs/architecture/testing.md).

### Test Suites
Counts are from 2026-11-23 (v7.32.1) and will drift; the CI run is the source of truth. The Playwright counts are test functions found with `grep` (parametrized cases run more); the Jest and server counts are what those runners report.

| Suite | Where | Approx. count | What it covers |
|-------|-------|---------------|----------------|
| Features | `tests/features/` | 1,675 in 131 files | Per-feature CRUD and business logic: accounts, debts, income, recurring, savings, Ledger, Reports, Forecast, reconciliation, notifications, retirement, people, i18n coverage and render guard, PWA, versioning |
| UI/UX | `tests/ui/` | 478 in 47 files | Mobile layout and clipping, modals, dark and high-contrast themes, contrast ratios, command palette, keyboard shortcuts, Settings, setup wizard, print |
| Security | `tests/security/` | 85 in 7 files | XSS, CSP (meta tag and nginx header kept in sync), input validation, static scan, no financial data in browser storage |
| Accessibility | `tests/a11y/` | 10 in 1 file | Site-wide sweep of every page in both themes: ARIA references, duplicate IDs, names, contrast |
| Integration | `tests/integration/` | 20 in 4 files | End-to-end workflows, smoke tests, import/export round trips |
| Postgres | `tests/postgres/` | 89 in 12 files | Sign-in and login gate, import, per-resource mutations, legacy data migration, setup wizard, email through Mailpit |
| Jest unit | `tests/unit/` | 1,735 tests in 66 suites | Pure modules: calculation engine, sanitizers, formatting, sync and projection cores |
| Server | `server/test/` | 527 tests in 37 files | `node:test` suite for routes, auth, migrations, jobs, notifications and the calendar feed, against a real PostgreSQL |

### Quick Test Commands

```bash
pytest tests/ -v                  # All Playwright tests (needs the running stack)
pytest tests/security/ -v         # Security
pytest tests/features/ -v         # Features
pytest tests/ui/ -v               # UI/UX
pytest tests/a11y/ -v             # Accessibility audit
pytest tests/integration/ -v      # Integration
pytest -m "security" -v           # By marker
pytest -m "not slow" -v           # Skip slow tests
npm run test:unit                 # Jest unit tests
cd server && npm test             # Server tests (needs a test PostgreSQL, see server/README.md)
```

### 🧬 Mutation Testing (Jest + Stryker)
A separate, dev-only Node toolchain mutation-tests the pure calculation, formatting, sanitization and core modules (the debt and retirement calculators, sanitizers, the shared projection, merge, notification and net worth cores, and more). It is not part of the Python suite and runs as the `mutation-testing` CI job. Each scoped file has its own score floor (`tools/mutationFloors.json`), checked by `tools/mutationFloors.cjs`; a pull request that touches a scoped file runs the same check against the baseline from `main`. The scope is listed by function name in `tools/strykerScope.mjs`.

```bash
npm install
npm run test:unit        # Jest unit tests
npm run test:mutation     # Stryker mutation run (HTML report at reports/mutation/mutation.html)
```

### Lighthouse
CI runs Lighthouse against the signed-in app (not the sign-in screen), and fails if the audit did not load real data. See [docs/architecture/testing.md](docs/architecture/testing.md).

---

## 📱 Browser Support & Requirements

| Browser | Version | Support |
|---------|---------|---------|
| Chrome | 60+ | ✅ Full |
| Firefox | 55+ | ✅ Full |
| Safari | 12+ | ✅ Full |
| Edge | 79+ | ✅ Full |
| IE 11 | — | ❌ Not supported |

**Required**: ES6+ JavaScript, cookies enabled (for sign-in), CSS Grid & Flexbox, CSS custom properties, and a reachable MyFinances server.

---

## 🚀 Deployment

```bash
docker compose up -d        # nginx + API + PostgreSQL at http://localhost:32900
```

See [DEPLOYMENT.md](DEPLOYMENT.md) for the Docker stack, secrets, reverse proxy, HTTPS and backups.

---

## 🐛 Troubleshooting

**My data disappeared.**
> Your data lives in the server's PostgreSQL volume. Check that you signed in to the right server, and that the volume wasn't removed (`docker compose down -v` deletes it). Use **Backup & Restore → Export** regularly as a portable JSON backup you can re-import any time.

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
> If the "Couldn't save your last change" banner appeared, the server rejected or never received the change. Check the server logs (`docker compose logs server`) and your connection, then reload to see what's saved.

**"Can't reach your server" appears.**
> The app could not reach the API. Check that the stack is running (`docker compose ps`), then press **Try again**.

---

## 📞 Support & Contributions

- **Questions and ideas:** [Discussions](https://github.com/jasonkryst/MyFinances/discussions)
- **Bugs, feature requests and accessibility barriers:** [open an issue](https://github.com/jasonkryst/MyFinances/issues/new/choose) using one of the forms
- **Security vulnerabilities:** report them [privately](https://github.com/jasonkryst/MyFinances/security/advisories/new), never in a public issue; see [SECURITY.md](SECURITY.md#vulnerability-reporting)
- **Contributing code, tests or translations:** see [CONTRIBUTING.md](CONTRIBUTING.md) and [ROADMAP.md](ROADMAP.md)
- **Accessibility commitment and known limitations:** [ACCESSIBILITY.md](ACCESSIBILITY.md)
- Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md)

---

**Start your journey to being debt-free today!** 💰

---

*See [CHANGELOG.md](CHANGELOG.md) for the current version and release history.*
