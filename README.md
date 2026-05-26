# Debt Tracker Application

A modern, single-page web application that helps you plan and visualise a path to becoming debt-free. All calculations happen locally in your browser — no accounts, no servers, no tracking.

---

## Features

### Debt Management
- **Add unlimited debts** — credit cards (revolving balance with APR) or fixed-amount recurring payments (subscriptions, rent, instalments)
- **Inline editing** — edit any debt directly on the Debts page without leaving the list
- **Update Balance** — quickly record a new balance for any credit-card debt while preserving the original balance for progress tracking
- **Category labels** — tag debts (e.g. "Housing", "Credit Card") and filter the list by category
- **Priority levels** — assign a 1–10 priority to each debt for custom strategy ordering

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

### Calendar View
- One calendar month per page, paginated forward through the entire plan
- Debt payment events pinned to each debt's due date, colour-coded by debt
- Today's date highlighted

### Interest Paid to Date
- Record the date you opened each credit-card debt (`debtStartDate`)
- The app estimates the interest you have already paid using daily compounding on the original balance, minus the principal you have paid down
- Shown on each debt card, in the summary table, and persisted to localStorage

### Data Management
- **Persistent storage** — debts, stimulus data, monthly payment, and strategy are auto-saved to `localStorage`
- **Export to CSV** — full payment schedule plus per-debt summary in one file
- **Clear All Data** — wipe everything and start fresh

---

## How to Use

### 1 — Add your debts

Navigate to **Add Debt**.

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

Click **Add Debt**. Repeat for every debt.

### 2 — Set your strategy

Navigate to **Strategy**.

1. Enter your **Total Monthly Payment** — the total you can put toward all debts each month.
2. Choose a **Payment Strategy** (see below).
3. Optionally set a **Target Payoff Date** and click *Calculate Required Payment* to see the minimum monthly payment needed.
4. Click **Calculate Payment Plan**.

### 3 — Review the Results

The Results page has three tabs:

| Tab | Contents |
|-----|----------|
| **Table** | Monthly schedule with per-debt payments and editable stimulus column; debt summary table with progress bars; strategy comparison panel; what-if simulator |
| **Charts** | Payoff timeline (per-debt lines), cumulative progress chart, principal vs. interest doughnut |
| **Calendar** | Month-by-month calendar with payment events on due dates |

### 4 — Export

Click **Export as CSV** on the Results page to download a spreadsheet-ready file.

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

To back up your data, use **Export as CSV** regularly.

---

## Troubleshooting

**My data disappeared.**
> You may have cleared browser storage. Export to CSV regularly as a backup.

**The payoff date is very far away.**
> Try increasing your monthly payment, switching to Avalanche, or using the What-If Simulator to see how much extra you need.

**The payment is less than the minimum required.**
> The app will show an error. Your total monthly budget must cover every debt's minimum payment.

**A debt shows a ⚠️ neg-amort badge.**
> Your minimum payment is too low to cover monthly interest on that debt. Increase the minimum payment or reduce the APR (e.g. by transferring to a lower-rate card).

---

**Start your journey to being debt-free today!** 💰


