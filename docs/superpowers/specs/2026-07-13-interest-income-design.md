# Interest Income — Design (Issue #30)

**Date:** 2026-07-13
**Issue:** [#30 Interest Income](https://github.com/jasonkryst/MyFinances/issues/30)

## Summary

Accounts gain an optional annual interest rate (% APY). When the rate is
non-zero, the ledger projection auto-generates a monthly interest deposit
transaction for that account, dated the last day of each month. Because the
ledger is fully projected (no stored transactions), the interest transaction
is *generated* during projection, not persisted; the only persisted change is
the new `interestRate` field on the account record.

Generated interest transactions participate in the existing ledger
amount-override system, so users can replace the projected estimate with the
true amount posted by their bank — and subsequent months compound on the
overridden (honest) value.

## Decisions

| Question | Decision |
|---|---|
| Calculation | APY ÷ 12 × projected end-of-month balance; compounds month-over-month within the projection window. Override-aware. |
| Scope | Rate field on **all** account types; default 0% generates nothing. |
| Zero/negative balance | Skip interest that month (no negative-interest charges — debt interest is modeled in the Debts module). |
| Posting date | Last day of the month (`new Date(year, month + 1, 0)`). |

## Data model & persistence (`storage.js`)

- New account field: `interestRate` — annual APY percent, finite number,
  clamped to `[0, 100]`, default `0`.
- `sanitizeAccount()` gains:
  `interestRate: sanitizeFiniteNumber(record?.interestRate, 0, { min: 0, max: 100 })`
  so the field survives both `localStorage` load and JSON export/import.
- No export format version bump: the field is additive with a safe default,
  and legacy files without it sanitize to `0`.

## Accounts UI (`index.html`, `accounts.js`)

- **Add Account form:** new optional "Interest Rate (% APY)" number input
  (`id="accountInterestRate"`, `step="0.01"`, `min="0"`, placeholder `0.00`)
  with a help icon: a non-zero rate auto-creates a monthly interest deposit
  in the Ledger.
- **Inline edit card:** matching input `ac-rate-${id}` in the edit grid.
- **Account card:** when `interestRate > 0`, show a badge next to the type
  badge, e.g. `📈 2.50% APY`.
- `addAccount()` / `saveEditAccount()` read the field through
  `sanitizeFiniteNumber(value, 0, { min: 0, max: 100 })`; blank input means 0.

## Ledger generation (`ledger.js`)

Inside `buildProjectedAccountTransactions(app, startYear, startMonth,
monthsToProject)`, which iterates months chronologically:

1. Seed a per-account running balance map from each account's
   `startingBalance` (real accounts only — the `__unlinked__` sentinel never
   earns interest).
2. Record each account's transaction-list length at the start of each month's
   generation pass. (Length bookkeeping, not date filtering, defines "this
   month's transactions" — a bill with `dueDay` 31 generated for February
   date-overflows into March, but still belongs to February's pass.)
3. After the month's regular generators run, for each account with
   `interestRate > 0`:
   - `balance = carriedBalance + Σ getEffectiveAmount(tx)` over the
     transactions generated this pass (override-aware).
   - If `balance > 0`: `interest = round2(balance × rate / 100 / 12)`.
     If `interest > 0`, add a transaction:
     - `type: 'interest'`, `name: 'Interest'`, `category: 'Interest'`
     - `sourceId: account.id`, `accountId: account.id`
     - `date: new Date(year, month + 1, 0)` (last day of month)
     - deterministic `transactionId` via `makeLedgerTransactionId`
       (`interest|<acctId>|<acctId>|<YYYY-MM-DD>`), which makes the existing
       override modal work unchanged.
   - Carry forward `balance + effective interest` (the overridden amount if
     one exists) into the next month.
   - If `balance ≤ 0` or the rounded interest is `≤ 0`, generate nothing and
     carry `balance` forward unchanged.
4. All accounts carry balances forward every month regardless of rate, so an
   account whose balance goes positive mid-window starts earning then.

Consumers that inherit the feature automatically because they flow through
this one function: `getLedgerTransactionsForMonth` → `computeAccountBalance`
(Accounts-page projections), `getAccountForecastSeries` (Forecast tab),
`getLedgerTransactions` (Ledger page), and CSV export.

### Known simplification

A month projected in isolation (`monthsToProject = 1`, e.g. the Accounts
page's current-month "Proj." figure or a single future month) seeds the
running balance from `startingBalance` rather than from accumulated history.
This matches the simplification `computeAccountBalance` already makes for
every other transaction type, and the 12-month Ledger view remains the
compounding source of truth.

Reconciliation balance snaps (the `RECONCILIATION_ADJUSTS_BALANCE` setting)
apply at render time in `getLedgerTransactions` and are *not* fed back into
the interest base. Users who reconcile can override the interest transaction
with the true posted amount — which is the designed workflow for an honest
ledger.

## Reports (`reports.js`)

`reports.js` aggregates by explicit `tx.type` checks, so `'interest'` must be
added to the income-side aggregations (income totals, income-vs-expense
chart, monthly summary, category breakdowns). Every `tx.type` comparison site
will be enumerated during implementation and the income-side ones updated;
expense-side sites are untouched (interest is always a positive amount).

## Documentation

- `guide.html` — "Setting Up Accounts": add the rate row to the fields table
  plus a guide-note describing the auto-generated deposit, last-day-of-month
  posting, compounding, and the override workflow.
- `README.md` — mention interest income in the feature list.
- `docs/superpowers/CHANGELOG.md` — entry for the feature.

## Testing

Playwright/pytest, served at `http://localhost:5500/`.

**Features — positive** (`tests/features/test_accounts.py`,
`tests/features/test_ledger.py`):
- Add account with a rate → persisted, badge shown on card.
- Edit an account's rate inline → new rate persisted and displayed.
- $1,000 starting balance @ 12% APY → $10.00 interest transaction dated the
  last day of the current month in the Ledger.
- Compounding: month 2's interest exceeds month 1's in the 12-month view.
- Interest included in the account's projected end-of-month balance.
- Override an interest transaction → effective amount shown; the following
  month's interest compounds on the overridden value.
- Interest transactions included in Reports income totals.

**Features — negative:**
- Rate 0 (or field left blank) → no interest transactions.
- Negative or zero starting balance with no inflows → no interest
  transactions.
- Balance small enough that interest rounds below one cent → no transaction.
- Interest transaction is projection-only: nothing new persisted in
  `localStorage` beyond the account's `interestRate`.

**Security / storage** (`tests/features/test_storage_import.py`,
`tests/security/`):
- Import with `interestRate` of `-5` → clamped to 0; `200` → clamped to 100;
  `"abc"` / missing → defaults to 0.
- Export → import round-trip preserves a valid rate.

**Integration** (`tests/integration/`):
- Smoke: create an interest-bearing account, verify the deposit appears in
  the Ledger, flows into the Reports income total, and raises the Accounts
  page projection — in one workflow.

## Alternatives considered

- **Post-process interest in `getLedgerTransactions()`** — rejected: the
  single-month path (`getLedgerTransactionsForMonth`) would miss it, so
  projections, forecast, and reports would disagree with the Ledger page.
- **Auto-create a recurring template per account** — rejected: fixed-amount
  templates cannot track a changing balance, and templates orphaned by
  account deletion get messy.
- **Daily compounding (mirror `debtCalculator.js`)** — rejected: real
  complexity in the projection loop for pennies of difference; the override
  system exists precisely to correct estimates against reality.

## Implementation Status (2026-10-06)

- **Status**: Fully Implemented
- **What was built**: Shipped in v4.4.0. Accounts can carry an APY field; non-zero rates auto-generate a monthly Interest deposit in the Ledger on the last day of each month. Interest rows support ledger amount overrides with downstream compounding. Interest counts in Reports (stat strip, income-by-source, calendar, net-worth). APY badge shown on account cards. 23 Playwright tests added.
- **Deviations**: Monthly compounding was used instead of daily compounding (the spec explicitly records this as a decided rejection of daily compounding).
- **Superseded by**: Nothing.
