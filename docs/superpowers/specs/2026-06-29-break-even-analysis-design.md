# Break-Even Analysis per Debt — Design Spec

**Date:** 2026-06-29
**Status:** Approved
**Priority:** MEDIUM | Effort: LOW

---

## Overview

For each credit-card debt, show a side-by-side payoff comparison: the user's current plan payment vs. minimum-payment only. Users see exactly how much faster they'll pay off debt with their plan and how much interest they save.

---

## Architecture

### New module: `src/breakEven.js`

A dedicated module that owns all break-even calculation logic. Both `debts.js` and `strategy.js` import from it.

**Primary export:**

```js
computeBreakEven(debt, options)
// options: { minType: 'fixed' | 'percent', minPct: number, planPayment?: number }
// returns: { planMonths, planInterest, minMonths, minInterest, monthsSaved, interestSaved, balanceOverTime }
// returns null for fixedAmount debts
```

**Internal behavior:**

Runs `DebtCalculator.calculatePaymentPlan()` twice for credit-card debts:

1. **Plan scenario** — uses `options.planPayment` when provided (actual monthly allocation from `_debtSummaryRows` when a plan is active), otherwise falls back to `debt.minimumPayment`.
2. **Minimum-only scenario** — payment is:
   - `fixed` mode: `debt.minimumPayment` held constant each month
   - `percent` mode: `max(debt.minimumPayment, balance × minPct / 100)` recalculated each month (simulated via per-month payment array)

`balanceOverTime` is an array of `{ month, planBalance, minBalance }` sampled from both simulation runs — consumed by mini-charts.

Returns `null` for `fixedAmount` debts (no interest, no meaningful comparison).

---

## UI: Debt Cards (Debts Page)

Each credit-card debt card gets a **Payoff Analysis section** below existing details.

### State 1 — No plan run yet

- A "Show Payoff Analysis" link is shown
- Clicking it runs a **minimum-only estimate** (single scenario, not a comparison — there is no "your plan" payment to compare against)
- The badge shows only the minimum-payment projection: payoff date, total interest, and months to payoff
- A persistent banner reads: *"Estimate only — no plan calculated. Run a plan on the Strategy page to see your interest savings."*
- The "Accelerate this debt →" button is still shown so the user can jump to the Plan page

### State 2 — Plan has been run

- Badge renders automatically on `renderDebtsList()` using the plan payment from `_debtSummaryRows`
- No "Show" link needed; no disclaimer banner

### Badge layout

```
┌─────────────────────────────────────────────────┐
│  Payoff Analysis         [Fixed ▾] [2% ▸]       │
│                                                  │
│  Your plan:  Dec 2026 · 7 mo · $285 interest    │
│  Min only:   May 2028 · 19 mo · $1,200 interest │
│                                                  │
│  You save $915 and 12 months!                    │
│                                                  │
│  [mini Chart.js line chart — 2 lines]            │
│                                                  │
│  [Accelerate this debt →]                        │
└─────────────────────────────────────────────────┘
```

- The min-type toggle (Fixed / %) and percent input appear only in percent mode
- Changing either re-runs `computeBreakEven()` and re-renders inline (no page reload)
- Mini Chart.js chart reuses the existing `Chart` global; destroyed/recreated on re-render to avoid canvas leaks
- `fixedAmount` debts show no badge

---

## UI: Plan Page Summary Table (`strategy.js`)

Two new columns added to the per-debt summary table in `displayDebtSummary()`:

| Column | Source | Format |
|---|---|---|
| Interest Saved | `computeBreakEven(debt).interestSaved` | Currency, green when > 0 |
| Months Saved | `computeBreakEven(debt).monthsSaved` | Integer, green when > 0 |

- Both columns are sortable (consistent with existing sort behavior)
- `fixedAmount` debts show `—` in both columns
- Minimum type used for table columns: **fixed** (no toggle — toggle lives on the card)
- Footnote below table: *"Interest/months saved vs. minimum-payment-only scenario."*
- `displayDebtSummary()` calls `computeBreakEven()` per debt when building rows (single-debt simulation, cheap)

---

## UI: Accelerate Modal (`#accelerateDebtModal`)

New modal opened by "Accelerate this debt →" button on any debt card.

### Layout

```
┌──────────────────────────────────────────────┐
│  Accelerate: Visa                        [✕]  │
│                                              │
│  Current plan payment:  $450/mo              │
│  Extra payment:  [$____] /mo                 │
│  ─────────────────────────────────────────── │
│  New total:  $600/mo                         │
│                                              │
│  Payoff:   Aug 2026  (5 months)  ▲ 2 faster │
│  Interest: $198      ▲ $87 saved             │
│                                              │
│  [mini chart updates live]                   │
│                                              │
│  [Apply to Plan]   [Close]                   │
└──────────────────────────────────────────────┘
```

### Behavior

- Extra payment field: plain number input (no slider — avoids inline style CSP issues)
- Preview updates on every `input` event via `computeBreakEven()`
- Negative or blank input clamped to 0
- **"Apply to Plan"**: navigates to Plan page, sets `#monthlyPayment` to `currentPlanPayment + extraPayment`, calls `app.calculatePaymentPlanFromInputs()` automatically
- If no plan has been run, "current plan payment" shows stored `minimumPayment`
- Modal follows existing focus-trap + Escape-to-close pattern (same as `updateBalanceModal`)

---

## Data Flow

```
renderDebtsList()
  └─ per credit-card debt:
       ├─ no plan: render "Show Payoff Analysis" link + no-plan banner
       └─ plan active: computeBreakEven(debt, { planPayment: from _debtSummaryRows })
            └─ render badge + mini-chart + Accelerate button

displayDebtSummary()  [strategy.js]
  └─ per credit-card debt:
       └─ computeBreakEven(debt, { minType: 'fixed', planPayment: from summary })
            └─ populate interestSaved, monthsSaved columns

accelerateDebtModal oninput
  └─ computeBreakEven(debt, { planPayment: basePay + extra })
       └─ update live preview + mini-chart
```

---

## Security & CSP Compliance

- All user-visible strings go through `escapeHtml()` before `innerHTML`
- No inline `style=""` attributes — chart sizing via CSS classes, progress colors via CSS custom properties
- No `eval()` or `Function()` — consistent with existing engine
- New `<canvas>` elements for mini-charts get `renderChartDataTable()` calls for screen-reader accessibility

---

## Testing

### Positive cases
| Test | What it verifies |
|---|---|
| `test_break_even_badge_no_plan` | Debt card shows "Show Payoff Analysis" link + no-plan banner when no plan run |
| `test_break_even_badge_with_plan` | After running a plan, card auto-shows interest saved and months saved |
| `test_break_even_min_type_toggle` | Switching Fixed→Percent re-renders with different numbers |
| `test_break_even_accelerate_modal_opens` | Clicking "Accelerate this debt" opens modal with correct debt name |
| `test_break_even_accelerate_preview_updates` | Typing extra payment updates payoff date and interest live |
| `test_break_even_apply_to_plan` | "Apply to Plan" navigates to Plan page and fills payment field |
| `test_break_even_plan_table_columns` | After plan, summary table shows Interest Saved and Months Saved columns |
| `test_break_even_fixed_amount_debt_excluded` | Fixed-amount debts show no badge or table columns |

### Negative cases
| Test | What it verifies |
|---|---|
| `test_break_even_zero_interest_debt` | 0% APR: interest saved = $0, months saved = 0, no crash |
| `test_break_even_minimum_covers_balance` | Balance = minimum payment: both scenarios = 1 month, savings = $0 |
| `test_break_even_invalid_percent` | 0% or blank percent input falls back gracefully to fixed mode |
| `test_break_even_accelerate_zero_extra` | $0 extra in modal shows same numbers as base plan |
| `test_break_even_accelerate_negative_input` | Negative extra payment clamped to 0 |

---

## Files Changed

| File | Change |
|---|---|
| `src/breakEven.js` | New module — calculation engine |
| `src/debts.js` | Badge rendering, "Show" link, Accelerate button wiring |
| `src/strategy.js` | Two new summary table columns + footnote |
| `src/app.js` | Import breakEven module, wire accelerate modal method |
| `index.html` | Accelerate modal markup |
| `src/styles.css` | Badge, savings highlight, mini-chart container styles |
| `tests/features/test_break_even.py` | 13 new test cases |
