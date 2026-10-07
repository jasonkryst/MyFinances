# MyFinances Performance Audit — 2026-10-06

**App version audited:** 6.10.7
**Scope:** Static analysis of the no-build-step client app; chart instance
lifecycle, storage serialization, new features since September 2026 (Balance
History, Retirement, Surplus Analysis sparkline, People, Bonus year filter);
service worker precache sync.
**Prior audit:** `performance/PERFORMANCE_AUDIT_2026-09-02.md` (app v4.40.0)

No live Lighthouse run was performed in this pass. The September audit
provided a scored baseline (Performance 0.60, LCP 8.6s); the structural root
causes documented there are unchanged, so a re-run would produce a comparable
score. The focus here is delta analysis: which findings closed, which remain,
and what new surface the intervening features introduce.

---

## Resolved since 2026-09-02

| Finding | Fix | Version |
|---|---|---|
| **H3** `debtCalculator.js` render-blocking `<script>` (no `defer`) | `defer` added to `index.html` | v4.43.0 |
| **M1** `renderReportsPage()` rebuilt all 11 Chart.js instances on every tab click / month-nav | Scoped to active tab via `REPORT_TAB_RENDERERS` lookup; dead chart keys removed | v4.43.0 |
| **M2** What-If slider ran `calculatePaymentPlan` synchronously on every raw `input` event | 150ms `debounce()` wrapper (new `utils.js` helper) around simulation; label still updates immediately | v4.43.0 |

---

## Open findings (carried from September)

### High

**[H1] Unbundled module graph blocks LCP/TTI — no change.**

`src/app.js` still has 0 dynamic `import()` calls anywhere in the codebase
(confirmed by `grep -rn "import(" src/` producing no matches). All ~59
`src/*.js` modules load as static top-level imports, so every feature —
Retirement, Balance History, People, Postgres sync, guide theming — loads on
every page visit. The `network-dependency-tree-insight` multi-level waterfall
documented in the September audit persists. This is the dominant cause of
LCP 8.6s. Tracked: [#146](https://github.com/jasonkryst/MyFinances/issues/146).

**[H2] Monolithic, unminified `styles.css` (~170 KB), render-blocking, >92%
unused on first paint — no change.**

The CSS architecture is unchanged. No per-page splitting or critical-CSS
inlining has been attempted, consistent with the documented no-build-step
constraint. Source file size has grown slightly with new Retirement-page and
People-page styles.

### Low

**[L1] `saveToStorage()` re-serializes full app state (`JSON.stringify`) on
every call, no debouncing — no change.**

`src/storage.js` `saveToStorage()` confirmed still has no debounce mechanism.
The function is called once per add/edit/delete action (spot-checked:
`retirement.js`'s `addRetirementSnapshot` and `deleteRetirementSnapshot` each
call `app.saveToStorage()` once, synchronously, not on every keystroke).
`app.retirementSnapshots` is now a new serialization concern — each snapshot
adds ~6 fields to the JSON payload — but this remains well within the 5 MB
quota ceiling the function enforces.

---

## New findings

### Good (no issue)

**Chart lifecycle: all new chart-rendering code uses destroy-before-recreate.**

The three charts added in `src/retirement.js` (Balance Over Time, Contribution
vs. Growth, Current Balance Breakdown) each call a local `destroyChart(app,
key)` helper before `new Chart(...)`:

- `destroyChart(app, '_retireBalanceChart')` at file position 13582, `new Chart` at 14280
- `destroyChart(app, '_retireContributionChart')` at file position 15473, `new Chart` at 16230
- `destroyChart(app, '_retireBreakdownChart')` at file position 17761, `new Chart` at 18110

`src/balanceHistoryModal.js`'s new chart (`_balanceHistoryChart`) uses the
same pattern: `if (app[CHART_KEY]) { app[CHART_KEY].destroy(); }` before
`app[CHART_KEY] = new Chart(...)`. No leaked instances.

All three retirement charts and the balance-history chart have corresponding
`renderChartDataTable()` calls (accessibility, not performance — confirmed
`retirement.js` has 4 such calls). The total `new Chart(` call count across
`src/` is now **24** (up from 20 in September); all 24 are guarded.

**Service worker precache is in sync with the new module count.**

`sw.js` `CACHE_NAME = 'myfinances-v6.10.7'` matches `APP_VERSION = '6.10.7'`
in `src/utils.js`. The precache enumerates **63 JS entries** covering all 59
`src/*.js` files plus the 3 locale files and `src/i18n.js`-adjacent entries.
All newer modules (`retirement.js`, `retirementCalculator.js`,
`balanceHistory.js`, `balanceHistoryCore.js`, `balanceHistoryModal.js`,
`people.js`, `calendarFeed.js`) are present in the precache list. No stale
entries or missing files found.

**`retirementCalculator.js` is O(months) — no O(n²) concern.**

`computeRetirementProjection(balance, contribution, rate, months)` is a simple
monthly-compounding loop: O(months) ≈ O(600) worst case. It is called once per
retirement account on page render — O(accounts × months), which is negligible
for any realistic retirement account count (typically 1–5).

`splitGrowthFromContribution(snapshots)` sorts then maps once: O(snapshots log
snapshots). No nested loops.

**`balanceHistoryCore.js` is O(entries) — no O(n²) concern.**

The pure-calculation module provides `upsertHistoryEntry`, `sortHistory`, and
`buildHistoryEntry`. Each is a single-pass filter/sort/map over the entry
array. No nested lookups or repeated full-list scans.

**Surplus Analysis sparkline is bounded and correct.**

`src/health.js`'s `_healthSurplusSparkline` (added v6.9.0) is destroyed and
re-created each time the surplus card is re-rendered (`if (app._healthSurplusSparkline) { app._healthSurplusSparkline.destroy(); ... }`). The sparkline plots a fixed daily window (bounded by `windowDays` from a user-set range); data generation is a single array reduce, not a nested loop. No performance concern.

**Ledger pagination confirmed still intact.**

`src/ledger.js` `renderLedgerPage` still clamps to a `selectedPageSize`
(10/25/50/100) before rendering. No unbounded full-table DOM replacement.

### Low

**[L2] `computeAccountBalance` still not memoized.**

`src/accounts.js` `computeAccountBalance(app, accountId, year, month)` has no
memoization (confirmed: 0 `Map()`, `_cache`, or `memo` patterns in the file).
It is called once per account per render path in `health.js`, `forecast.js`,
and `ledger.js`. The new `people.js` module does not call it directly.

The September audit rated this as informational (no real-world bottleneck at
realistic account counts). This remains the case. Flagging only because two
new call-sites (`retirement.js` calls `computeAccountProjection`, which reads
`getSnapshotsForAccount` rather than `computeAccountBalance` directly — no
new `computeAccountBalance` callers added) means the surface is stable.

**[L3] `debtCalculator.js:320-361` `getPaymentOrder()` O(months × debts²)
worst case — no change from September.**

Not a real bottleneck at realistic counts. The What-If slider debounce (M2,
resolved) mitigates the most frequent trigger. Still worth noting if a
"compare all 4 strategies simultaneously for many debts" flow is added.

---

## Page-weight update

The `src/` module count grew from 54 → 59 files between v4.40.0 and v6.10.7.
New modules: `retirement.js`, `retirementCalculator.js`, `balanceHistory.js`,
`balanceHistoryCore.js`, `balanceHistoryModal.js`, `people.js`, `calendarFeed.js`
(7 new), minus any retired modules. The waterfall depth and per-origin
connection limit pressure described in the September audit are proportionally
slightly worse but not categorically different.

---

## Recommendations (delta, not a re-statement of September's full list)

1. **Dynamic `import()` for Retirement, People, Balance History, and Calendar Feed** — these four newer modules are the most obviously bounded-use-case features (a user visits Retirement rarely; Balance History opens in a modal; Calendar Feed is a one-shot download). Each could be a dynamic import without affecting offline behavior (SW still precaches them) while removing their parse cost from the common page-load path. Low risk, real LCP improvement. Still the highest-leverage structural change and still blocked on the no-build-step decision. See #146.

2. **Re-run Lighthouse against the Docker/nginx build** before treating the
   September baseline as current. Five patch-level versions of CSS and mobile
   layout fixes have shipped; the render-blocking/unused-CSS picture may have
   changed marginally.
