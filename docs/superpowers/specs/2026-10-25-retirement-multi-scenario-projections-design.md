# Retirement Multi-Scenario Projections — Design

Issue: #264 — "Retirement: multi-scenario projections (conservative / moderate / aggressive)"

## Context

The Retirement page (`src/retirement.js` / `src/retirementCalculator.js`, shipped
v5.0.0, see `2026-09-07-retirement-accounts-dashboard-design.md`) projects each
account's value at `app.retirementTargetDate` using a single constant annual
rate of return — the account's own `rateOfReturn` field —
via `computeRetirementProjection(currentBalance, monthlyContribution,
annualRatePct, monthsUntilTarget)`. The projection panel shows one number per
account plus a combined total, and issue #345's withdrawal-rate slider turns
that single total into one "monthly income in retirement" estimate. A single
constant-rate line gives false precision: market returns vary widely year to
year, and a user has no way to see how sensitive their plan is to that
assumption. This issue adds a three-line conservative/moderate/aggressive band
to both the projection chart and the summary numbers, without touching the
existing single-rate `computeAccountProjection`/`computeRetirementProjection`
call sites used elsewhere (archived-account exclusion, pension logic, the
contribution-limit tracker, etc. are all unaffected).

## Goals

- `computeRetirementProjection()` keeps its existing signature and single-rate
  behavior (it has other callers — see below); a new scenario layer is built
  on top of it rather than replacing it.
- A new "Projected Growth" line chart on the Retirement page shows three lines
  (conservative / moderate / aggressive) with a legend, over the horizon to
  `retirementTargetDate`.
- A new scenario summary table shows each account's (and the combined) balance
  at the target date for all three scenarios.
- The conservative/aggressive rates are derived from each account's own
  `rateOfReturn` by a user-configurable delta (default −2 / +3 percentage
  points), not three flat global rates — see "Design decision" below.
- `renderChartDataTable()` gains a new call for the projection chart with all
  three scenario columns.

## Non-goals

- Changing `computeRetirementProjection()`'s signature or any of its other
  call sites (pension contribution projection is untouched — it doesn't use
  a rate of return at all).
- The deferred Coast FIRE calculation (#346) — explicitly out of scope,
  already deferred pending an independent target-balance input.
- Per-account visual scenario badges on the account cards (out of scope —
  the summary table and chart are where scenarios are surfaced).
- Persisting the scenario deltas per-account — they're one global pair of
  settings applied uniformly (matches the existing single global withdrawal
  rate setting's pattern, not a new per-account schema field).

## Design decision: how conservative/aggressive are derived

The issue is explicit that "per-account rate of return field is still
honored (used as the moderate baseline per account)" — i.e. **moderate must
stay exactly what `computeAccountProjection()` already returns, per account**,
not a single flat 7% applied to every account regardless of what the user
configured. That requirement rules out "three independent flat global rates
that override the per-account rate for scenario purposes": if account A is set
to 4% (bonds-heavy) and account B to 9% (equities-heavy), flattening both to a
global 7% moderate for scenario purposes would silently contradict the user's
own per-account assumption for two of the three lines whenever their account
isn't near 7%.

Instead, conservative/aggressive are **the account's own rate plus a
delta**, clamped to the same `[0, 100]` bound `rateOfReturn` already uses:

```
conservative = clamp(moderate_rate + conservativeDelta, 0, 100)
aggressive   = clamp(moderate_rate + aggressiveDelta,   0, 100)
```

Defaults: `conservativeDelta = -2`, `aggressiveDelta = +3`. For the common
case of a 7%-rate account (the suggested default in most retirement
calculators, and the existing test fixtures' default `rate='7'`), this
produces exactly the issue's suggested 5% / 7% / 10% band — while an account
set to 4% produces 2% / 4% / 7%, preserving the user's own relative
assumption instead of overwriting it. The two deltas are the "configurable
default rates" the acceptance criteria call for: they're global settings
(`retirementScenarioConservativeDelta` / `retirementScenarioAggressiveDelta`,
via the existing `getSetting`/`setSetting` mechanism, same pattern as
`RETIREMENT_WITHDRAWAL_RATE`), user-editable from two number inputs in the
projection panel, each clamped at entry (conservative delta to `[-20, 0]`,
aggressive delta to `[0, 20]` — a conservative scenario can't be more
optimistic than moderate, and vice versa; an out-of-range or non-numeric
entry is clamped to the nearest bound / reset to the default rather than
accepted verbatim).

Pension accounts are a special case: their projection
(`computePensionContributionProjection`) is driven by salary and contribution
rate, not a rate of return, so there's no principled "optimistic/pessimistic"
variant to derive. All three scenario values for a pension account are
identical (equal to its existing single projection) — the three-line
chart simply flatlines together for any pension contribution included in a
combined total, and the summary table shows the same number in all three
columns for that row, which reads clearly rather than fabricating a fake
spread.

## Design decision: the withdrawal-rate ("monthly income in retirement") panel

Decision: **extend it to show three withdrawal estimates (one per
scenario)**, not just the moderate one. `computeMonthlyWithdrawal()` is a
cheap, pure derivation (`balance * rate / 100 / 12`) of an already-computed
balance — since the scenario band now produces three balances for free,
showing only one withdrawal number would make the two halves of the same
panel visually inconsistent (a three-line chart above a single number below).
The existing `#retireMonthlyWithdrawalVal` element/id is left untouched and
keeps showing the **moderate** scenario's figure — this is exactly what it
showed before this change (the combined total via the existing
`computeAccountProjection()`), so every existing Playwright assertion against
that id keeps passing unmodified. Two new elements,
`#retireMonthlyWithdrawalConservativeVal` and
`#retireMonthlyWithdrawalAggressiveVal`, are added alongside it, driven by the
same withdrawal-rate slider (one slider still controls the rate used by all
three — the "4%/6%/8%" safe-withdrawal-rate idea doesn't itself vary by
market-return scenario, only the balance it's applied to does).

## Architecture

### 1. `src/retirementCalculator.js` — new pure functions

```js
export const DEFAULT_CONSERVATIVE_DELTA = -2;
export const DEFAULT_AGGRESSIVE_DELTA = 3;

export function computeScenarioRates(moderateRatePct, conservativeDelta = DEFAULT_CONSERVATIVE_DELTA, aggressiveDelta = DEFAULT_AGGRESSIVE_DELTA)
// Clamps moderateRatePct to [0, 100] (defends against a stray negative rate
// slipping in), applies each delta (falling back to the matching DEFAULT_*
// when a delta isn't a finite number), clamps each result to [0, 100].
// Returns { conservative, moderate, aggressive }.

export function computeRetirementProjectionScenarios(currentBalance, monthlyContribution, moderateRatePct, monthsUntilTarget, conservativeDelta, aggressiveDelta)
// Calls computeScenarioRates(), then computeRetirementProjection() three
// times (once per rate) — the "or is called three times" option from the
// acceptance criteria, rather than changing computeRetirementProjection's
// own signature, which has other call sites (none currently pass an array,
// and keeping it scalar-only avoids an "is it an array or a number" branch
// at every existing call site). Returns
// { conservative, moderate, aggressive, rates }.

export function computeRetirementProjectionSeries(currentBalance, monthlyContribution, annualRatePct, monthsUntilTarget, sampleEveryMonths = 1)
// Single-rate month-by-month series (for the chart's X axis) — iterates
// once, recording a { month, balance } point every sampleEveryMonths and
// always including month 0 and the final month. monthsUntilTarget <= 0
// returns a single { month: 0, balance: currentBalance } point, mirroring
// computeRetirementProjection's own <= 0 short-circuit.
```

All three are pure/DOM-free, following the module's existing convention.
`computeRetirementProjection()` and `splitGrowthFromContribution()` are
unchanged.

### 2. `src/settings.js` — two new setting keys

```js
export const RETIREMENT_SCENARIO_CONSERVATIVE_DELTA = 'retirementScenarioConservativeDelta';
export const RETIREMENT_SCENARIO_AGGRESSIVE_DELTA = 'retirementScenarioAggressiveDelta';
```

Generic `{ key, value }` settings (same mechanism as
`RETIREMENT_WITHDRAWAL_RATE`) — no sanitizer/schema change needed;
`sanitizeSetting()` already accepts any numeric value, and
`sanitizeParsedState` already maps the whole `settings` array generically.

### 3. `src/retirement.js` — new exports and rendering

```js
export function computeAccountProjectionScenarios(app, accountId, conservativeDelta, aggressiveDelta)
// Per-account scenario band. Pension accounts: { conservative: p, moderate: p,
// aggressive: p, rates: { conservative: null, moderate: null, aggressive: null } }
// where p = the existing computeAccountProjection(app, accountId) (unchanged
// pension logic — total accumulated contributions, not rate-driven).
// Investment accounts: moderate is computeAccountProjection(app, accountId)
// itself (guarantees byte-for-byte parity with the existing single-scenario
// number); conservative/aggressive independently reconstruct the same
// current-balance/monthly-contribution inputs and call
// computeRetirementProjectionScenarios's underlying rate derivation.
// Returns null if no retirementTargetDate or the account doesn't exist
// (matches computeAccountProjection's existing null contract).
```

A module-local `computeCombinedProjectionSeries(app, accounts,
monthsUntilTarget, conservativeDelta, aggressiveDelta)` sums each
non-pension account's own per-scenario `computeRetirementProjectionSeries`
month-by-month (not by averaging rates — each account can have a different
absolute conservative/aggressive rate once its own delta-adjusted moderate
rate differs, so only summing full per-month balances is correct). Sample
interval scales with horizon (monthly under 2 years, quarterly under 10,
yearly beyond) to keep chart point counts reasonable for long horizons
without a new dependency.

`renderProjectionChart(app, accounts)` (new): builds `#retireProjectionChart`,
a 4th card in the existing `.rpt-charts-row`, as a 3-dataset Chart.js line
chart (red/blue/green, matching the house palette already used for
expense/income/net lines elsewhere) with a top legend, skipped entirely when
there's no target date or no non-pension retirement accounts (same empty-state
convention as the three existing charts). Immediately followed by a
`renderChartDataTable()` call with columns `[Date, Conservative, Moderate,
Aggressive]`.

`renderProjectionPanel(app, accounts)` (extended, not replaced): after the
existing combined-total line (unchanged), adds:
- Two number inputs (conservative/aggressive delta, defaulting from the new
  settings keys) in a `.retire-withdrawal-row`-styled row, `onchange`
  clamping and persisting via `setSetting` then a full
  `renderRetirementPage()` (matches the existing target-date input's
  simple commit-on-change pattern rather than a live-updating slider — these
  are typed numeric deltas, not something a user drags).
- A new scenario summary table (`.retire-scenario-table`, wrapped in the
  existing `.table-wrapper` convention since it's genuinely multi-column data
  per CLAUDE.md's responsive-table guidance): one row per account
  (Conservative / Moderate / Aggressive columns) plus a bold Combined Total
  row — the literal "projection summary table" the acceptance criteria ask
  for.
- The existing withdrawal-rate slider section, extended with the two new
  conservative/aggressive monthly-income elements described above.

### 4. `src/app.js` wiring

New delegating method:
```js
computeAccountProjectionScenarios(accountId, conservativeDelta, aggressiveDelta) {
    return computeAccountProjectionScenarios(this, accountId, conservativeDelta, aggressiveDelta);
}
```
(imported from `retirement.js` alongside the existing `computeAccountProjection`
import, for test/DOM-console access — mirrors the existing pattern.)

### 5. `src/locales/en.js`

New keys: `retirement.scenarioConservative`, `retirement.scenarioModerate`,
`retirement.scenarioAggressive`, `retirement.projectionChartTitle`,
`retirement.projectionChartSub`, `retirement.a11yProjectionCaption`,
`retirement.scenarioConservativeDeltaLabel`,
`retirement.scenarioAggressiveDeltaLabel`,
`retirement.scenarioCombinedTotalRow`,
`retirement.monthlyIncomeConservativeLabel`,
`retirement.monthlyIncomeAggressiveLabel`. (`es.js`/`pl.js` are untouched —
per CLAUDE.md, those only need pilot-scope keys, and the Retirement page
itself isn't in that pilot scope beyond what's already there.)

### 6. `styles.css`

Reuses `.table-wrapper`/`.retire-snapshot-table`-equivalent rules via a new
`.retire-scenario-table` (same cell padding/border convention) plus a
`.retire-scenario-total-row` bold-weight rule, and a `.retire-scenario-controls`
row (flex, wraps, same gap convention as `.retire-withdrawal-row`) for the two
new delta inputs.

## Error handling / edge cases

- No `retirementTargetDate` → chart and scenario table are skipped exactly
  like the existing projection panel's own empty state (no new failure mode).
- Only pension accounts exist → projection chart is skipped (nothing to plot
  a rate-driven band for); the scenario table still renders pension rows with
  identical conservative/moderate/aggressive values.
- An account with `rateOfReturn` of 0 → conservative clamps to 0 (can't go
  negative), aggressive becomes `0 + aggressiveDelta`; the band is still
  visibly non-degenerate.
- Conservative/aggressive delta inputs: a positive conservative delta or a
  negative aggressive delta is clamped back to `0` at the boundary (so a
  conservative scenario is never more optimistic than moderate and vice
  versa); a non-numeric entry resets to the default delta.
- Duplicate/zero deltas (both 0) → all three scenarios collapse to the same
  line/column — not an error, just a degenerate-but-correct band.

## Testing

- `tests/unit/retirementCalculator.test.js` (Jest) — new `describe` blocks for
  `computeScenarioRates` (default deltas against a 7% baseline produce
  5/7/10; a custom delta pair; clamping at 0 and 100; a non-finite delta
  falling back to its default; a negative/zero moderate rate), and
  `computeRetirementProjectionScenarios`/`computeRetirementProjectionSeries`
  (three scenarios actually diverge over a multi-year horizon with a
  positive contribution; zero months/zero rate collapse all three to
  `currentBalance`; duplicate deltas collapse all three to the same value;
  series includes month 0 and the final month and is monotonically
  non-decreasing for a positive rate+contribution).
- `tests/features/test_retirement.py` (Playwright) — new tests: the
  projection chart renders three `<canvas>`-adjacent accessible table columns
  with diverging values once a target date and a logged balance exist; the
  scenario summary table shows three distinct numbers per account and a
  combined total row; the two delta inputs round-trip through
  `getSetting`/reload; the three monthly-withdrawal figures
  (`#retireMonthlyWithdrawalVal` plus the two new ids) all update when the
  withdrawal-rate slider moves; an out-of-range delta entry (e.g. a positive
  conservative delta) gets clamped rather than accepted; a pension-only setup
  shows identical conservative/moderate/aggressive numbers and no projection
  chart.
- No sanitizer changes needed, so no new `sanitizers.test.js` cases — the two
  new settings are plain numeric values through the existing generic
  `sanitizeSetting()` path (already covered by its existing tests).
- `tests/features/test_versioning.py` — run as-is; no changes needed beyond
  the version bump itself.

## Documentation

- `CLAUDE.md`: extend the existing "Retirement accounts dashboard" bullet
  (not a new bullet) to describe the scenario band, the delta-derivation
  decision, and the withdrawal-panel decision.
- Bump `APP_VERSION` in `src/utils.js`: `6.38.0` → `6.39.0` (bumped twice
  more from the originally-planned `6.37.0` — #251 merged first and took
  `6.37.0`, then #278's dynamic-import code-splitting work merged and took
  `6.38.0` while this PR was in flight, requiring a second rebase); matching
  `sw.js` `CACHE_NAME` bump.
- New `## [6.39.0] — 2026-10-26` entry in `CHANGELOG.md` under "Added",
  referencing #264 (kept in sync by `tests/features/test_versioning.py`).
- `stryker.config.mjs`'s two `retirementCalculator.js` line-range entries are
  corrected to the function's actual current line numbers (they had drifted
  out of sync with earlier unrelated edits to the file) and extended to cover
  the three new pure functions added here, per the file's own existing
  "added alongside `debtCalculator.js`/`utils.js`/`sanitizers.js`" convention
  for newly-tested pure functions. `mutation-testing` only runs on `push` to
  `main` (not on pull requests), so this doesn't gate this PR's CI, but it
  keeps the mutate scope from drifting further.
