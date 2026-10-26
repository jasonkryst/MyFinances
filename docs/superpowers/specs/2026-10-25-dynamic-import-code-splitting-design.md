# Dynamic `import()` Code-Splitting — Design

Issue: #278 — "Performance: dynamic import() for non-critical modules (no
code-splitting on first paint)"

## Context

`src/app.js` statically imports every feature module at the top of the file,
so the entire module graph — including pages most sessions never visit
(Retirement, Reconciliation, several Reports sub-tabs) — is fetched and
evaluated before `DOMContentLoaded` fires. The no-build-step constraint (no
bundler, no transpilation — see `CLAUDE.md`) means the only code-splitting
mechanism available is native ES module dynamic `import()`, supported in
every browser this app targets.

## Scope decision: which modules actually qualify

The issue's suggested candidate list was: `retirement.js`,
`retirementCalculator.js`, `reconciliation.js`, `reportsMoneyFlowSankey.js`,
`reportsNetWorth.js`, `reportsCalendar.js`, `reportsCashFlow.js`,
`reportsVariance.js`, `reportsSummary.js`, `strategyCalendar.js`. Each was
audited for its own import graph (who imports it, and does it import
anything that must stay eager) before being accepted.

### Made lazy

| Module | Why it's a safe leaf |
|---|---|
| `retirement.js` (+ `retirementCalculator.js`, its only static dependency) | Imported **only** by `app.js`. Every exported function except `renderRetirementPage` is only reachable from DOM the Retirement page itself renders (snapshot modal, projection panel), so by the time any of them can run, the page has already loaded the module. |
| `reconciliation.js` | Imported only by `app.js`. One extra cold entry point exists: `src/ledger.js`'s `#reconcileFromLedgerBtn` calls `app.openReconcileModal(accountId)` directly from the Ledger page, so a user can trigger a reconciliation-module load without ever visiting the Reconcile page. Handled explicitly (see Call sites below). |
| `reportsCalendar.js`, `reportsMoneyFlowSankey.js`, `reportsCashFlow.js`, `reportsVariance.js`, `reportsSummary.js` | All five are imported only by `reports.js`, which dispatches to exactly one sub-tab's renderer(s) per call (`REPORT_TAB_RENDERERS` / `STATIC_REPORT_TAB_RENDERERS` in `reports.js`). `reportsSummary.js` statically imports `getSnapshotSeries` from `reportsNetWorth.js` and `reportsMoneyFlowSankey.js` statically imports `computeMonthCashFlowTotals` from `reportsCashFlow.js` — both safe, since the former is already-eager (see below) and the latter is in the same lazy group (native ESM module-map memoization means no duplicate fetch regardless of whether a module is reached via a static or dynamic `import`). |
| `strategyCalendar.js` | Imported only by `app.js`; only entry point is the Strategy/Plan page's Calendar sub-tab (`switchTab(app, 'calendar')` in `ui.js`). |

### Deliberately excluded (stay static)

- **`reportsNetWorth.js`** — despite being on the issue's candidate list,
  this is *not* a Reports-page-only leaf. `renderNetWorthWidget()` is called
  unconditionally from `ui.js`'s `updateUI()` (runs on every app load, before
  any page navigation) and from every Accounts-page CRUD path
  (`accounts.js`'s `addAccount`/`deleteAccount`/`archiveAccount`/
  `unarchiveAccount`/`saveEditAccount`), plus `reconciliation.js`. Its
  `captureNetWorthSnapshot()` is also invoked directly from `app.js`'s
  `async init()` for the auto-snapshot setting, before any page has
  rendered. Lazy-loading it would mean it almost always loads anyway (on
  first Accounts-page visit, which is one of the most-used pages) while
  adding real risk around the `init()`-time call — not worth it. Documented
  here so a future change doesn't "finish the job" and reintroduce this
  hazard.
- **`forecast.js`, `spending.js`** — not on the issue's named candidate
  list. `spending.js` is additionally hard-blocked: `recurring.js` (a core,
  always-visited page) statically imports its `PINNED_COLORS` constant, so
  it can't be deferred without first decoupling that constant. `forecast.js`
  has no such blocker and could be a reasonable follow-up, but is left out
  here to keep this change's blast radius matched to the named scope.
- **`ui.js`, `postgresSync.js`, `people.js`** — explicitly out of scope per
  the issue and `CLAUDE.md`'s documented circular-import cycle
  (`ui.js → postgresSync.js → ui.js`, `ui.js → people.js → postgresSync.js
  → ui.js`), which is only safe because every export in the cycle is a
  hoisted `function` declaration. None of this PR's changes touch any
  export in those three files, and nothing in the cycle is converted to an
  arrow-function `const`.
- **`debtCalculator.js`** — a classic (non-module) global script loaded via
  a plain `<script>` tag before Chart.js; `index.html`'s script tags are not
  touched at all.

## Loader / caching mechanism

New module `src/lazyModules.js` — a small, DOM-free cache keyed by a stable
module name, wrapping native `import()`:

```js
const _cache = new Map();   // key -> in-flight/resolved Promise<module namespace>
const _resolved = new Map(); // key -> resolved module namespace, once settled

function loadOnce(key, importFn) {
    if (!_cache.has(key)) {
        const promise = importFn()
            .then((mod) => { _resolved.set(key, mod); return mod; })
            .catch((err) => { _cache.delete(key); throw err; });
        _cache.set(key, promise);
    }
    return _cache.get(key);
}
```

- A **concurrent or repeated** call for the same key reuses the same
  in-flight/resolved promise — the module is fetched at most once, no matter
  how many navigations or simultaneous call sites ask for it.
- A **failed** `import()` (e.g. network error) deletes the cache entry in
  the `.catch`, so a later retry (user navigates away and back, or clicks
  the retry affordance in the error state) issues a fresh `import()` instead
  of being stuck forever on a rejected promise.
- `getResolvedModule(key)` exposes the already-resolved namespace
  synchronously (or `null` before/if loading hasn't finished) — used only by
  a lazy module's own internal same-module code that needs a synchronous
  value (see `retirement.js`'s `renderProjectionPanel`, below), never by the
  `app.js` wrapper methods themselves. An earlier draft of this design tried
  to make the "secondary" wrapper methods (e.g. `app.getSnapshotsForAccount`)
  synchronous via this same lookup, reasoning that they're only reachable
  from DOM the already-loaded page itself rendered — that reasoning doesn't
  hold for this codebase's existing data-layer tests (e.g.
  `test_retirement.py`, `test_reconciliation_statement_range.py`), which call
  `window.app.addRetirementSnapshot(...)` / `window.app.applyReconciliation(...)`
  etc. directly via Playwright *without* first navigating to the owning
  page, to exercise the calculation/persistence logic without a full render.
  Every `app.js` wrapper method for a lazy module is therefore `async` and
  `await`s the loader itself (near-zero cost once cached) — see Call sites.
- One exported loader function per lazy unit: `loadRetirementModule()`,
  `loadReconciliationModule()`, `loadStrategyCalendarModule()`,
  `loadReportsSubModules()` (the last resolves all five Reports sub-modules
  together via `Promise.all`, returning `{ calendar, sankey, cashFlow,
  variance, summary }` — see Scope decision above for why they're one unit).
  Each wraps `loadOnce` with a literal `import('./moduleName.js')` specifier
  (no bundler-only "magic comment" syntax is used or needed — native dynamic
  `import()` resolves any string expression at runtime).
- `_resetLazyModuleCacheForTests()` clears both maps; used by the Jest unit
  test for `loadOnce`'s caching/retry contract (DOM-free, pure logic —
  exactly the kind of helper Stryker's `mutate` globs already cover, so it's
  added there deliberately; see Testing).

## Call sites changed

### `app.js`

- Removes the static imports of `retirement.js`, `reconciliation.js`,
  `strategyCalendar.js`, and the three individual function imports
  (`computeReportsSummaryMetrics` from `reportsSummary.js`,
  `getCashFlowTrendSeries` from `reportsCashFlow.js`,
  `computeMoneyFlowSankeyData` from `reportsMoneyFlowSankey.js`) — these
  last three existed as direct imports bypassing `reports.js` and would
  otherwise force-eager-load three of the five lazy Reports sub-modules
  regardless of `reports.js`'s own laziness.
- Every wrapper method for a lazy module becomes `async`, `await`-ing the
  loader, then delegating: `renderRetirementPage()`,
  `renderReconciliationPage()`, `openReconcileModal(accountId)`,
  `renderCalendarView(page)`, `computeReportsSummaryMetrics(...)`,
  `getCashFlowTrendSeries(...)`, `computeMoneyFlowSankeyData(...)`,
  `getRetirementAccounts()`, `getSnapshotsForAccount(accountId)`,
  `addRetirementSnapshot(...)`, `deleteRetirementSnapshot(id)`,
  `computeAccountProjection(accountId)`, `applyReconciliation(...)`,
  `reconcileAccount(accountId)`, `deleteReconciliationEntry(id)`,
  `getExpectedTransactionsInRange(...)`. The four "entry point" ones
  (`renderRetirementPage`, `renderReconciliationPage`, `openReconcileModal`,
  and the Reports dispatch inside `reports.js`) additionally wrap the load in
  `try/catch` and render the in-page error state on failure.
- Every one of these is `async` rather than only the "obvious" entry points,
  because this codebase's existing data-layer tests
  (`tests/features/test_retirement.py`,
  `tests/features/test_reconciliation_statement_range.py`) call
  `window.app.addRetirementSnapshot(...)` / `window.app.applyReconciliation(...)`
  / etc. directly via Playwright to exercise calculation/persistence logic,
  *without* first navigating to the owning page — so none of these methods
  can safely assume the module is already loaded. `loadRetirementModule()`/
  `loadReconciliationModule()` resolve near-instantly once cached, so
  `await`-ing on every call costs nothing after the first.
- This has one real-code consequence, not just a test-compatibility one:
  `retirement.js`'s own `renderProjectionPanel()` (internal, not exported)
  used to call `app.computeAccountProjection(a.id) || 0` inside a `.reduce()`
  expecting a synchronous number back. Since that wrapper is now `async`,
  the call was changed to invoke the **local** `computeAccountProjection(app,
  accountId)` function directly (defined earlier in the same file) instead
  of going through `app.` — it's already running inside the loaded module, so
  there's no reason to pay for (or need) the `await` indirection there.
  `getResolvedModule(key)` (exported from `lazyModules.js`, synchronously
  returns a resolved module's namespace or `null`) exists for exactly this
  kind of internal same-module lookup, though `retirement.js` ends up not
  needing it here since it can just reference its own local function.

### `src/ui.js`

- `renderPageData(app, pageName)`'s `'retirement'` and `'reconcile'`
  branches are unchanged at the call site (`app.renderRetirementPage()` /
  `app.renderReconciliationPage()` — still called without `await`, which is
  fine: these are fire-and-forget UI-render triggers like every other
  `renderPageData` branch, and nothing after them in `renderPageData`
  depends on them having finished).
- `switchTab(app, 'calendar')` similarly keeps calling
  `app.renderCalendarView()` without `await`.
- No changes to `ui.js`'s own exports or their `function`-declaration form —
  the circular-import safety guarantee is untouched.

### `src/ledger.js`

- The `#reconcileFromLedgerBtn` `onclick` handler's call to
  `app.openReconcileModal(accountId)` is unchanged at the call site (still
  fire-and-forget); the new `async` wrapper in `app.js` handles the
  load-then-open sequencing and the failure path (shows `showAlertModal(...)`
  — there's no Reconcile-page DOM visible to host an in-page error while the
  user is still looking at Ledger).

### `src/reports.js`

- Splits `REPORT_TAB_RENDERERS` into `STATIC_REPORT_TAB_RENDERERS`
  (`networth`, `forecast`, `spending` — unchanged, called synchronously) and
  a lazy path for the other five tabs (`calendar`, `incomeexp`, `moneyflow`,
  `variance`, `summary`).
- `renderReportsPage(app)` becomes `async`: for a lazy tab it `await`s
  `loadReportsSubModules()`, then calls that tab's renderer(s) from the
  resolved module set. On rejection, it `console.error`s and renders an
  inline error message into that tab's own panel (`#rptPanel-<tab>`) via a
  new `renderLazyLoadError()` helper, rather than letting the rejection
  propagate unhandled.
- Every existing caller of `app.renderReportsPage()` (`ui.js`, `ledger.js`,
  `ledgerOverrides.js`, `accounts.js` indirectly via the Net Worth widget
  path) is unchanged — none of them `await` it today, and none need to.

### `src/utils.js`

- New `renderLazyLoadError(containerId, label)` hoisted `function` (DOM
  utility, same convention as the existing `renderChartDataTable`): sets
  `container.textContent`/builds a small `<div class="lazy-load-error">`
  with a friendly message (`"Couldn't load {label}. Check your connection
  and try again."`) via `createElement`/`textContent` — never `innerHTML` of
  interpolated text, consistent with the CSP/XSS conventions in `CLAUDE.md`.

### `commandPalette.js`

- **No changes needed.** Every Reports/Strategy/Retirement/Reconcile entry
  in the palette's command list calls `app.switchPage(pageName)` (confirmed
  by grep — no command calls a lazy module's render function directly), and
  `switchPage()`/`renderPageData()` already handle the loader internally.

## Loading / error UI state

- **Loading**: no separate loading spinner markup is introduced. The target
  page section is already visible (its container is shown by `switchPage()`
  before `renderPageData()` runs) and simply keeps showing its prior/empty
  content for the brief `import()` round-trip — consistent with the existing
  "hidden tab keeps its last render until re-visited" pattern already
  documented in `reports.js`. On a typical connection this resolves in low
  tens of milliseconds; on slow/offline connections the error path (below)
  takes over once the fetch actually fails, rather than hanging indefinitely
  with no explanation (`fetch`/`import()` rejects on a network error; it
  doesn't hang).
- **Error**: `renderLazyLoadError()` replaces the target container's content
  with a plain-language message and logs the real error via
  `console.error()` for diagnostics — never a thrown exception that reaches
  the browser's unhandled-rejection path, and never a native `alert()`
  except the one cross-page case (`openReconcileModal` from Ledger) that has
  no page DOM of its own to host an inline message.
- **PWA / offline**: all ten now-lazy files were already present in `sw.js`'s
  precache list before this change (confirmed by inspection) and remain
  there — the service worker still background-fetches them on install, so a
  previously-visited-once, now-offline session still has them available
  instantly via the cache, even on a cold load that never reaches that page.
  This change only affects the *main-document module graph's* fetch
  ordering/timing, not the SW's precache set.

## Measuring the initial-paint improvement

Verifiable, not just claimed, two ways:

1. **Static module-graph diff** — before this change, `app.js`'s static
   `import` graph includes all ten now-lazy files; after, it doesn't. A new
   assertion in `tests/features/test_code_splitting.py` loads the app fresh
   and asserts, via `page.evaluate(() =>
   performance.getEntriesByType('resource').filter(e =>
   e.name.endsWith('.js')).map(e => e.name))`, that none of the ten lazy
   module URLs appear in the resource timing list captured right after
   `DOMContentLoaded` (before any page navigation) — i.e. they were not
   fetched as part of the initial module graph. The same list, re-checked
   after navigating to each lazy page once, does include that page's
   module(s).
2. **Byte-count delta** — `performance.getEntriesByType('resource')` entries
   also carry `transferSize`; summing the ten now-lazy files' sizes (several
   are a few KB each; `retirement.js`/`reconciliation.js`/`reports.js`'s
   sub-modules collectively are not trivial) gives a concrete "N fewer bytes
   parsed before `DOMContentLoaded`" number, logged by the test for
   visibility rather than asserted on an exact byte count (asserting an
   exact byte count would make the test brittle against incidental code
   changes elsewhere).

## Testing (TDD — written alongside implementation)

New `tests/features/test_code_splitting.py`:

**Positive**
- Retirement, Reconciliation, and one Reports sub-tab (`calendar`) module
  URLs are absent from `performance.getEntriesByType('resource')` captured
  immediately after load, before any navigation.
- Navigating to the Retirement page triggers exactly one network request for
  `retirement.js` (and `retirementCalculator.js`, bundled by the browser's
  own module resolution); navigating away and back triggers zero additional
  requests for the same URL (`page.on('request')` counter, filtered by URL).
  Same pattern repeated for Reconciliation (`reconciliation.js`) and the
  Reports Calendar tab (`reportsCalendar.js`) — and additionally for the
  Strategy page's Calendar sub-tab (`strategyCalendar.js`).
- Each page's rendered content (seeded fixture data) matches what it showed
  before this change — i.e., the feature itself is unaffected, only its
  load timing.
- The Ledger page's `#reconcileFromLedgerBtn` cross-page entry point loads
  `reconciliation.js` exactly once even when clicked before the Reconcile
  nav page has ever been visited.

**Negative**
- `page.route()` aborts the request for `retirement.js`; navigating to the
  Retirement page shows the in-page error message (`.lazy-load-error` text)
  instead of a blank section or thrown exception; `page.page_errors` is
  empty (no uncaught exception propagated) after the attempt.
- Same pattern for `reconciliation.js` via the normal Reconcile nav entry
  (in-page error) and via the Ledger cross-page entry (`openReconcileModal`
  — asserts the alert-modal error path instead, since there's no Reconcile
  page DOM visible).
- Same pattern for the Reports Calendar tab's lazy group
  (`reportsCalendar.js` blocked) — asserts the error renders into
  `#rptPanel-calendar` specifically, not a different tab's panel.
- After a blocked/failed load, the rest of the app stays fully usable —
  switching to an unrelated unaffected page (e.g. Accounts) and back still
  works, with no leftover console errors beyond the one expected
  `console.error()` diagnostic from the failed import.

Jest unit test (`tests/unit/lazyModules.test.js`, added to Stryker's
`mutate` globs in `stryker.config.mjs` since it's pure/DOM-free exactly like
the existing covered functions):
- `loadOnce` returns the same promise instance for two synchronous calls
  with the same key before the first resolves (no double-fetch race).
- A rejected `importFn()` is *not* cached — a second call with the same key
  after rejection invokes `importFn()` again.
- A resolved call is cached permanently — a second call never re-invokes
  `importFn()`.

## Documentation

- Bump `APP_VERSION` in `src/utils.js`: `6.37.0` → `6.38.0` (a parallel branch
  — issue #251 — merged first and took `6.37.0` off the same `main` commit
  this branch started from; rebased onto it and bumped to the next free
  minor version instead), and `sw.js`'s `CACHE_NAME` to match.
- Add a `## [6.38.0] — 2026-10-25` entry to `CHANGELOG.md`, above the
  `6.37.0` entry #251 added.
- `CLAUDE.md`: new bullet under "Cross-cutting features" documenting
  `src/lazyModules.js`, which modules are lazy vs. static, and the
  load-at-most-once guarantee, so a future change doesn't accidentally
  reintroduce a static import of one of the now-lazy modules (or lazy-load
  `reportsNetWorth.js`, given the hazard documented above).
