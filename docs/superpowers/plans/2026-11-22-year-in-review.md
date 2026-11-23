# Year in Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Reports tab, "Year in review", that sums up one calendar year as short observations. Real events come first, then planned figures tagged "planned" (#689).

**Architecture:**
- A pure, import-free core, `src/yearReviewCore.js`, holds the period and data-floor helpers plus one rule per insight. Each rule takes plain prepared data and returns an insight object or null.
- A lazy DOM module, `src/reportsYearReview.js`, builds that input from `app` and renders the result.
- The tab plugs into the existing lazy Reports tab machinery.

**Tech Stack:** Vanilla ES modules, Jest and Stryker, Playwright/pytest.

**Spec:** `docs/superpowers/specs/2026-11-22-year-in-review-design.md`

## Global Constraints

- Work on branch `feat/year-in-review-689` and open a draft PR. Never push to `main`.
- `src/yearReviewCore.js` imports nothing, and every export is a hoisted `function`.
- Dates are local `YYYY-MM-DD` strings compared as strings. A month is `YYYY-MM`.
- Nothing is persisted: no migration, no setting, no server change. `app._yearReviewYear` is session-only and **not** in `VIEW_STATE_FIELDS`.
- Every string goes in en/es/pl with a real translation, plus `.few` plural keys in all three (repo convention).
  - A translated sentence is one text node. Counts use `plural()`.
  - "planned" and "estimated" are separate tag spans with their own keys.
- Formatting uses the cached `utils.js` formatters (`formatCurrency`, `formatMonthYear`, `formatShortDate`). Never `new Intl.*` or `toLocaleDateString` per item.
- No inline styles. Use `escapeHtml` on every interpolated value.
- New modules go in `sw.js` `PRECACHE_URLS`.
- A new `tests/features/` file goes in a `ci.yml` shard.
- Thresholds are constants at the top of the core:
  - `CATEGORY_RISE_MIN_PCT = 10`
  - `CATEGORY_RISE_MIN_AMOUNT = 100`
  - `MAX_NAMED = 3` (debts cleared)
  - `MAX_NAMED_CHANGES = 2`
  - `MAX_NAMED_GOALS = 2`
  - `NET_WORTH_TREND_MONTHS = 240`
- Local tooling is the same as #678:
  - `jest.sh`
  - the isolated stack `-p mf689` on port 32907 (never compose without `-p`)
  - `pt.sh` pointed at 32907

## Review Focus

- A year with data only in its last months, for example the first balance entry in November: rules must use the first point **in** the period, never invent a January value. Task 1 pins this.
- A debt whose first history entry is mid-year: it must not count as "paid down" from 0, and must not count as "cleared" on its first entry. Task 1 pins this.
- Templates with no start date: there must be no "vs last year" clause unless `floorIso <= priorPeriod.startIso`. Task 3 pins this.
- The current year in January, with one partial month: `bestAndWorstMonth` returns null and nothing divides by zero. Task 3 pins this.
- A Feb 29 `today` in a year-to-date prior period: the prior end becomes Feb 28. Task 1 pins this.

---

### Task 1: Core framework, period, data floor and balance rules (1-4)

**Files:**
- Create: `src/yearReviewCore.js`
- Create: `tests/unit/yearReviewCore.test.js`
- Modify: `tools/strykerScope.mjs` (`'src/yearReviewCore.js': true`) and `tools/mutationFloors.json` (placeholder `0`, re-derived from CI in Task 5)

**Interfaces (produced):**
- `buildPeriod(year: number, todayIso: string) → { year, startIso, endIso, months: number[], isYtd }`
  - A past year has `endIso` `YYYY-12-31` and months 0..11.
  - The current year has `endIso = todayIso` and months 0..current month.
  - A future year is clamped to the current year.
- `priorPeriodOf(period) → same shape` for `year - 1` with the same months.
  - When `isYtd`, `endIso` is the same month and day one year back, with Feb 29 becoming Feb 28.
  - `isYtd` is false on the result.
- `dataFloorIso(data) → string | null`. `data` is the plain bag described below. It returns the minimum of:
  - `balanceHistory[].date`
  - `snapshots[].date`
  - `manualTransactions[].date`
  - `reconciliations[].date`
  - the date segment of each key in `overrides` and `cleared` (the last `|` part)
  - `incomes[].firstPayDate`
  - `recurringTemplates[].startDate`
  - `bonuses[].date`
  - Nulls are ignored.
- `computeYearInsights(input) → Insight[]`. It runs `RULES`, drops nulls and sorts `actual` before `planned`, then `weight` descending.
- `Insight = { id, kind: 'actual'|'planned', estimated: boolean, key: string, plural: boolean, vars: object, weight: number }`.
  - `vars` values are raw and typed: `{ $: number }` is currency, `{ m: 'YYYY-MM' }` is a month, `{ d: 'YYYY-MM-DD' }` is a date, `{ pct: number }` is a percent. A plain string or number is shown as-is.
  - With `plural: true`, the renderer calls `plural(key, vars.count, ...)`.
- `input` (built in Task 4):
  - `{ period, priorPeriod, floorIso, netWorthPoints, debts, balanceHistory, overrides, reconciliations, sinkingFunds, incomes, recurringTemplates, monthsTx, priorMonthsTx }`
  - `netWorthPoints` is `[{ monthKey, netWorth, kind }]`.
  - `debts` is `[{ id, name, interestRate }]`.
  - `balanceHistory` is the debt entries only, `[{ debtId, date, balance }]`.
  - `monthsTx` and `priorMonthsTx` are arrays, one per period month, of Ledger tx objects: `{ type, amount, category, name, sourceId, isTransferLeg, ... }`.

**Rules in this task (kind `actual`):**
- `netWorthChange` (weight 100): first and last `netWorthPoints` with `monthKey` inside the period.
  - Key `yearReview.i.netWorthUp` or `…Down`, with vars `{ amount: {$: |Δ|}, since: {m: firstKey} }`.
  - `estimated` when either point is `estimated`. Null with fewer than 2 points.
- `debtPaidDown` (weight 90): per debt, the start balance is the last entry `<= startIso`, else the first entry in the period; the end balance is the last entry `<= endIso`.
  - It sums `start - end` where that is positive and counts those debts.
  - Key `yearReview.i.debtPaidDown`, plural on `count`, vars `{ count, amount: {$} }`.
  - A debt with no entry `<= endIso` is skipped. Null when the sum is 0.
- `debtCleared` (weight 85): a debt whose period entries include one with balance `<= 0` that has an earlier entry (anywhere, sorted by date) with balance `> 0`.
  - The first such entry's month is used.
  - Returns one insight per debt (rules may return arrays; the core flattens them), up to `MAX_NAMED`, key `yearReview.i.debtCleared` `{ name, month: {m} }`.
  - Beyond that, one `yearReview.i.debtClearedMore` (plural on `count`).
- `interestEstimate` (weight 80): for each debt with `interestRate > 0` and at least one entry `<= endIso`, and for each period month:
  - The balance is the last entry on or before that month's end (or before the period end for the current month), and debts with none yet are skipped.
  - Interest is `balance * (Math.pow(1 + apr/100/365, daysInMonth) - 1)`. For the current partial month, days run up to today's day.
  - Sum per debt. Key `yearReview.i.interest` `{ amount: {$: total}, name: topDebtName }`, `estimated: true`. Null when the total is below 0.01.

- [ ] **Step 1: Write failing tests** in `tests/unit/yearReviewCore.test.js`:
  - `buildPeriod(2025, '2026-03-10')` gives months 0..11 and `endIso '2025-12-31'`, `isYtd: false`. `buildPeriod(2026, '2026-03-10')` gives months [0, 1, 2], `endIso '2026-03-10'`, `isYtd: true`.
  - `priorPeriodOf(buildPeriod(2028, '2028-02-29'))` has `endIso '2027-02-28'`.
  - `dataFloorIso` picks the minimum across every source. An override key `'recurring|5|2|2024-04-05'` gives `'2024-04-05'`. Empty data gives `null`.
  - `netWorthChange`: points Jan 1000 and Nov 1500 give `netWorthUp` with amount 500. Only a Nov and a Dec point give a `since` of November. One point gives no insight. An `estimated` point sets `estimated: true`.
  - `debtPaidDown`: a debt at 5000 before the period and 3000 at the end gives 2000 and count 1. A debt whose first entry is in June at 4000 and 4000 at the end gives nothing. An increase is not netted against another debt's decrease.
  - `debtCleared`: entries 300 (Jul) then 0 (Aug) give the August month. A debt whose only entry is 0 gives nothing. Four cleared debts give 3 named plus `debtClearedMore` with count 1.
  - `interestEstimate`: one debt at 1200 with APR 12% over a full past year gives about `sum over months of 1200*((1+0.12/365)^days-1)` (within 0.01). APR 0 gives null.
  - `computeYearInsights` ordering: actual before planned, by weight. Null rules are dropped.
- [ ] **Step 2: Run** `jest.sh tests/unit/yearReviewCore.test.js`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement** the helpers, the four rules and `computeYearInsights`. `RULES` is an exported array of rule functions, so later tasks append to it.
- [ ] **Step 4: Run** the test, then `jest.sh tests/unit/yearReviewCore.test.js tests/unit/strykerScope.test.js tests/unit/mutationFloors.test.js`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(year-review): core, period, data floor and balance insights (#689)`.

### Task 2: Remaining actual rules (5-8)

**Files:** modify `src/yearReviewCore.js` and `tests/unit/yearReviewCore.test.js`.

**Interfaces:** consumes the Task 1 input and `Insight` shape. Appends to `RULES`.

**Rules (kind `actual`):**
- `amountChanges` (weight 70). Takes each `amountChanges` entry of `recurringTemplates` and `incomes` with `from` inside the period. "from" is the amount in effect the day before; compute it inline from base plus sorted changes, because the core imports nothing.
  - Income, plus recurring `income`/`reimbursement` types, is a pay change: key `yearReview.i.payChange` `{ name, from: {$}, to: {$}, month: {m} }`.
  - Everything else is a price change: `yearReview.i.priceChange`, same vars. Transfers are skipped.
  - Rank by `|to - from| * occurrencesPerYear`. Monthly is 12, weekly 52, biweekly 26, twice_monthly 24, quarterly 4, yearly 1, and an unknown frequency counts as 12.
  - Show the top `MAX_NAMED_CHANGES`, then `yearReview.i.changesMore` (plural).
- `actualsVsPlan` (weight 60): `overrides` whose key date is inside the period, with finite `originalAmount` and `amount !== originalAmount`.
  - `diff = Σ (|amount| - |originalAmount|)`. Key `yearReview.i.actualsMore` when `diff > 0`, `…Less` when `< 0`, `…Even` when it is 0. Plural on `count`, vars `{ count, amount: {$: |diff|} }`.
- `goalsReached` (weight 55): `sinkingFunds` with `completedDate` inside the period.
  - Key `yearReview.i.goalsReached`, plural `{ count, names }`, where `names` is the first `MAX_NAMED_GOALS` joined with ", ".
- `reconciliationAdjustments` (weight 50): `reconciliations` dated inside the period with `difference !== 0`.
  - Key `yearReview.i.reconAdjust`, plural `{ count, amount: {$: Σ|difference|} }`.

- [ ] **Step 1: Write failing tests**:
  - A $15 subscription changed to $18 on 2026-03-01 gives `priceChange` with from 15, to 18 and month 2026-03. A change dated in 2025 is excluded for 2026.
  - An income raise gives `payChange`. Three changes give 2 named plus `changesMore` count 1, ranked by annualized difference.
  - Overrides: two at +10 and one at -5 give `actualsMore` count 3 and amount 15. An override outside the period, or with a null `originalAmount`, is ignored.
  - A goal completed in the period is counted, while one completed the year before isn't.
  - A reconciliation with difference -12.5 gives amount 12.5, and a 0 difference is ignored.
- [ ] **Step 2: Run** the file. Expected: FAIL (rules missing).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(year-review): amount changes, actuals vs plan, goals and reconciliation insights (#689)`.

### Task 3: Planned rules (9-14)

**Files:** modify `src/yearReviewCore.js` and `tests/unit/yearReviewCore.test.js`.

**Interfaces:**
- Consumes `monthsTx` and `priorMonthsTx`.
- Classification mirrors `computeReportsSummaryMetrics`: skip `isTransferLeg` or `type === 'transfer'`.
  - Income is `income`, `bonus`, `interest`, a positive `manual` and a positive `recurring`.
  - Outflow is `bill`, `expense`, a negative `manual`, a negative `recurring`, `debt` and `savings`.
- The category is `tx.category || 'Other'` for outflow types `expense`, `bill`, negative `manual` and negative `recurring`. Debt and savings are not "spending".
- `canCompare = floorIso !== null && floorIso <= priorPeriod.startIso`.

**Rules (kind `planned`):**
- `subscriptionsTotal` (weight 40): Σ |negative `recurring`| tx.
  - Key `yearReview.i.subscriptions` `{ amount: {$} }`.
  - With `canCompare` and a prior total > 0, use `…SubscriptionsUp` or `…Down` `{ amount, pct: {pct} }`, with the percent rounded.
  - Null when the total is 0.
- `topCategory` (weight 35): the largest spending category and its share of total spending. Key `yearReview.i.topCategory` `{ category, pct: {pct} }`.
  - The `category` var is rendered through `categoryLabel` by the renderer, so mark it `{ cat: 'Housing' }`.
- `biggestCategoryChange` (weight 30): only when `canCompare`. Picks the category with the largest increase that is at least `CATEGORY_RISE_MIN_PCT`% **and** at least `CATEGORY_RISE_MIN_AMOUNT`.
  - Key `yearReview.i.categoryRise` `{ category: {cat}, amount: {$: increase}, pct: {pct} }`.
- `bestAndWorstMonth` (weight 25): net per month. When `period.isYtd`, the last (partial) month is excluded. It needs at least 2 months.
  - Key `yearReview.i.bestWorst` `{ best: {m}, bestNet: {$}, worst: {m}, worstNet: {$} }`. The renderer shows signed currency for these two.
- `debtShareOfIncome` (weight 20): Σ |debt| ÷ income. Key `yearReview.i.debtShare` `{ pct: {pct} }`. Null when income is 0 or there are no debt tx.
- `incomeChange` (weight 15): total income, key `yearReview.i.income` `{ amount: {$} }`.
  - With `canCompare` and prior income > 0, use `…IncomeUp` or `…Down` `{ amount, pct }`.

- [ ] **Step 1: Write failing tests** (small hand-built `monthsTx`):
  - Subscriptions summed, with transfer legs excluded.
  - A comparison only when `canCompare`: a floor after the prior start gives the plain key.
  - `topCategory` share.
  - `categoryRise` threshold edges: 9.9% gives null, and $99 gives null.
  - Best and worst months, with the YTD partial month excluded. Fewer than 2 months gives null.
  - Debt share. Zero income gives null.
  - Income up and down.
- [ ] **Step 2: Run** the file. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the file and the full Jest suite (`jest.sh tests/unit`). Expected: PASS.
- [ ] **Step 5: Commit** `feat(year-review): planned-flow insights (#689)`.

### Task 4: The tab (DOM module, wiring, strings, CSS, browser tests)

**Files:**
- Create: `src/reportsYearReview.js`. It exports:
  - `buildYearReviewInput(app, year, today = new Date())`
  - `renderReportsYearReview(app)`
  - `formatInsight(insight) → string`, which formats typed vars and calls `t`/`plural`
- Modify:
  - `src/lazyModules.js`: add `import('./reportsYearReview.js')` as `yearReview` to `loadReportsSubModules`.
  - `src/reports.js`: add `'yearreview'` to `LAZY_REPORT_TABS` and a `case 'yearreview'` in `getLazyReportRenderers`. Toggle the class `rpt-month-nav--year` on `.rpt-month-nav` while that tab is active; CSS hides the prev and next buttons and the month label there, and Print stays visible.
  - `index.html`: add the tab button `#rptTab-yearreview` (`data-rptab="yearreview"`, `role="tab"`, `aria-controls="rptPanel-yearreview"`, emoji 🗓️ and `data-i18n="reports.tabYearReview"`) in the **Trends** group after Forecast. Add the panel `#rptPanel-yearreview` (`role="tabpanel"`).
  - `src/locales/{en,es,pl}.js`: every `yearReview.*` key from Tasks 1-3 plus the page keys:
    - `reports.tabYearReview`
    - `yearReview.title`, `yearReview.yearSoFar` (`{year}`), `yearReview.prevYearAria`, `yearReview.nextYearAria`
    - `yearReview.whatHappened`, `yearReview.fromPlan`, `yearReview.tagPlanned`, `yearReview.tagEstimated`
    - `yearReview.empty`, `yearReview.emptyHint`
  - `styles.css`: a `/* #689 year in review */` block, no nesting.
  - `sw.js` `PRECACHE_URLS`: both new modules.
  - `tests/features/i18n_render_support.py`: `TRANSLATED_PAGES` entries `'reports-yearreview'` (seeded with `SEEDED_STATE`, which has balance history and snapshots, plus an override, an `amountChanges` entry and a completed goal added in the setup, so "What happened" renders) and its empty-data counterpart, the way the other Reports tabs do.
  - `.github/workflows/ci.yml`: add `tests/features/test_year_in_review.py` to a features shard.
- Test: `tests/features/test_year_in_review.py`

**Rendering details:**
- The year defaults to the current year: `app._yearReviewYear ??= today.getFullYear()`.
- The stepper is `#yrPrevYear` / `#yrNextYear` buttons with aria-labels, and `#yrYearLabel` (shows `yearSoFar` when `isYtd`, otherwise the year). Prev is disabled at the data floor's year, or at the current year when there is no floor. Next is disabled at the current year. Clicking re-renders.
- If `netWorthChange` exists, it renders as a lead line `#yrHeadline`. "What happened" is a `<ul id="yrActual">`, "From your plan" a `<ul id="yrPlanned">` with a heading tag `planned`. An `estimated` insight gets a tag span.
- When there are no insights at all, `#yrEmpty` shows `yearReview.empty` and `emptyHint`. When either list is empty, its section is omitted.
- `buildYearReviewInput` runs inside the caller's `withProjectionCache` scope. It uses:
  - `getLedgerTransactionsForMonth` for each period and prior month
  - `getNetWorthTrend(app, NET_WORTH_TREND_MONTHS)`
  - `dataFloorIso` over the app collections
  - debt balance-history entries (`debtId !== null`)

- [ ] **Step 1: Write failing Playwright tests** in `tests/features/test_year_in_review.py`:
  - `test_year_review_renders_actual_then_planned`: seed accounts, a debt with balance history across this year (5000 before January, then 3000), a monthly subscription, an income, and an override in this year. Open Reports and the Year in review tab. `#yrActual li` contains the paid-down sentence, `#yrPlanned li` exists, and `#yrActual` comes before `#yrPlanned` in DOM order.
  - `test_year_review_year_stepper`: with data from last year, `#yrPrevYear` changes `#yrYearLabel` to last year's number, and `#yrNextYear` is then enabled.
  - `test_year_review_empty_state`: no data gives a visible `#yrEmpty` and a disabled `#yrPrevYear`.
  - `test_year_review_hides_month_nav`: while on the tab, `#rptPrevMonth` is hidden and `#rptPrintBtn` is visible. Switching to Summary shows `#rptPrevMonth` again.
  - Every test calls `assert_no_errors(page)`.
- [ ] **Step 2: Build the stack and run** `pt.sh tests/features/test_year_in_review.py -q`. Expected: FAIL (no tab).
- [ ] **Step 3: Implement** the module, wiring, strings and CSS.
- [ ] **Step 4: Rebuild and run:**
  - `tests/features/test_year_in_review.py`
  - `tests/features/test_i18n_coverage.py`
  - `tests/features/test_i18n_render_guard.py` and `tests/features/test_i18n_render_guard_empty.py`
  - `tests/ui/test_aria_labels.py`, `tests/ui/test_label_in_name.py`, `tests/ui/test_css_integrity.py`
  - `tests/features/test_ci_shard_coverage.py`, `tests/features/test_pwa.py`, `tests/features/test_code_splitting.py`
  - the existing Reports tests (`pytest tests -k "report" -q`)
  - `tests/ui/test_mobile_no_card_clipping.py`
  - Expected: PASS. Then run the full Jest suite.
- [ ] **Step 5: Commit** `feat(year-review): Year in review Reports tab (#689)`.

### Task 5: Release, docs, PR

**Files:** `src/utils.js` (`APP_VERSION` 7.24.0), `sw.js` (`CACHE_NAME`), `CHANGELOG.md`, `src/ui.js` (`WHATS_NEW_ENTRIES`, in English), and `CLAUDE.md` (a Cross-cutting bullet; also add `reportsYearReview.js` to the lazy-modules bullet and the feature-module list).

- [ ] **Step 1: Bump and document.**
- [ ] **Step 2: Run** `pt.sh tests/features/test_versioning.py tests/features/test_pwa.py tests/features/test_whats_new.py tests/features/test_community_files.py -q`, the full Jest suite and the full server suite. Expected: PASS.
- [ ] **Step 3: Commit** `chore(release): 7.24.0 year in review (#689)`.
- [ ] **Step 4:** run the final whole-branch review, push, and open a draft PR (closes #689). Derive the `yearReviewCore.js` floor from the `mutation-report-pr` artifact, commit it, and mark the PR ready when CI is green.
