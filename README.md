
# MyFinances

_A modern, privacy-first web app to track accounts, debts, income, and spending, helping you plan and visualize your path to financial freedom._


All calculations happen locally in your browser — no accounts, no servers, no tracking.

**Security Status**: ✅ Production-Ready | **Risk Level**: LOW | **Audit Date**: May 29, 2026

---

## 🚀 Quick Start

```bash
# Development (Python)
python -m http.server 5500

# Open browser
http://localhost:5500

# Run tests
python tests/smoke_playwright.py    # Full workflow test
python tests/test_security.py       # Security tests
python tests/test_mobile_menu.py    # Mobile responsiveness
```

For production deployment, see [DEPLOYMENT.md](DEPLOYMENT.md).

---

## 🔒 Security & Privacy

MyFinances prioritizes your financial data security with enterprise-grade protections:

### Security Features
- ✅ **Zero Data Transmission** — All data stays on your device
- ✅ **XSS Prevention** — All user input sanitized and HTML-encoded
- ✅ **Strong CSP** — Content Security Policy blocks malicious scripts
- ✅ **No External Dependencies** — Vanilla JavaScript (no npm vulnerabilities)
- ✅ **Secure File Imports** — JSON validation + size limits + data re-sanitization
- ✅ **Input Validation** — Numeric bounds, date validation, text sanitization
- ✅ **Client-Side Only** — No server, no authentication needed

### Privacy Guarantee
- ✅ All calculations run entirely in your browser
- ✅ No data is sent to any server
- ✅ No accounts, no tracking, no analytics
- ✅ Data is stored only in your browser's `localStorage` (same-origin policy)

### Documentation
- [SECURITY.md](SECURITY.md) — Detailed security practices & implementation
- [SECURITY_AUDIT.md](SECURITY_AUDIT.md) — Full security audit report
- [DEPLOYMENT.md](DEPLOYMENT.md) — Production deployment with security headers

---

## 🎯 Key Product Updates

### Mobile-Responsive Navigation (NEW)
- **Hamburger Menu** — Collapsible navigation on tablets and mobile (≤768px)
- **Touch-Friendly** — 44x44px minimum button sizes on mobile
- **Auto-Close** — Menu collapses after page selection
- **Accessibility** — ARIA labels and keyboard navigation support

### Responsive CSS Architecture (NEW)
- **No Unsafe-Inline CSS** — All styles extracted to `styles.css`
- **Strong CSP** — `style-src 'self'` (no inline styles)
- **Utility Classes** — `.sr-only` and `.help-icon` properly organized
- **Breakpoints** — Desktop (>768px), Tablet (768px), Mobile (≤480px)

---

## 🏗️ Architecture

### Technology Stack
- **Frontend**: Vanilla ES6+ JavaScript (no frameworks)
- **Storage**: Browser localStorage only
- **Charts**: Chart.js via CDN
- **Styling**: Responsive CSS3 with mobile-first design
- **Deployment**: Static files (any web server)

### Core Modules

```
index.html              Main page shell + responsive navigation
styles.css              Responsive styles + dark mode + utilities
src/
  ├─ app.js             Main controller & app state
  ├─ ui.js              Event listeners & page navigation
  ├─ strategy.js        Debt payoff calculation engine
  ├─ debts.js           Debt management
  ├─ accounts.js        Account management
  ├─ income.js          Income tracking
  ├─ bills.js           Bills & expense budgeting
  ├─ recurring.js       Recurring transaction templates
  ├─ savings.js         Emergency fund & sinking fund tracking
  ├─ ledger.js          Transaction ledger & amount overrides
  ├─ reports.js         Reports & calendar view
  ├─ charts.js          Chart rendering
  ├─ storage.js         Persistence & import/export
  ├─ debtCalculator.js  Pure calculation engine (no side effects)
  └─ utils.js           Shared utilities & formatters
```

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
- **Dedicated HTML guide page** — the in-app help button opens `USAGE_GUIDE.html` in a new tab
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
- **Priority levels** — assign a 1–10 priority to each debt for custom strategy ordering

### Account Management
- **Add accounts** — define checking, savings, cash, investment, credit card, loan, or other accounts with a name, type, and starting balance
- **Link to accounts** — assign income sources, one-time entries (bonuses/deposits), debts, recurring templates, and expense budgets to specific accounts
- **Projected monthly balance** — each account card shows a projected end-of-month balance: starting balance ± all linked income, debt payments, recurring transactions, and expenses for the current month, including any ledger amount overrides
- **Money Flow report** — the Reports › Money Flow tab includes a per-account balance table alongside the cumulative cash-flow chart
- **Export / Import** — accounts are included in the JSON backup (version 3.0 format)

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
- **Reports sections** — Income vs. Expenses chart showing income, recurring costs, and debt minimums; Money Flow chart tracking cumulative income/outflow/net day-by-day through the month; Variance Dashboard comparing this month vs last month with clear deltas for income, expenses, recurring costs, and debt; account balance projections for each account
- **Recurring integration** — all recurring template transactions are fully integrated into calendar events, income vs. expenses breakdown, and money flow calculations
- **Variance Dashboard** — "What Changed" tab comparing current month vs previous month with color-coded deltas for income, expenses, recurring costs, debt minimums, and net available funds; quickly identify spending patterns and budget trends

### Interest Paid to Date
- Record the date you opened each credit-card debt (`debtStartDate`)
- The app estimates the interest you have already paid using daily compounding on the original balance, minus the principal you have paid down
- Shown on each debt card, in the summary table, and persisted to localStorage

### Data Management
- **Persistent storage** — debts, income, stimulus data, monthly payment, strategy, recurring templates, and ledger amount overrides are auto-saved to `localStorage`
- **Export (JSON)** — one-click full backup from the header toolbar; downloads debts, income sources, strategy settings, recurring templates, and ledger amount overrides as a single `.json` file
- **Import (JSON)** — restore from any previously exported backup; choose **Replace** (full restore) or **Merge** (append debts, always restores income & strategy)
- **Export to CSV** — full payment schedule plus per-debt summary in one spreadsheet-ready file
- **Clear All Data** — wipe everything and start fresh

---

## How to Use

### Open the usage guide

Click the **❓ Help** button in the header toolbar to open the full usage guide in a separate tab. The guide lives at `USAGE_GUIDE.html` and includes a fixed **Back to Application** link that returns you to `index.html`.

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
| Priority | 1–10, used by Priority strategies |
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
  "version": "3.0",
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
USAGE_GUIDE.html           — In-app usage guide (opened by Help button)
styles.css                 — Responsive styles + dark mode + utilities + mobile menu
src/
  ├─ app.js                — Main app controller & state management
  ├─ ui.js                 — Event listeners, navigation, mobile menu toggle
  ├─ strategy.js           — Debt payoff calculations & results rendering
  ├─ debts.js              — Debt management (CRUD & inline editing)
  ├─ accounts.js           — Account management & projections
  ├─ income.js             — Income sources & one-time entries
  ├─ bills.js              — Bills & expense budgets
  ├─ recurring.js          — Recurring transaction templates
  ├─ savings.js            — Emergency fund & sinking fund tracking
  ├─ ledger.js             — Transaction ledger with amount overrides
  ├─ reports.js            — Reports & calendar views
  ├─ charts.js             — Chart rendering & lifecycle
  ├─ storage.js            — Persistence, import/export, data validation
  ├─ debtCalculator.js     — Pure calculation engine
  └─ utils.js              — Formatting, date utilities, sanitization
tests/
  ├─ smoke_playwright.py   — Full workflow test
  ├─ test_security.py      — Security & validation tests
  ├─ test_mobile_menu.py   — Mobile responsiveness tests
  └─ test_css_load.py      — CSS loading verification
```

### Documentation Files

- **README.md** — You are here
- **SECURITY.md** — Security practices, deployment headers, vulnerability reporting
- **SECURITY_AUDIT.md** — Complete security audit with findings & recommendations
- **DEPLOYMENT.md** — Production deployment guides for Nginx, Apache, Docker
- **IMPLEMENTATION_SUMMARY.md** — Security enhancement documentation
- **USAGE_GUIDE.html** — In-app user guide

### Key Technologies

- **Frontend Framework**: Vanilla ES6+ JavaScript (no dependencies)
- **Storage**: Browser localStorage (same-origin isolated)
- **Charts**: Chart.js 3.x via CDN
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
connect-src 'self';
object-src 'none';
base-uri 'self';
form-action 'self';
frame-ancestors 'none';
```

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
python tests/smoke_playwright.py    # Full application workflow
python tests/test_security.py       # Security & input validation
python tests/test_mobile_menu.py    # Mobile responsiveness
python tests/test_css_load.py       # CSS loading verification
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
2. **Contact** the repository owner privately
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

---

**Start your journey to being debt-free today!** 💰

---

*MyFinances v3.0 — Updated May 29, 2026*