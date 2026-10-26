# Income Gross vs. Net Modeling — Design (Issue #251)

**Date:** 2026-10-25
**Issue:** [#251 Income: gross vs. net modeling (tax withholding per income source)](https://github.com/jasonkryst/MyFinances/issues/251)

## Summary

Every income record gains an optional `withholdingPercent` field (0–99.9,
default 0). When set, every cash-flow calculation in the app that currently
treats the entered paycheck `amount` as spendable cash (Health's DTI/cash-flow
card, the Ledger's running balance, Account projections, Forecast, the Cash
Flow / Money Flow / Variance reports, Home Purchase affordability, the
Strategy page's suggested-payment and income widgets) switches to the **net**
(take-home) amount: `amount * (1 - withholdingPercent / 100)`. The raw
entered `amount` stays "gross" and continues to be used as the literal
per-paycheck figure wherever the app simply echoes back what the user typed
(income cards' edit form, the payoff/report calendars' per-event tooltips).
A 0% (or unset) withholding percent is mathematically a no-op — net equals
gross — so every existing income record and every existing test that doesn't
care about this field is completely unaffected.

This unblocks (but does not implement) the "Net DTI" model from the DTI
multi-model feature (NEW-05): a Net DTI calculation can now divide debt
minimums by a real net-income figure instead of needing its own parallel
withholding concept.

## Decisions

| Question | Decision |
|---|---|
| Field shape | `withholdingPercent: number \| undefined`, clamped `[0, 99.9]`, default `0`. Optional — omitting it (or an old record predating this field) behaves exactly as before. |
| Does `computeMonthlyIncomeForMonth()` return gross or net? | **Net.** Per the issue's own acceptance criteria, it now applies withholding internally. Every one of its 7 call sites (enumerated below) is a cash-flow/affordability calculation that is more correct, not less, when fed net income — none of them needed the old gross semantics preserved. |
| Ledger / account-projection income transactions | Switched to net. This is the one place with its own code path (not through `computeMonthlyIncomeForMonth`) that needed an explicit change: `ledgerTransactions.js`'s per-payday transaction generator. Reports that aggregate from the generated ledger transaction stream (Cash Flow, Money Flow Sankey, Variance, Summary) inherit net automatically through that one choke point — no separate edits needed in those files. |
| Calendar event tooltips (Strategy payoff calendar, Reports calendar modal) | **Left as gross** (raw `inc.amount`). These views render the user's literally-entered per-paycheck figure next to the literally-entered bill/debt/bonus amounts for every other event type — none of which are net-of-anything — so changing only income here would be an inconsistent, confusing special case. Not part of the issue's explicit scope (income cards + Ledger only). |
| Where does gross still show? | The income card's inline edit form (still edits the raw `amount`), and a tooltip/secondary line on the read-only card. |
| Health DTI gross/net note | A small note under the DTI card's existing debt/income detail row: "Based on net income (after withholding)" when any income has `withholdingPercent > 0`, otherwise "Based on gross income (no withholding set)" (since with 0% withholding everywhere, net numerically equals gross — the note just states which basis is active). |
| Rounding/validation on the form | Same pattern as every other percent field in the codebase (e.g. account `interestRate`): `sanitizeFiniteNumber(raw, 0, { min: 0, max: 99.9 })`; a blank field means 0. |

## Every `computeMonthlyIncomeForMonth()` call site (grepped before changing its return semantics)

| File | Use | Effect of switching to net |
|---|---|---|
| `health.js` (current + prev month, DTI/savings/cash-flow card) | DTI ratio, savings ratio, monthly cash flow | More accurate — DTI/cash-flow against real take-home pay. New gross/net note added here. |
| `bills.js` (`renderCashFlowSummary`) | Cash Flow (Budget) page summary | More accurate net cash-flow summary. |
| `charts.js` (`renderDebtToIncomeChart`) | Debt-to-income donut chart | More accurate. |
| `homePurchase.js` (`computeMortgageAffordability`) | Front-end/back-end mortgage DTI ratios | More accurate — lenders qualify borrowers off net cash flow considerations too, and this reuses the same debt-minimum-driven ratio as Health. |
| `reportsNetWorth.js` (`computeNetWorthProjection`) | Net worth projection's monthly asset growth | More accurate — net worth should grow by actual take-home pay minus expenses, not gross pay (which was never fully realizable). |
| `strategy.js` (`suggestMonthlyPayment`, `renderStrategyIncomeWidget`) | Suggested debt payment, income-vs-obligations widget | More accurate — suggesting a payment based on gross pay could suggest an unaffordable amount. |
| `income.js` (`renderIncomeList`'s summary panel) | "Expected this month" / "Regular pay this month" aggregate figures | Now shows net; consistent with the per-card figure (see below). |

No call site relied on the old gross semantics in a way that would be broken
by this change — they're all cash-flow-style aggregates, not a "gross income"
display. The one place that still needs the literal gross figure
(`inc.amount` alone, not run through this function) is the income card's
per-item display and edit form, and the calendar views, none of which call
`computeMonthlyIncomeForMonth()`.

## Data model & persistence

- New income field: `withholdingPercent` — percent, finite number, clamped
  `[0, 99.9]`, default `0`.
- `sanitizeIncome()` (`src/sanitizers.js`) gains:
  `withholdingPercent: sanitizeFiniteNumber(record?.withholdingPercent, 0, { min: 0, max: 99.9 })`
  so it round-trips through load, export, and import (`sanitizeParsedState`
  already runs every income record through `sanitizeIncome` via
  `_sanitizeRecordArray`, so no separate wiring is needed there).
- No export format version bump: additive field, safe default, legacy files
  sanitize to `0`.
- New shared helper `computeNetIncomeAmount(income)` in `src/utils.js`:
  `(income?.amount || 0) * (1 - (income?.withholdingPercent || 0) / 100)`.
  Used by `computeMonthlyIncomeForMonth()` (replacing the raw `inc.amount *
  count` term) and by `ledgerTransactions.js`'s income-transaction generator,
  and by `income.js` for the per-card net display.

## Income UI (`index.html`, `income.js`)

- **Add Income form:** new optional "Tax Withholding (%)" number input
  (`id="incomeWithholding"`, `step="0.1"`, `min="0"`, `max="99.9"`,
  placeholder `0`) with a help icon clarifying it's optional and that leaving
  it at 0 means "Amount per Paycheck" is already being treated as take-home
  pay. The existing "Amount per Paycheck" help text is tweaked to mention
  gross vs. net.
- **Inline edit card:** matching input `ie-withholding-${id}` in the edit
  grid, pre-filled with the stored value (or blank/0).
- **Read-only income card:** the `income-card-amount` span now shows the
  **net** amount (`computeNetIncomeAmount(inc)`). When `withholdingPercent >
  0`, an adjacent small "Gross: {amount} ({pct}% withheld)" tooltip/secondary
  text is shown (title attribute + a visually-small inline span); when 0 (the
  default/backward-compatible case), net === gross and no extra UI renders,
  so existing income cards are visually unchanged.
- `addIncome()` / `saveEditIncome()` read the field via
  `sanitizeFiniteNumber(value, 0, { min: 0, max: 99.9 })`.
- Income summary panel ("Expected this month" / "Regular pay this month")
  continues to read from `computeMonthlyIncomeForMonth()`, which now returns
  net — no code change needed there beyond the utils.js change. The same
  panel's "Estimated annual" figure and the Income Trend chart
  (`renderIncomeTrendChart`, `#262`) have their *own* reduce logic over
  `app.incomes` (they don't call `computeMonthlyIncomeForMonth()`), so both
  were explicitly switched to `computeNetIncomeAmount()` too — otherwise the
  same page would show a net "Expected this month" right next to a gross
  "Estimated annual" and a gross trend chart, which would read as a bug, not
  a deliberate choice.

## Ledger / account projections (`ledgerTransactions.js`)

The income-transaction generator (`for (const inc of app.incomes || [])`
inside the month-projection loop) currently does
`amount: Number(inc.amount)`. This becomes
`amount: computeNetIncomeAmount(inc)`. Every consumer that flows through
`getLedgerTransactionsForMonth` (`computeAccountBalance` in `accounts.js`,
the Ledger page itself, `getAccountForecastSeries` in `forecast.js`, and the
Reports aggregations in `reportsCashFlow.js` / `reportsSummary.js` /
`reportsMoneyFlowSankey.js` / `reportsVariance.js`, all of which bucket by
`tx.type === 'income'` on the generated transaction stream) inherits net
automatically — no separate per-report edits needed. The Ledger row itself
already displays `tx.amount`, so it now shows net without further changes;
the existing amount-override system is untouched (a user can still override
an individual paycheck's posted amount with the exact figure their bank
deposited, same as today).

## Health DTI card (`health.js`)

Inside the existing `health-metric-detail` block (the two small lines
showing "`$X`/mo debt" / "`$X`/mo income"), a new line is added:
`<div class="health-dti-basis">{note}</div>` where `{note}` is computed from
whether any `app.incomes` entry has `withholdingPercent > 0`. New i18n keys
(`health.dtiBasisNet` / `health.dtiBasisGross`) are added to `en.js`, `es.js`,
and `pl.js` (health.js is one of the few currently-translated pages, so new
health strings get translations, matching existing per-locale coverage for
this page).

## Postgres sync

Following the `is_variable` / `category` column-add recipe
(`1755600000019_add-category-to-incomes.js`,
`1755600000020_add-is-variable-to-incomes.js`):

- New migration `1755600000022_add-withholding-percent-to-incomes.js`:
  `ALTER TABLE incomes ADD COLUMN IF NOT EXISTS withholding_percent numeric NOT NULL DEFAULT 0`
  (numeric, not integer/boolean, since the value can be e.g. `22.5`).
- `server/src/routes/incomes.js`'s `columns` map gains
  `withholdingPercent: 'withholding_percent'`. No sanitizer change needed —
  `server/src/sanitizers/index.js` re-exports `src/sanitizers.js` by relative
  path, so the frontend `sanitizeIncome()` change is picked up automatically
  server-side too.
- No route-handler logic change otherwise; `crudRouter.js`'s generic
  create/update/list/delete already handles any field present in both
  `columns` and the sanitizer output.

## Documentation

- `CLAUDE.md` — new bullet under "Cross-cutting features" describing the
  field, default/range, which functions return net vs. gross, and the
  migration/endpoint touched.
- `CHANGELOG.md` — new `6.37.0` entry.

## Testing

**Unit (Jest, `tests/unit/`):**
- `sanitizers.test.js` — `sanitizeIncome()`'s `withholdingPercent`: valid
  values (`0`, `15.5`, `99.9`), out-of-range/invalid values (negative, `100+`,
  non-numeric, `null`/`undefined`) all coerce to a safe default (clamped or
  `0`), and a round-trip (sanitize → re-sanitize is idempotent).
- `utils.test.js` — `computeMonthlyIncomeForMonth()`: 0%/unset withholding is
  a no-op (matches pre-existing gross behavior exactly), a non-zero
  withholding reduces the monthly total proportionally, and withholding
  composes correctly with multiple paydays/frequencies and with
  `computeMonthlyBonusesForMonth` (bonuses are never withheld).

**Features (Playwright, `tests/features/`):**
- `test_income.py` — add an income with a withholding % and see net
  displayed on the card with gross available via tooltip/secondary text;
  edit an existing income's withholding %; export/import round-trip
  preserves the field; a withholding value outside `0–99.9` is
  rejected/clamped per the form-validation pattern used elsewhere in
  `income.js`.
- `test_health.py` — DTI card shows the gross-income note by default (no
  withholding anywhere) and switches to the net-income note once an income
  with `withholdingPercent > 0` is injected.
- `test_versioning.py` — unaffected logic-wise; run as part of the version
  bump to confirm `APP_VERSION`/`CHANGELOG.md` stay in sync.

**Server (`server/test/`, `node --test`):**
- `crudResources.test.js` — extend/add an incomes-specific case asserting
  `withholdingPercent` round-trips through create and update, and defaults
  to `0` when omitted.
- Migration SQL reviewed for syntax (`ALTER TABLE ... ADD COLUMN IF NOT
  EXISTS ... numeric NOT NULL DEFAULT 0`, mirroring the exact shape of the
  `is_variable` migration) — the full `test-postgres` CI job is the
  authoritative signal since it runs migrations against a real Postgres
  instance; this is noted as the first real exercise of the migration if it
  can't be run locally.

## Alternatives considered

- **Make `computeMonthlyIncomeForMonth()` keep returning gross, and add a
  second `computeNetMonthlyIncomeForMonth()` for cash-flow call sites** —
  rejected: every single call site turned out to want net, so a parallel
  function would just be dead weight immediately duplicated at every call
  site; the issue's acceptance criteria also explicitly asks for
  `computeMonthlyIncomeForMonth()` itself to apply withholding.
- **Apply withholding only at the Ledger layer (leave
  `computeMonthlyIncomeForMonth()` gross)** — rejected: Health, Home Purchase,
  and Strategy don't go through the Ledger transaction stream at all (they
  call `computeMonthlyIncomeForMonth()` directly), so this would leave those
  cash-flow calculations silently wrong relative to the Ledger's.
- **Show gross as the primary figure on income cards with net as a secondary
  detail** — rejected: the issue explicitly asks for net as the primary
  displayed amount on cards, with gross relegated to the form/tooltip.
