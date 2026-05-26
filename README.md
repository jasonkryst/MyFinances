# Debt Tracker Application

A modern web application to help you manage and pay off your debts efficiently using various payment strategies.

## Features

### Core Functionality
- **Add Multiple Debts**: Track credit cards, student loans, personal loans, and more
- **Flexible Input**: Enter debt name, account balance, interest rate, and optional priority level
- **Multiple Payment Strategies**:
  - **Avalanche**: Pay highest interest rate first (saves the most money on interest)
  - **Snowball**: Pay lowest balance first (psychological wins)
  - **Priority Lowest First**: Pay debts you've marked as lowest priority first
  - **Priority Highest First**: Pay debts you've marked as highest priority first

### Calculation Features
- Monthly payment allocation to each debt
- Accurate interest calculations (**daily compounding**, matches credit card standards)
- Principal vs. Interest breakdown for each payment
- Estimated payoff date for each debt
- Total debt overview with payoff timeline
- **Per-month stimulus/bonus payments**: Add extra payments for any month, distributed by priority

### Data Management & UI
- **LocalStorage Integration**: All data is automatically saved to your browser
- **Export to CSV**: Download payment plans as CSV for spreadsheet analysis
- **Clear All Data**: Remove all debts and start fresh
- **Inline Editing**: Edit debts directly in the list, no need to switch pages
- **Multi-page Navigation**: Top navigation for Debts, Add Debt, Strategy, and Results

## How to Use

### 1. Adding Debts
1. Fill in the debt name (e.g., "Credit Card", "Student Loan")
2. Enter the current account balance
3. Enter the annual interest rate (e.g., 18.5 for 18.5%)
4. (Optional) Set priority level (1-100, where 100 is highest priority)
5. Click "Add Debt" or use the inline Edit button in the Debts list to update existing debts

### 2. Setting Up Payment Strategy
1. Enter your total monthly payment amount
2. Select your preferred payment strategy:
  - **Avalanche (Recommended)**: Mathematically optimal - saves the most on interest
  - **Snowball**: Psychology-focused - quick wins with smallest debts
  - **Priority-based**: Manual control over which debts to tackle first
3. (Optional) Enter extra "stimulus" payments for any month in the Results table
4. Click "Calculate Payment Plan" (auto-navigates to Results)

### 3. Understanding the Results

The Results page shows:
- **Monthly Payment Schedule**: Table with months as rows, debts as columns, and a per-month stimulus input column. Edit stimulus for any month to see the effect instantly.
- **Debt Summary**: Total paid, principal, interest, and estimated payoff date for each debt.
- **Chart View**: Visualize balances over time.

### 4. Exporting Data
Click "Export as CSV" to download your payment plan for use in spreadsheets or other tools.

## Payment Strategies Explained

### Avalanche Method
- Pays minimum on all debts except the one with the highest interest rate
- Excess money goes to highest interest rate debt
- **Best for**: Saving money long-term
- **Example**: If you have a 20% credit card and 5% car loan, pay the credit card first

### Snowball Method
- Pays minimum on all debts except the one with the lowest balance
- Excess money goes to lowest balance debt
- **Best for**: Quick psychological wins
- **Example**: If you have a $500 and $5,000 debt, pay off the $500 first

### Priority Methods
- Allows you to manually set which debts to tackle first (1-10 scale)
- Useful if some debts feel more urgent due to circumstances
- **Best for**: Personal situations where financial optimization isn't the only goal

## Data Storage

All your debt information is automatically saved to your browser's localStorage. This means:
- ✅ Your data persists between sessions
- ✅ Your data stays on your local device (not sent to any server)
- ✅ Clearing browser data will remove your debt tracker data

To back up your data, export it as CSV regularly.

## Tips for Success

1. **Be Realistic**: Only enter a monthly payment amount you can actually afford
2. **Use Avalanche**: If you want to save the most money on interest
3. **Use Snowball**: If you need quick motivational wins
4. **Set Priorities**: If certain debts feel more urgent
5. **Check Regularly**: Update your debts as you pay them off
6. **Emergency Buffer**: Don't commit your entire available funds - keep some for emergencies

## Technical Details

### Files
- `index.html` - Main HTML structure
- `styles.css` - Responsive styling
- `debtCalculator.js` - Debt calculation engine
- `app.js` - Application logic and UI management

### Browser Requirements
- Modern browser with JavaScript enabled
- LocalStorage support
- Tested on Chrome, Firefox, Safari, and Edge

### Formulas

**Daily Compounding Interest Calculation (per month):**
```
monthlyInterest = balance × ( (1 + (annualRate / 100 / 365))^daysInMonth - 1 )
```
Where:
- `balance` = current debt balance
- `annualRate` = annual interest rate (e.g., 18 for 18%)
- `daysInMonth` = number of days in the current month

**Payment Allocation:**
1. Calculate interest for all debts
2. Allocate based on strategy order
3. Minimum payment covers interest + some principal
4. Excess payment goes to highest priority debt (by strategy)

## Troubleshooting

**Q: My data disappeared!**
- A: Check if you cleared your browser's cache/storage
- Recovery: You would need to re-enter your debts unless you had an export

**Q: The payoff date seems too far away**
- A: Try increasing your monthly payment or using the Avalanche strategy to save on interest

**Q: Can I edit a debt after adding it?**
- A: Yes! Click the Edit button next to any debt to update it inline.

**Q: Is my data secure?**
- A: Yes, your data never leaves your computer - it's stored locally in your browser

## Privacy & Security

- ✅ All calculations happen in your browser
- ✅ No data is sent to any server
- ✅ No tracking or analytics
- ✅ No third-party services
- ✅ Completely private and secure

## Future Enhancements

Potential features for future versions:
- Extra payment calculator (one-time lump sum payments)
- Debt consolidation analysis
- Income/expense tracker integration
- Payment reminders
- Mobile app version
- Multi-device sync (with user account)

## License

This application is free to use for personal financial management.

---

**Start your journey to being debt-free today!** 💰
