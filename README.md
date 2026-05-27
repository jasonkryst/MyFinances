# Debt Tracker Application

A modern, single-page web application that helps you plan and visualise a path to becoming debt-free. All calculations happen locally in your browser — no accounts, no servers, no tracking.

---

## Features

### Debt Management
- **Add unlimited debts** — credit cards (revolving balance with APR) or fixed-amount recurring payments (subscriptions, rent, instalments)
- **Single-page add & manage** — the Debts page shows the add form and the debt list side by side; no page switching needed
- **Inline editing** — click Edit on any debt card to populate the form for editing; the list updates immediately on save
- **Update Balance** — quickly record a new balance for any credit-card debt while preserving the original balance for progress tracking
- **Category labels** — tag debts (e.g. "Housing", "Credit Card") and filter the list by category
- **Priority levels** — assign a 1–10 priority to each debt for custom strategy ordering

### Account Management
- **Add accounts** — define checking, savings, cash, investment, credit card, loan, or other accounts with a name, type, and starting balance
- **Link to accounts** — assign income sources, bonuses, debts, bills, and expense budgets to specific accounts
- **Projected monthly balance** — each account card shows a projected end-of-month balance: starting balance ± all linked income, debt payments, bills, and expenses for the current month
- **Money Flow report** — the Reports › Money Flow tab includes a per-account balance table alongside the cumulative cash-flow chart
- **Export / Import** — accounts are included in the JSON backup (version 3.0 format)

### Income Tracking
- **Add income sources** — name, amount per paycheck, first pay date, and frequency (bi-weekly or monthly)
- **Automatic pay-schedule projection** — the app walks each source's pay cadence forward from its first pay date to calculate how many paydays fall in the current month
- **Monthly income summary** — shows expected income this month, number of paydays, and estimated annual total
- **Debt-to-income ratio** — the Strategy page shows what percentage of your expected monthly income your planned payment represents, with a warning if it exceeds 40%

### Budget Tracking
- **Bills** — add any recurring fixed costs (utilities, internet, insurance, subscriptions, rent, transport); each bill records name, monthly amount, due day, and category
- **Expense budgets** — set monthly spending targets for variable categories (groceries, dining, health, entertainment, clothing, personal care, education, childcare)
- **Cash Flow Summary** — a live panel on the Budget page shows expected monthly income minus debt minimums, bills, and budgeted expenses, giving you a net remaining figure
- **Net cashflow on Strategy page** — the income widget also shows net after all obligations so you can see available surplus at a glance before running a plan
- **Inline editing** — edit any bill or expense budget directly in the list without a separate form
- **Persisted to storage** — bills and expenses are saved to `localStorage` and included in JSON export / import

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

### Calendar View
- One calendar month per page, paginated forward through the entire plan
- Debt payment events pinned to each debt's due date, colour-coded by debt
- Today's date highlighted

### Interest Paid to Date
- Record the date you opened each credit-card debt (`debtStartDate`)
- The app estimates the interest you have already paid using daily compounding on the original balance, minus the principal you have paid down
- Shown on each debt card, in the summary table, and persisted to localStorage

### Data Management
- **Persistent storage** — debts, income, stimulus data, monthly payment, and strategy are auto-saved to `localStorage`
- **Export (JSON)** — one-click full backup from the header toolbar; downloads debts, income sources, and strategy settings as a single `.json` file
- **Import (JSON)** — restore from any previously exported backup; choose **Replace** (full restore) or **Merge** (append debts, always restores income & strategy)
- **Export to CSV** — full payment schedule plus per-debt summary in one spreadsheet-ready file
- **Clear All Data** — wipe everything and start fresh

---

## How to Use

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

Click **Add Account**. Each account card shows the starting balance and a **projected end-of-month balance** that factors in all linked income, bonuses, debt payments, bills, and expense budgets. When adding income sources, debts, bills, or expenses you can optionally link them to one of your accounts.

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
| Monthly Budget | The amount you plan to spend |
| Category | Food·Groceries / Dining Out / Health·Fitness / Entertainment / Clothing / Personal Care / Education / Childcare / Other |

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
  "strategy": { "monthlyPayment": 800, "paymentStrategy": "avalanche" }
}
```

**Import (JSON)** — click *⬆ Import* and select a previously exported file. You will be prompted to choose:

| Choice | Behaviour |
|--------|-----------|
| **OK (Replace)** | Everything is replaced by the file contents (debts, income, bills, expenses, strategy) |
| **Cancel (Merge)** | Imported debts are appended (duplicates by name are skipped); income, bills, expenses, and strategy settings are always restored from the file |

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

## Technical Details

### File Structure

```
index.html          — Markup and layout
styles.css          — Responsive styles + dark mode
app.js              — DebtTrackerApp class (UI, state, charts)
debtCalculator.js   — DebtCalculator static class (pure calculation engine)
```

### Dependencies

- [Chart.js](https://www.chartjs.org/) (loaded from CDN) — all charts

### Browser Requirements

- Modern browser with ES6+ JavaScript support
- `localStorage` enabled
- Tested in Chrome, Firefox, Safari, and Edge

### Interest Formula

```
monthlyInterest = balance × ((1 + APR / 100 / 365)^daysInMonth − 1)
```

### Interest Paid to Date Formula

```
totalAccrued = originalBalance × ((1 + APR/100/365)^daysSinceOpened − 1)
interestPaid = max(0, totalAccrued − principalPaidDown)
```

### Binary-Search Back-Calculator

```
lo  = sum of all minimum payments
hi  = 2 × totalBalance + 10 000
for 60 iterations:
    mid = (lo + hi) / 2
    if calculatePaymentPlan(mid) pays off by target date → hi = mid
    else → lo = mid
```

---

## Data Privacy

- ✅ All calculations run entirely in your browser
- ✅ No data is sent to any server
- ✅ No accounts, no tracking, no analytics
- ✅ Data is stored only in your browser's `localStorage`

To back up your data, use **Export Debts (JSON)** regularly. You can also export the payment plan as CSV from the Results page.

---

## Troubleshooting

**My data disappeared.**
> You may have cleared browser storage. Use *Export Debts (JSON)* regularly as a portable backup you can re-import at any time.

**Import says "duplicate skipped" but I wanted to update the debt.**
> Delete or rename the existing debt first, then re-import, or use inline editing to update the debt manually.

**The payoff date is very far away.**
> Try increasing your monthly payment, switching to Avalanche, or using the What-If Simulator to see how much extra you need.

**The payment is less than the minimum required.**
> The app will show an error. Your total monthly budget must cover every debt's minimum payment.

**A debt shows a ⚠️ neg-amort badge.**
> Your minimum payment is too low to cover monthly interest on that debt. Increase the minimum payment or reduce the APR (e.g. by transferring to a lower-rate card).

---

**Start your journey to being debt-free today!** 💰


