# MyFinances Usage Guide

Welcome to **MyFinances**, your privacy-first personal finance tracker. This guide walks you through every feature step-by-step.

---

## Table of Contents

1. [Getting Started](#getting-started)
2. [Adding Debts](#adding-debts)
3. [Setting Up Accounts](#setting-up-accounts)
4. [Tracking Income](#tracking-income)
5. [Managing Your Budget](#managing-your-budget)
6. [Creating a Payment Plan](#creating-a-payment-plan)
7. [Understanding Results](#understanding-results)
8. [Viewing Transactions](#viewing-transactions)
9. [Data Management](#data-management)
10. [Tips & Tricks](#tips--tricks)

---

## Getting Started

### What is MyFinances?

MyFinances is a **browser-based debt and budget tracker** that helps you:
- Track all your debts (credit cards, loans, subscriptions)
- Plan income and budget spending
- Calculate optimal debt payoff strategies
- Visualize your financial data with charts
- Manage everything offline with **no servers**

### Key Features at a Glance

- 📊 **Ledger** — See all transactions (income, bills, expenses, debt payments) filtered by account and date range
- 💳 **Debts** — Add and manage all your debts with interest calculations
- 🏦 **Accounts** — Define your bank accounts, credit cards, and other financial accounts
- 💰 **Income** — Track income sources and payday schedules
- 📋 **Budget** — Set bills and expense targets
- 📈 **Reports** — View calendar, charts, and money flow analysis
- 🎯 **Plan** — Calculate optimal debt payoff strategies and see detailed schedules

### Navigation

- **Tabs** at the top of the page switch between features
- **Back / Forward arrows** at the top-left let you navigate calendar months
- **Settings buttons** (⬇ Export, ⬆ Import, 🌙 Dark Mode) are in the top-right corner
- **Help icon** (❓) opens this guide

---

## Adding Debts

### Why Add Your Debts?

The Plan feature uses your debts to calculate the fastest and cheapest way to pay them off. The more accurate your debt info, the better your plan.

### How to Add a Debt

1. Click the **Debts** tab
2. Fill out the **Add Debt** form on the left:

| Field | What to Enter | Notes |
|-------|---------------|-------|
| **Debt Name** | Any label | e.g., "Visa", "Car Loan", "Student Loans" |
| **Debt Type** | Choose one | **Credit Card** = revolving balance with APR; **Fixed Amount** = recurring fixed cost |
| **Balance / Amount** | Current amount owed | For credit cards: current balance; For fixed: monthly cost |
| **APR** | Annual interest rate | Only for credit cards (e.g., `18.9` for 18.9%) |
| **Minimum Payment** | Required monthly payment | Only for credit cards |
| **Due Date** | Day of month it's due | Optional; used for calendar view |
| **Priority** | 1 (low) to 10 (high) | Used by Priority-based strategies |
| **Opened Date** | When you opened this account | Optional; helps calculate interest already paid |
| **Category** | Tag for organization | e.g., "Credit Card", "Housing", "Auto" |

3. Click **Add Debt**
4. Your debt appears in the list on the right

### Editing a Debt

- Click the **Edit** button on any debt card to populate the form
- Make changes and click **Add Debt** again to save
- Or click **Delete** to remove the debt

### Types of Debts

**Credit Card Debts:**
- Have a balance that decreases as you pay
- Accrue daily compounding interest
- Examples: Visa, MasterCard, store credit cards

**Fixed Amount Debts:**
- A recurring fixed cost that doesn't change
- No interest calculation
- Examples: Rent, car payment, subscription services, monthly instalments

---

## Setting Up Accounts

### Why Add Accounts?

Accounts help you organize where your money flows. When you add income, debts, bills, or expenses, you can assign them to specific accounts to track your cash flow per account.

### How to Add an Account

1. Click the **Accounts** tab
2. Fill out the **Add Account** form:

| Field | What to Enter |
|-------|---------------|
| **Account Name** | e.g., "Chase Checking", "Discover Card", "Emergency Fund" |
| **Account Type** | Checking, Savings, Cash, Investment, Credit Card, Loan, Other |
| **Starting Balance** | Your current balance in this account |

3. Click **Add Account**
4. Each account card shows:
   - Current starting balance
   - **Projected end-of-month balance** (starting balance ± all linked income, bills, expenses, debt payments this month)

### Linking to Accounts

When you add **income**, **debts**, **bills**, or **expenses**, you can select which account they belong to. This ensures your projected account balance is accurate.

---

## Tracking Income

### Why Track Income?

Income data helps you:
- Calculate how much you can spend monthly
- Understand debt-to-income ratio
- Plan more realistic payment strategies

### How to Add Income

1. Click the **Income** tab
2. Fill out the form:

| Field | What to Enter | Notes |
|-------|---------------|-------|
| **Name** | Any label | e.g., "Main Job", "Freelance", "Side Gig" |
| **Amount per Paycheck** | Gross or net amount | Must be a number > 0 |
| **First Pay Date** | Your next payday | Format: YYYY-MM-DD |
| **Frequency** | Choose one | **Every other week** (26 paydays/year) or **Once per month** (12 paydays/year) |
| **Account** | Select an account | Optional; links this income to an account |

3. Click **Add Income**

### Understanding the Income Summary

The Income page shows:
- **Expected Income This Month** — total from all sources for the current calendar month
- **Paydays This Month** — how many paydays fall in the current month
- **Annual Estimate** — projected annual income

The **Plan** page also shows:
- **Debt-to-Income Ratio** — percentage of income going toward debt payments (⚠️ if > 40%)
- **Net Cashflow** — income minus all obligations (debt payments, bills, expenses)

---

## Managing Your Budget

### Bills vs. Expenses

**Bills** (left column):
- Fixed recurring costs you pay monthly
- Examples: Utilities, internet, insurance, rent, subscriptions
- You specify the **due day** of the month

**Expense Budgets** (right column):
- Variable spending targets
- Tracked with specific dates for calendar visibility
- Examples: Groceries, dining out, gym membership

### How to Add a Bill

1. Click the **Budget** tab
2. In the **Bills** section, fill out:

| Field | What to Enter |
|-------|---------------|
| **Name** | e.g., "Electric Bill", "Netflix" |
| **Monthly Amount** | What you pay each month |
| **Due Day** | Day of month it's due (optional) |
| **Category** | Choose from predefined categories |
| **Account** | Link to an account (optional) |

3. Click **Add Bill**
4. Bills appear in the list below

### How to Add an Expense Budget

1. In the **Expense Budgets** section (right column), fill out:

| Field | What to Enter | Notes |
|-------|---------------|-------|
| **Name** | e.g., "Groceries", "Entertainment" | Any label you want |
| **Cost** | Amount spent | Can be a one-time expense or monthly target |
| **Date** | When the expense occurred | Used for calendar and ledger dates |
| **Category** | Choose from predefined categories | Helps organize spending |
| **Account** | Link to an account (optional) | Tracks which account paid |

2. Click **Add Expense**
3. Expenses appear in the list below with their dates

### Editing or Deleting Bills & Expenses

- Click the **Edit** button on any item to modify it
- Click **Delete** to remove it
- Changes save immediately

### Cash Flow Summary

At the bottom of the Budget page, you'll see:

```
Income (this month)
  − Debt minimums
  − Bills
  − Budgeted expenses
= Net remaining
```

This shows how much money you have left each month after all obligations.

---

## Creating a Payment Plan

### What is a Payment Plan?

A **payment plan** calculates month-by-month how to pay off all your debts using your available monthly payment, showing:
- Which debts to pay first
- When each debt will be paid off
- How much interest you'll pay
- What strategies save you the most money

### How to Create a Plan

1. Click the **Plan** tab
2. Enter your **Monthly Payment Budget**:
   - The total amount you can put toward all debts each month
   - Must be at least the sum of all minimum payments

3. Choose a **Payment Strategy**:

| Strategy | Order | Best For |
|----------|-------|----------|
| **Avalanche** | Highest APR first | Saving the most interest money |
| **Snowball** | Lowest balance first | Psychological momentum / quick wins |
| **Priority – Low first** | Lowest priority number | Custom ordering |
| **Priority – High first** | Highest priority number | Tackle most important debt first |

4. (Optional) **Back-Calculate from Target Date**:
   - Click "🎯 Back-calculate from a target payoff date"
   - Enter your desired payoff date
   - Click "Calculate" → the app finds the required monthly payment

5. Click **Calculate Payment Plan**

### Understanding Results

Results appear in three tabs:

#### 📊 Overview
- **Strategy Comparison** — shows how your chosen strategy compares to all others (interest saved, months saved)
- **What-If Simulator** — drag a slider to add extra monthly payment and instantly see months/interest saved

#### 📋 Debt Summary
- Table of all debts with:
  - Minimum due
  - Interest rate
  - Principal paid
  - Interest paid
  - Payoff date
  - Progress bar
- Click a debt name to see its monthly amortization schedule in a modal

#### 📅 Schedule
Three sub-tabs:

**Tabular:**
- Rows = months, Columns = each debt + Stimulus column + Total
- Click any cell in the **Stimulus** column to add a one-time extra payment for that month
- Plan recalculates instantly

**Calendar:**
- Month-by-month calendar view
- Shows bill due dates, expense dates, income paydays, and debt payments
- Navigate forward with arrows

**Chart:**
- **Payoff Timeline** — one line per debt showing balance declining to zero
- **Cumulative Progress** — Total Paid, Principal, Interest lines
- **Principal vs. Interest** — doughnut chart
- **Balance Distribution** — pie chart
- **Debt-to-Income** — pie chart (if income sources exist)

---

## Viewing Transactions

### The Ledger Tab

The **Ledger** shows a complete running list of all transactions (income, bills, expenses, debt payments) sorted by date.

### Filtering the Ledger

1. **Account Filter** — dropdown to show transactions from one account or all accounts
2. **Date Range Filter** (default: **Next 30 Days**):
   - **All** — every transaction
   - **Past & Today Only** — transactions up to today
   - **Next 30 Days** — today plus next 29 days
   - **Through Next Month** — through the last day of next month
   - **Next 60 Days** — 60-day window
   - **Next 90 Days** — 90-day window
   - **Toggle Future Transactions** — hide or show transactions dated in the future

### Understanding the Ledger Display

Each row shows:
- **Date** — when the transaction occurred
- **Account** — which account it's in
- **Description** — name of the transaction (debt name, bill name, income name, expense name)
- **Type** — Income, Bill, Expense, Debt Payment, or Bonus
- **Amount** — positive (income/expense) or negative (debt payment)

---

## Data Management

### Exporting Your Data

**Why Export?** Create portable backups you can restore anytime, anywhere.

1. Click the **⬇ Export** button (top-right)
2. Choose **Export JSON**
3. A `.json` file downloads containing:
   - All debts
   - All income sources
   - All accounts
   - All bills and expenses
   - Your current strategy settings
   - Export timestamp

**Tip:** Export regularly (weekly or monthly) as insurance against accidental data loss.

### Importing Your Data

1. Click the **⬆ Import** button
2. Select a `.json` file you previously exported
3. Choose how to import:

| Choice | Behavior |
|--------|----------|
| **OK (Replace)** | All data is replaced by the file (debts, income, bills, expenses, strategy) |
| **Cancel (Merge)** | Imported debts are **appended** (duplicates by name are skipped); income, bills, expenses, and strategy are **replaced** |

**Tip:** Use **Merge** to combine data from multiple backups without losing existing debts.

### Exporting Schedule to CSV

From the **Plan** page (Schedule tab, Tabular sub-tab):
- Click **📥 Export to CSV**
- Opens your payment schedule in Excel or Google Sheets
- Includes monthly payment details and per-debt summary

### Clearing All Data

1. From any page, click **Clear All Data** (in the results panel on Plan page, or use the menu)
2. Confirm the prompt
3. All debts, income, accounts, bills, expenses, and strategy are deleted
4. The app resets to empty state

**⚠️ Warning:** This cannot be undone. Export first if you want to keep your data.

---

## Tips & Tricks

### Tip 1: Start with Your Debts

Accurate debt data is crucial. Spend time entering:
- Current balance
- Correct APR (check your statement)
- Actual minimum payment

### Tip 2: Use Categories

Assign **categories** to debts and expenses. Helps you organize and later filter.

### Tip 3: Link Everything to Accounts

When you add income, debts, bills, or expenses, select the account it belongs to. Your account **projected balance** will then be accurate.

### Tip 4: Run All Strategies

Always compare your chosen strategy to all others on the **Strategy Comparison** panel. Sometimes Snowball pays off faster, sometimes Avalanche saves more interest.

### Tip 5: Use the What-If Simulator

On the **Overview** tab, drag the extra payment slider to see how an extra $50, $100, or $500/month impacts your payoff date and total interest.

### Tip 6: Check Your Income Settings

If you notice unexpected paydays in the calendar:
1. Go to **Income**
2. Check the **First Pay Date** — the app projects forward from this date
3. Adjust if needed

### Tip 7: Monitor Cash Flow

Keep an eye on the **Cash Flow Summary** on the Budget page. If it's negative, you're spending more than you earn — adjust your plan.

### Tip 8: Update Balances Regularly

As you pay down debts, click **Update Balance** on the debt card to record the new balance. The app keeps the original balance for progress tracking.

### Tip 9: Distinguish Bills from Expenses

- **Bills** = recurring fixed costs (rent, utilities, insurance)
- **Expenses** = variable spending you want to track (groceries, dining, shopping)

This distinction helps your budget and plans be more accurate.

### Tip 10: Use Dark Mode for Night

Click the **🌙** button in the top-right to toggle dark mode. Great for late-night budgeting!

---

## Keyboard Shortcuts & Quick Actions

While there are no traditional keyboard shortcuts, here are quick actions:

- **Export** — Click ⬇ in the top-right → Download backup
- **Import** — Click ⬆ in the top-right → Upload backup
- **Dark Mode** — Click 🌙 in the top-right
- **Help** — Click ❓ in the top-right (opens this guide)
- **Inline Edit** — Click **Edit** on any card to modify in place

---

## Troubleshooting

### Q: Where is my data stored?
**A:** All data is stored in your browser's `localStorage`. It's only on your computer, never sent to any server.

### Q: My data disappeared! What do I do?
**A:** If you cleared your browser cache or storage, your data is gone. To prevent this:
- Use **Export JSON** regularly (weekly or monthly)
- Keep backups on Google Drive, OneDrive, or your computer

### Q: Can I use MyFinances on my phone?
**A:** Yes! It works in any modern web browser (Chrome, Firefox, Safari, Edge) on desktop, tablet, or phone.

### Q: Can I share my data with someone?
**A:** Yes! Export your data as JSON and send the file. They can then **Import** it into their own instance.

### Q: Why is my projected account balance wrong?
**A:** Make sure you've:
1. Set your **Starting Balance** correctly on the Accounts page
2. Linked all income, debts, bills, and expenses to the correct account
3. Set the correct due dates for bills

### Q: The Plan shows very high interest. What can I do?
**A:** Try these:
1. **Increase your monthly payment** — use the What-If Simulator to see impact
2. **Switch to Avalanche strategy** — prioritizes highest APR debts
3. **Focus on high-APR debts** — pay minimums on others, extra to the worst offender
4. **Transfer to a lower-rate card** — if possible, reduce APR on the worst debt

### Q: Why does it say my payment is "less than minimum required"?
**A:** Your monthly payment budget is less than the sum of all debt minimum payments. Increase your monthly payment in the Plan section.

### Q: Can I delete a debt after I pay it off?
**A:** Yes! Click the **Delete** button on the debt card. Or use **Edit** to mark it as paid by setting Balance to $0.

---

## Glossary

| Term | Definition |
|------|-----------|
| **APR** | Annual Percentage Rate — the yearly interest rate on a debt |
| **Minimum Payment** | The smallest amount your lender requires you to pay monthly |
| **Avalanche** | Pay highest-APR debts first (saves the most interest) |
| **Snowball** | Pay lowest-balance debts first (quick psychological wins) |
| **Amortization** | A schedule showing how a loan is paid down over time |
| **Principal** | The original debt amount (not including interest) |
| **Daily Compounding** | Interest accrues every day based on your current balance |
| **Stimulus** | Extra one-time payment added to your regular monthly payment |
| **Ledger** | A complete transaction log (income, bills, expenses, payments) |
| **Cash Flow** | The movement of money in and out of your accounts |
| **Debt-to-Income Ratio** | Monthly debt payments ÷ monthly gross income (%) |

---

## Need More Help?

- **Check the README.md** — Technical details and feature overview
- **Review the Examples** — Try adding sample debts and income to explore
- **Export and Explore** — Export your data to see the JSON structure

**Happy budgeting! 💰**
