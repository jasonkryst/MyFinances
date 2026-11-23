# Year in review (#689)

## Intent

A Reports tab that sums up one calendar year as short observations, each a
sentence with its number, to help the user understand the year. It is
deliberately **not** a tax-prep tool: figures can be estimates, but every
estimate says so, and nothing is meant to be copied onto a tax form.

The issue was first written as "Year in review / tax-prep summary". In
brainstorming the owner chose overview and insight over tax precision. The app
never records actual interest paid, and its Ledger is mostly *projected* from
templates, so a lender-matching figure is impossible anyway.

## Goals

- Pick a calendar year. The current year is shown as year-to-date ("2026 so
  far") and compared like for like with the same months of the prior year.
- Observations backed by **real events** come first, under "What happened".
  Observations computed from **planned** flows come second, under "From your
  plan". Each planned one carries a visible "planned" tag.
- Each observation is one translated sentence with its figure. A rule with
  nothing to say is omitted, never shown as $0.
- Print-friendly.

## Non-goals

- Tax-form figures, Form 1098 matching, CSV export. The issue listed CSV; it
  was dropped because sentences don't fit a CSV. The existing Summary tab
  still exports totals.
- A rolling "last 12 months" mode.
- Storing anything. The page is computed from data already loaded: no
  migration, no setting, no server change.
- Charts. Possible later; v1 is text.

## Anti-goals

- An observation that sounds like fact but restates the user's own plan
  without saying so.
- A year-over-year comparison against a period the app has no data for.
  Templates without a start date project backwards forever, so naively
  "last year" would be invented numbers.
- A number formatted per item with `new Intl.*` / `toLocaleDateString` in a
  loop. Use the cached `utils.js` formatters.

## Constraints

- Follow the lazy Reports tab pattern (#278): a new `LAZY_REPORT_TABS` entry
  in `src/reports.js`, loaded through `loadReportsSubModules()` in
  `src/lazyModules.js`. A tab button and panel go in `index.html`, with
  `role="tab"`/`tabpanel` like their siblings.
- Projection work runs inside `withProjectionCache(app, fn)`.
- i18n: every string is in en/es/pl. A translated sentence is one text node.
  Counts use `plural()` (with `.few` keys, per the repo's convention). The tab
  gets `TRANSLATED_PAGES` entries for seeded and empty data.
- CSP: no inline styles. Escape everything rendered.
- Reports tabs are print-friendly (#256). This tab follows the same print
  rules.

## Approaches considered

- **A. New Reports tab with a pure insight-rule core (chosen).**
  `src/yearReviewCore.js` holds one function per insight. Each takes plain,
  prepared data and returns an observation or null. The lazy
  `src/reportsYearReview.js` gathers the data and renders. Adding an insight is
  adding one rule, and the core is Jest- and Stryker-testable.
- **B. Add insights to the Summary tab's year view.** It reuses the period
  picker, but it mixes sentences into a printable table of totals and couples
  the two. Rejected.
- **C. New top-level page.** A main-nav item for something used a few times a
  year. Rejected.

## Design

### Data floor

`dataFloorIso(app)` is the earliest dated evidence of real data. It is the
minimum of:

- account and debt balance-history entry dates
- net-worth snapshot dates
- manual transaction dates
- reconciliation dates
- Ledger override and Cleared key dates
- income `firstPayDate`
- recurring template `startDate`
- bonus dates

Rules use it as follows:

- The year picker offers years from the floor's year up to the current year.
  With no data at all, it offers the current year and the page shows its
  empty state.
- A **comparison against the prior period** is made only when the floor is on
  or before the first day of that prior period. Otherwise the observation is
  shown without the comparison clause. Each comparing rule has two sentence
  keys, with and without the comparison.

### Period

- `period = { year, startIso: 'YYYY-01-01', endIso, months: [0..m] }`. For a
  past year `endIso` is Dec 31 and `m` is 11. For the current year `endIso` is
  today and `m` is the current month. The current month counts as partial.
- `priorPeriod` covers the same months of `year - 1`.
- `isYtd` is true for the current year. The heading reads "2026 so far".

### Prepared input (built by the DOM module, consumed by the pure core)

`buildYearReviewInput(app, year, today)` in `reportsYearReview.js` returns
plain data:

- `period`, `priorPeriod`, `floorIso`.
- `monthsTx` and `priorMonthsTx`: arrays of each month's
  `getLedgerTransactionsForMonth(app, y, m)` output.
- `netWorth`: the year's points from `getNetWorthTrend(app, N)`, where N is
  large enough to reach January of `year` (capped at 240), each with its
  `kind`.
- `debts`: id, name, APR, archived.
- `balanceHistory`: debt entries only, plus credit-card and loan account
  entries.
- `overrides` and `cleared`, keyed as today.
- `reconciliations`, `sinkingFunds`, `incomes`, `recurringTemplates` (for
  `amountChanges`).

### Insight rules (v1)

Each rule returns `{ id, kind: 'actual'|'planned', estimated?: bool, key,
vars, weight }` or null. The core's `computeYearInsights(input)` runs every
rule and drops nulls. It sorts `actual` before `planned`, then by `weight`
descending.

**What happened (actual)**

1. **netWorthChange.** First point in the period vs. the last. Gives the
   change and its direction. `estimated` when either point is `estimated`.
   Null with fewer than two points.
2. **debtPaidDown.** Per debt, the balance at period start (last entry on or
   before `startIso`, else the first entry in the period) vs. the balance at
   period end (last entry on or before `endIso`). The total of decreases and
   the count of debts. Increases are not netted. Null when nothing decreased.
3. **debtCleared.** A debt with an entry in the period at a balance <= 0,
   where the entry before it was > 0. Gives the name and month. One sentence
   per debt, at most 3, then "+N more".
4. **interestEstimate.** For each debt with APR > 0 and history: for each month
   in the period, `dailyCompoundInterest(balanceCarriedForward, apr,
   daysInMonth)`. Sum it, and name the largest contributor. Always
   `estimated`.
5. **amountChanges.** Changes from #678 with `from` inside the period.
   Recurring outflow rises and drops are "price changes". Income and
   recurring inflow changes are "pay changes". Rank by annualized difference
   and show the top 2 by name, plus a count.
6. **actualsVsPlan.** Ledger overrides dated in the period where `amount !==
   originalAmount`. Gives the count and the signed total (more or less than
   planned).
7. **goalsReached.** Sinking funds with `completedDate` in the period. Gives
   the count and up to 2 names.
8. **reconciliationAdjustments.** Reconciliations in the period with
   `difference !== 0`. Gives the count and the total absolute difference.

**From your plan (planned)**

9. **subscriptionsTotal.** Recurring outflows that aren't transfer legs
   (`isTransferLegTx`). Total, plus the change against the prior period when
   the data floor allows.
10. **topCategory.** Spending by `spendingCategoryForTx` over the period. The
    largest category and its share of spending.
11. **biggestCategoryChange.** The category with the largest increase against
    the prior period. It needs at least 10% and $100 of increase, and the data
    floor.
12. **bestAndWorstMonth.** Net (income minus outflows, classified like
    `computeReportsSummaryMetrics`) per month. Both are named. Needs at least
    2 months.
13. **debtShareOfIncome.** Debt payments as a share of income for the period.
    Null when income is 0.
14. **incomeChange.** Total income and its change against the prior period,
    when the floor allows.

Thresholds and the "top N" counts are constants at the top of the core, so
they can be tuned.

### Page

```
Year in review   [◀]  2026 so far  [▶]                       🖨 Print
Net worth +$18,400 since January (estimated)
What happened
  • Paid down $9,200 across 3 debts
  • Visa paid off in August
  • About $2,150 in interest, mostly the car loan (estimated)
  • Netflix went up $2.50/mo in March; Salary +8% in July
  • 14 payments differed from the plan: $310 more in total
From your plan                                         [planned]
  • Subscriptions cost $2,410, up 12% on last year
  • Housing was your biggest category: 34% of spending
  • Best month: July (+$1,900); toughest: December (−$640)
```

- The year stepper is the tab's own control (prev/next buttons with
  `aria-label`s and a live year label). The shared Reports month navigation
  is hidden on this tab, as tabs that don't use it already do. The selected
  year is session view state, `app._yearReviewYear`. It is never persisted
  and not loaded by `loadFromPostgres`, so it is not in `VIEW_STATE_FIELDS`.
- Observations render as a `<ul>`, one `<li>` each. Each translated sentence
  is a single text node. "estimated" and "planned" are separate tagged spans
  with their own keys.
- Empty state: "Not enough data for this year yet", with a hint to add
  accounts and record balances.
- Print: the Print button calls the existing Reports print path. Only the tab
  content prints.

## Testing

- Jest, `tests/unit/yearReviewCore.test.js`: each rule with data, with nothing
  to say (null), at its threshold edges, with and without the data floor
  allowing comparisons, and the ordering of actual before planned. Add the
  module to `MUTATE_SCOPE` and set its floor from the PR's CI report.
- Jest: `dataFloorIso` and the period builder (past year, current year,
  January edge).
- Playwright, `tests/features/test_year_in_review.py`, in a shard under the
  time budget:
  - The tab renders seeded observations, with actual before planned.
  - Stepping the year changes the heading and content.
  - The empty state shows with no data.
  - The Print button is present.
  - No console errors.
- i18n: `TRANSLATED_PAGES` entries for the tab with seeded and empty data. The
  seed includes balance history, an override and an `amountChanges` entry, so
  the "What happened" sentences are scanned.

## Release

Minor bump: `APP_VERSION`, `CHANGELOG.md`, `sw.js` `CACHE_NAME` plus
`PRECACHE_URLS` for the two new modules, and a What's New entry (English, like
the others, #506). Add a CLAUDE.md bullet.

## Left to the builder

- Exact sentence wording in the three locales, within the meaning above.
- CSS for the list and tags, following the mobile-density and contrast rules.
- How the tab hides the shared month nav: reuse whatever Net Worth or Forecast
  already do.
- Whether `bestAndWorstMonth` skips the current partial month (suggested: yes,
  when `isYtd`).
