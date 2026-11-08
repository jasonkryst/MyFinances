# MyFinances Performance & Sustainability Audit — 2026-11-04

**App version audited:** 7.0.0 (PostgreSQL-only storage, merged in PR #458), branch `docs/v7-security-audit` at `e050f21`
**Scope:** runtime performance (boot, mutation sync, rendering, network/caching, server) and sustainability (size and complexity hotspots, duplication, dead code, dependencies, CI cost, documentation load, energy use).
**Prior audits:** `performance/PERFORMANCE_AUDIT_2026-10-06.md` (v6.10.7), `performance/PERFORMANCE_AUDIT_2026-09-02.md` (v4.40.0)

**Method and tools.** Measured on the local Docker stack (`http://localhost:32901/`: nginx 1.31.8, Node 24, Postgres 16.15), Windows 11 host, headless Chromium 156 driven by Playwright. Throwaway scripts lived in the session scratchpad and used the repo harness (`tests/conftest.py` `ensure_session`, `seed_state`, `_RESET_JS`). The seeded dataset was:

- 30 accounts, 50 debts, 200 recurring templates, 5 incomes and 200 expenses
- 1,000 ledger overrides and 1,000 cleared entries
- 24 monthly net-worth snapshots
- 90 balance-history rows, created by the app on first boot

That is a 432 KB JSON export. The brief asked for 2,000 overrides, but that import fails (see PERF-02). Request recording used Playwright `requestfinished` plus `request.sizes()`, and the Resource Timing API. Main-thread time came from a `longtask` PerformanceObserver, at no throttling and at CDP 4× CPU throttling. Other tools: nginx access logs (`docker logs`), `curl` for login latency, `psql` for row and hash checks, and `gh run view` / `gh api` for CI, artifacts and Dependabot. Size and complexity came from a Babel-parser function-length scan, plus grep scans for dead exports, i18n keys and CSS classes.

**Not run:** Lighthouse. It isn't installed locally, and the CI Lighthouse job audits the login gate (#470). The browser measurements below stand in for it.

**Conventions.** Every number is measured unless it is marked *(est.)* or *(inference)*. Timings are medians on a fast desktop; a mid-range phone is roughly the "4× CPU" column.

---

## Summary

| Severity | Count | New | Tracked by an open issue |
|---|---:|---:|---:|
| High | 3 | 3 | 0 |
| Medium | 9 | 9 | 0 |
| Low | 15 | 10 | 5 (#330, #460, #469, #470, #471) |
| **Total** | **27** | **22** | **5** |

**Headline findings:**

1. **Per-account balance math rebuilds every account's ledger on each call (PERF-01).** `computeAccountBalance` → `getLedgerTransactionsForMonth` re-projects *all* accounts to answer for one. Measured costs:
   - The Forecast "total" view blocks the main thread for **991 ms** at a 12-month range (112 ms at 1 month).
   - Sorting Accounts by balance takes **299 ms**.
2. **Large imports fail outright (PERF-02).** The importer fires one request per record with no concurrency limit. At 1,400 overrides + 700 cleared entries, **2,127 fetches were in flight** and Chromium aborted 151 of them with `net::ERR_INSUFFICIENT_RESOURCES`. The import then rolled back. The rollback reuses the same fan-out, so it can fail the same way. The v6→v7 legacy-data migration goes through this path.
3. **Import into the server orphans every ledger override and cleared key (PERF-03).** Keys embed the *old* record ids (`recurring|2004|5|…`), but the server assigns new ones. After a replace import, **0 of 1,000 overrides** applied to any ledger row. *(Correctness bug found while measuring; it also affects the legacy-data migration.)*
4. **Each record edit sends a second, unrelated sync request (PERF-04).** Every add, edit or delete also PATCHes the whole plan-settings row (318 B, about 5 DB queries) through `saveToStorage()` (86 call sites). In the recorded session, 3 of 6 mutating requests were these PATCHes.
5. **Boot is fast on desktop but heavy on a phone (PERF-05/06/07/08).** Warm boot reaches `data-app-ready` in about **0.5 s** (87 requests, 32 KB gzip API payload). At 4× CPU it takes **2.0–3.4 s**, with one boot long task of **1.1–1.8 s**. Eager JS is **1.64 MB decoded / 416 KB gzip** over 62 modules, 2.5× the September size. That includes all three locale files (237 KB of unused locales) and a parser-blocking Chart.js `<script>`.

---

## Measurements

### Boot

Each row is a full page load followed by `data-app-ready` and network idle.

| Scenario | Requests (static / CDN / API) | `data-app-ready` | Long tasks | Transfer |
|---|---|---:|---|---|
| Cold first visit, empty account, SW installing | 87 (65 / 1 / 21) | 1,882 ms | n/a | static 431 KB gz, CDN 61 KB, API 40 KB |
| Cold, SW blocked, seeded | 87 (65 / 1 / 21) | 963 ms | n/a | static 491 KB gz / **2.09 MB decoded** (document 26 KB gz / 174 KB) |
| **First boot after import**, seeded | **328** (65 / 1 / **112**, plus 150 harness top-up PUTs excluded) | 2,172 ms | n/a | 21 GETs + **90 POST /api/balance-history** + 1 PATCH |
| Warm boot (SW active), seeded, 3 runs | 87 (66 SW / 21 API) | 503 / 536 / 820 ms | 1 task: 158 / 190 / 308 ms | API **32 KB gz / 391 KB decoded** |
| Warm boot, 4× CPU throttle, 3 runs | 87 | 2,055 / 2,314 / 3,409 ms | 2–3 tasks: total 1.2–2.0 s, max 1.09–1.81 s | same |

- **Request pattern.** The boot path is sequential at the top and parallel below. Module graph (static requests end at about 304 ms) → `probeServer()` GET `/api/plan-settings` → `loadFromPostgres()`, which sends 20 GETs in parallel. `/api/plan-settings` is fetched **twice** on every boot (`src/storage.js:44` and `:120`).
- **Server side.** There is no N+1 on the boot GETs. Each list route is one `SELECT … WHERE user_id=$1 ORDER BY id` plus one session lookup. The 21 API calls took 112 ms on localhost.
- **Heap and DOM.** JS heap after boot is 10.7–11.3 MB. DOM is 5,109 nodes after boot and 16,002 after visiting every page, because hidden pages keep their markup.

**Decoded API payload by endpoint** (seeded, one boot):

| Endpoint | Rows | Bytes | | Endpoint | Rows | Bytes |
|---|---:|---:|---|---|---:|---:|
| `/api/ledger-overrides` | 1,000 | 191,886 | | `/api/balance-history` | 90 | 8,816 |
| `/api/ledger-cleared` | 1,000 | 82,601 | | `/api/net-worth-snapshots` | 24 | 3,337 |
| `/api/recurring-templates` | 200 | 57,245 | | `/api/incomes` | 5 | 1,021 |
| `/api/debts` | 50 | 22,266 | | `/api/plan-settings` | 1 | 375 (×2) |
| `/api/expenses` | 200 | 20,719 | | `/api/settings` | 2 | 99 |
| `/api/accounts` | 30 | 11,927 | | 9 empty collections | 0 | 2 each |

Ledger overrides are 48% of the boot payload, at about 192 B per row. At 2,000 overrides the decoded payload would be about 590 KB *(est.)*. nginx gzips `/api` JSON from 192 KB to 15 KB, so the wire cost stays small.

### Mutation (sync traffic)

| Action | Requests | Body bytes |
|---|---|---|
| Edit and save a debt (inline) | `PATCH /api/debts/:id` + `PATCH /api/plan-settings` | 449 + 318 |
| Add an account | `POST /api/accounts` + `PATCH /api/plan-settings` | 335 + 318 |
| Toggle Ledger Cleared | `PUT /api/ledger-cleared/:key` + `PATCH /api/plan-settings` | 40 + 318 |
| Navigate all 10 pages and every Reports tab | **0** | n/a |
| Change the Ledger date filter or sort | 0 (filters persist to `localStorage` `debtTrackerLedgerFilters`) | n/a |
| Replace-import of the 432 KB seed (1,000 overrides / 500 cleared) | **1,881** (485 POST, 1,375 PUT, 20 DELETE, 1 PATCH) | 282 KB, **6.7 s** |
| Replace-import with 1,400 overrides / 700 cleared | 4,604, with **151 failed** (`ERR_INSUFFICIENT_RESOURCES`), then rollback | 14.9 s, import rejected |

- Navigation generates no traffic, and there is no polling (0 `setInterval` in `src/`).
- Record edits send the whole record, which is fine at under 0.5 KB.
- The waste is the plan-settings PATCH that rides along with every mutation (PERF-04). On the server, `PATCH /api/plan-settings` runs session lookup, `SELECT *`, `UPDATE` and a milestones `SELECT` (`server/src/routes/planSettings.js:25,89,93`).

### Rendering and compute (seeded, desktop, median of 3–5)

| Operation | Time | Notes |
|---|---:|---|
| `buildProjectedAccountTransactions` 1 / 12 months | 1.3 / 15.1 ms | 362 / 4,691 tx |
| `getLedgerTransactions` (13 months, Ledger page) | 41 ms | 5,320 tx |
| `computeAccountBalance` (one account) | 1.1 ms | still rebuilds every account's month |
| ... for all 30 accounts | 33.7 ms | O(accounts × all tx) |
| **Accounts list sorted by balance** | **298.6 ms** | comparator calls `computeAccountBalance` twice per comparison |
| **Forecast "total", 1 / 3 / 6 / 12 months** | **112 / 254 / 480 / 991 ms** | 31 asset accounts × months × full rebuild |
| `computeNetWorthProjection(60)` | 10.2 ms | fine |
| `DebtCalculator.calculatePaymentPlan` (50 debts) | 3.9 ms | Oct L3 worst case not reached |
| `switchPage`: Health / Accounts / Income / Liabilities / Recurring / Ledger | 80 / 44 / 58 / 57 / 81 / 103 ms | Savings 3 ms, Plan 2 ms |
| Reports tabs: Money Flow / Spending / Forecast / Net Worth / Summary / Variance / Inc-Exp / Calendar | 148 / 117 / 116 / 51 / 26 / 24 / 20 / 3 ms | one tab renders per click (Sep M1 fix holds) |
| Reconcile page (lazy) | 175 ms | |
| `updateUI()` | 42 ms | renders the Liabilities list and the plan even when they're hidden |
| Chart.js instances created | Health 3, Income 2, Reports 9 | 27 `new Chart(` sites, 31 `.destroy()`, 0 `.update()`: always destroy and recreate |

### Network and caching

| Item | Value |
|---|---|
| Eager JS on first load | 62 same-origin modules + Chart.js = **1,636,543 B decoded / 416,050 B gzip** |
| Lazy JS (Reports ×5, Reconciliation, Retirement, Retirement calc, Transfers, Plan calendar) | ~152 KB decoded / ~37 KB gz for the 8 measured |
| Locales (all three loaded eagerly) | en 110.7 KB, es 119.2 KB, pl 117.9 KB = 347.8 KB decoded / 88.7 KB gz |
| CSS | `styles.css` 264.5 KB / 44.9 KB gz; `styles-csp-classes.css` 12.9 KB / 3.4 KB gz |
| `index.html` | 173.6 KB / 26.3 KB gz (Sep: 89.6 KB) |
| `rel="modulepreload"` | 15 of 62 eager modules |
| Chart.js | CDN `chart.js@4.4.3`, 205.6 KB / 60.3 KB gz, classic `<script>` **without `defer`** at `index.html:1293` |
| SW precache | 84 URLs, **2.31 MB** in Cache Storage |
| Warm reload with SW | **66–67 static requests still reach nginx, all `304`**: `networkFirst` (`sw.js:67`) for every same-origin asset |
| nginx static caching | `no-cache, must-revalidate` on JS/CSS/HTML; 1-year immutable on images; gzip level 6 on; HTTP/1.1 only (`listen 80`, no `http2`) |
| `/api` caching | `Cache-Control: no-store` (`server/src/app.js:44-47`). This is a deliberate security choice. The cost is a full re-download of about 32 KB gz / 391 KB decoded per boot, with no conditional revalidation. |

### Server

| Item | Value |
|---|---|
| Login (`POST /auth/login`, argon2id m=64 MiB, t=3, p=4, library defaults) | 131 / 137 / 181 ms |
| `GET /auth/setup-status` | 8–25 ms |
| Authenticated list GET (localhost) | 7–20 ms each, 20 ms for 1,000 overrides |
| Queries per request | GET: session + 1. POST: session + 1 per FK + INSERT. PATCH: session + SELECT + 1 per FK + UPDATE, all sequential (`server/src/crudRouter.js:31-34, 73-104`). |
| Pool | `max: 10`, idle 30 s, connect 10 s, `statement_timeout` 30 s (`server/src/db.js:34-44`). Boot's 21 concurrent requests queue on 10 connections. No measurable cost on localhost. |
| Body limits | `express.json({ limit: '1mb' })` and nginx `client_max_body_size 1m`: consistent |
| Indexes | Every `user_id` filter is indexed, or covered by a `(user_id, …)` PK. Unindexed FK: `incomes.person_id` (migration 015). The migration 031 columns are never filtered or sorted on server-side, so they need no index. |
| Images | `myfinances` 109 MB, `myfinances-server` 343 MB |

### CI (PR #458 run `41765808874`, green)

| Metric | Value |
|---|---|
| Wall clock | 13.0 min (03:13:55 → 03:26:56) |
| Jobs | 26 (20 use `start-stack`) |
| Runner minutes | **97.3** summed (109 rounded up per job). Other workflows on the same commit: CodeQL 1.2, Trivy 1.5, Dependency Review 0.2 (wall). |
| Longest job | `test-features-c` **12.5 min**, of which pytest is 665 s. Next: features-b 7.7, ui-b 7.5, features-e 6.9. Shortest Playwright shard: features-g 2.6. |
| Fixed overhead per Playwright shard | about 80 s: setup, pip, `playwright install --with-deps` 17–20 s, `start-stack` 33–39 s, stop 11 s. Across 20 jobs that is about **27 runner-min (28%)**. |
| Image artifact | `stack-images` **94.1 MB**, downloaded by 20 jobs (about 1.9 GB per run) |
| Recent history | Last 40 CI runs: 11 success, 25 failure, 4 action_required, 2 re-run attempts. Most failures are in-progress v7 branch work *(inference)*; the verified flake is #469. |
| Local full features run | about 70 min (reported by maintainer). Tests must run serially against one stack. |

---

## Findings

Severity combines user or maintainer impact with frequency. Effort: S is under ½ day, M is ½–2 days, L is over 2 days or needs a spec.

### High

| # | Issue | Area | Evidence | Severity | Recommendation | Est. effort |
|---|---|---|---|---|---|---|
| PERF-01 | Per-account balance and forecast math re-projects **all** accounts for every call | Render / compute | `src/accounts.js:72-81` → `src/ledgerTransactions.js:356-357` (`buildProjectedAccountTransactions(app, y, m, 1)` for every account, then filters to one). Called per account per month in `src/forecast.js:36-40,101-108`, per comparison in `src/accounts.js:228-232`, per card in `accounts.js:312`, and in `health.js:1095`, `reportsNetWorth.js:25`, `reportsCashFlow.js:317`, `reportsSummary.js:42`. Measured: Forecast total at 12 months **991 ms**; balance sort **299 ms**; all-account balances 34 ms. | High | Build the month's projection once per render and share it. Options: a memo keyed by `(year, month, monthsToProject)`, invalidated by a data-version counter bumped in every mutation path; or a `getAccountBalancesForMonth(app, y, m)` that returns a map. In sort comparators, precompute balances before sorting. | M |
| PERF-02 | Import fan-out is unbounded; above about 1,500 keyed entries Chromium aborts requests and the import, and possibly the rollback, fails | Mutation / import | `src/postgresImport.js:114-189` (`Promise.all` over every record; keyed PUTs at `:144-157`); rollback `:269-278` reuses `postAllResources`. Measured: 1,000/500 keyed succeeds (1,527 in flight); 1,400/700 fails with **151 × `net::ERR_INSUFFICIENT_RESOURCES`** (2,127 in flight); 2,000/1,000 fails with 882 aborts (3,027 in flight). Used by Data Transfer import and the legacy migration (`src/pgMigrationModal.js:135`). | High | Put every fan-out behind a small concurrency pool (for example 6–8 in flight), including the rollback. Longer term, see PERF-12. | S |
| PERF-03 | Replace/merge import into the server leaves every ledger override and cleared key pointing at the old record and account ids | Correctness (found during perf runs) | Keys are `type\|sourceId\|accountId\|date`. `postgresImport.js:142-150` PUTs keys unchanged, and `:204-209` keeps them unchanged in memory; only the `accountId` field is remapped. After reload, a sample key was `recurring\|2004\|5\|2025-11-22` while the template's server id was 4334. **0 / 1,000 overrides and 1 / 1,001 cleared** matched any ledger row (5,320 tx). | High | Rewrite both id segments of each key through the `idMap` returned by `postAllResources` (per source type: recurring, debt, income, bill, expense, transfer), and accounts through `accountIdMap`. Add a round-trip test: export → import into an empty server → overrides still apply. | M |

### Medium

| # | Issue | Area | Evidence | Severity | Recommendation | Est. effort |
|---|---|---|---|---|---|---|
| PERF-04 | Every record mutation also PATCHes the full plan-settings row | Mutation | `src/storage.js:154-206`; 86 `saveToStorage(` call sites in 24 modules. Measured: 3 of 6 mutating requests in a session were `PATCH /api/plan-settings` (318 B each, about 5 server queries). | Medium | Skip the send when the serialized body equals the last one sent. Or drop `saveToStorage()` from CRUD paths that touch no plan-settings field. Optionally coalesce bursts with a microtask or 250 ms debounce. | S |
| PERF-05 | All three locale dictionaries load eagerly | Network / boot | `src/i18n.js:5-7` (static `import en/es/pl`); `index.html` modulepreloads all three. 347.8 KB decoded / 88.7 KB gz (21% of eager JS bytes), of which about 237 KB / 61 KB (two locales, 14%) is never used in a session. | Medium | Keep `en` static as the fallback, and `import()` the active non-English locale before the first `applyStaticTranslations()`, awaited in `init()`. Preload only `en`. | M |
| PERF-06 | Chart.js is a parser-blocking third-party `<script>` in the middle of `<body>` | Network / boot | `index.html:1293` (no `defer` or `async`; 715 more lines of HTML follow). 205.6 KB from `cdn.jsdelivr.net`. Every chart caller runs after `DOMContentLoaded`. | Medium | Add `defer`, which keeps order before the module `app.js`. Consider self-hosting a pinned copy: it removes the third-party origin from a privacy-first app and from the CSP, and SW precache can cover it. | S |
| PERF-07 | Service worker `networkFirst` revalidates every asset on every load | Network / energy | `sw.js:67-88,125`. Measured: each warm reload sends **66–67 conditional requests to nginx (all 304)** plus 21 API calls; Cache Storage holds 2.31 MB. *(Inference: every 304 is re-`put` into Cache Storage.)* | Medium | `CACHE_NAME` changes every release (enforced by `test_pwa.py`), so serve precached URLs cache-first and leave revalidation to the SW update flow. Keep network-first only for `/` and `index.html`. That saves about 66 requests per load. | S |
| PERF-08 | Boot does one long main-thread task: 158–308 ms on desktop, **1.1–1.8 s at 4× CPU** | Boot / render | `src/app.js:282-301` runs `updateUI()` (`src/ui.js:866-886`, which renders the hidden Liabilities list and the plan, 42 ms) then `switchPage('health')` (80 ms, 3 charts, own projection at `health.js:425`). `data-app-ready` comes at 2.0–3.4 s throttled. | Medium | On boot, render only the landing page and let `switchPage` render others on first visit. Fixing PERF-01 also cuts Health's share. Optionally yield (`await new Promise(requestAnimationFrame)`) between the data load and the first render. | M |
| PERF-09 | Calendar/ICS logic duplicated between client and server | Maintainability | `src/calendarFeed.js` (288 lines) and `server/src/calendarGenerator.js` (282 lines) both define `icsEscape`, `icsFold`, `isoDateStr`, `buildDesc`, `nextDayStr` and `vevent`, plus copies of the occurrence and payday logic. CLAUDE.md requires changes to land in both. | Medium | Extract the DOM-free parts into `src/calendarCore.js` and import it from the server by relative path, the same way `server/src/sanitizers/index.js` already re-exports `src/sanitizers.js`. | M |
| PERF-10 | One CI shard sets the wall clock | CI | `.github/workflows/ci.yml:234-268`. `test-features-c` takes 12.5 min (pytest 665 s) against a median shard of about 4 min; overall wall is 13.0 min. | Medium | Split `test-features-c` into two shards. `test_i18n_coverage.py` and `test_storage_import.py` are likely the heavy ones *(inference; confirm with `--durations=15`)*. Expect wall of about 8 min *(est.)*. | S |
| PERF-11 | 28% of CI runner time is fixed per-shard setup, and a 94 MB artifact is downloaded 20× | CI / energy | Run 41765808874: about 80 s overhead × 20 Playwright jobs ≈ 27 of 97 runner-min; `stack-images` 94.1 MB → about 1.9 GB transfer per run. | Medium | Merge the shortest shards (g 2.6, i 3.0, d 3.5, ui-d 3.0, security 3.2 min) into fewer jobs. Cache the Playwright browser *with* OS deps, or use the Playwright container image. Consider `zstd` for the saved images. | M |
| PERF-12 | There's no bulk import endpoint, so restoring a backup costs one HTTP request and 3–4 DB round-trips per record | Server / import | Measured: 1,881 requests and 6.7 s for a 432 KB export. Each request runs session lookup + FK check(s) + INSERT (`server/src/crudRouter.js:46-70`; keyed `keyedRouter.js:37-60`). That is about 6–7k queries per import *(est.)*. | Medium | Spec a `POST /api/import` that takes the sanitized export and runs one transaction server-side. It would also give atomic rollback, replacing the client-side snapshot re-POST, and fix PERF-02/03 structurally. | L (needs spec) |

### Low

| # | Issue | Area | Evidence | Severity | Recommendation | Est. effort |
|---|---|---|---|---|---|---|
| PERF-13 | Frontend container healthcheck always fails | Ops | `Dockerfile:51-52` and `docker-compose.yml:34-35` `wget http://localhost:80/`; `nginx.conf:2` `listen 80;` (IPv4 only); `/etc/hosts` maps `localhost` to `::1` first. Container shown "unhealthy" for 11 h; `wget 127.0.0.1` succeeds. | Low | Use `http://127.0.0.1:80/` in both healthchecks, or add `listen [::]:80;`. | S |
| PERF-14 | Error handler turns client errors into 500s and logs full stacks | Server | `server/src/app.js:89-93`. Malformed JSON to `/auth/login` → `500 INTERNAL_ERROR`; the log shows `type: 'entity.parse.failed', status: 400`. Oversize bodies (413) take the same path. | Low | Honor `err.status` / `err.statusCode` for 4xx (body-parser sets them) and log only 5xx stacks. | S |
| PERF-15 | Server image includes the host's `server/node_modules` and tests | Build | Root `.dockerignore` has `node_modules/`, which matches only the context root. The image's `/app/node_modules/.bin` contains Windows `cross-env-shell.cmd` shims. Layers: `COPY server/. .` 22.3 MB, then `chown -R` duplicates 25.3 MB. Also ships `server/test` (164 KB). | Low | Use `**/node_modules` and `server/test` in `.dockerignore`, and `COPY --chown=node:node` instead of a separate `chown -R` layer. CI builds from a clean checkout, so this hits local builds only. | S |
| PERF-16 | Boot fetches `/api/plan-settings` twice, in sequence | Boot | `src/storage.js:44` (probe) and `:120` (load). Measured: 2 GETs on every boot. Costs one extra round-trip on high-latency links. | Low | Return the probe's parsed body and let `loadFromPostgres` reuse it instead of re-fetching. | S |
| PERF-17 | First boot after an import or migration POSTs balance-history seeds one at a time, unbounded | Boot / mutation | `src/balanceHistory.js:66-94` (`Promise.all(withIds.map(pgPost…))`); `src/app.js:294`. Measured: **90 POSTs** on the first boot for 50 debts + 30 accounts. | Low | Share the PERF-02 concurrency pool, or seed server-side as part of PERF-12. | S |
| PERF-18 | Unindexed FK `incomes.person_id` | Server / DB | `server/migrations/1755600000015_add-persons.js:15` (`ON DELETE SET NULL`); no index in any later migration. Deleting a person scans `incomes`. This is trivial at single-user scale. | Low | Add `CREATE INDEX IF NOT EXISTS idx_incomes_person_id` in the next migration. | S |
| PERF-19 | Expired sessions are never pruned (carried from DATABASE_AUDIT_2026-09-02) | Server / DB | `server/src/auth/middleware.js:23-24` deletes a session only when it is presented after expiry; there is no sweep. Local table: 108 rows, all from test logins. | Low | On login (or hourly in `index.js`), run `DELETE FROM sessions WHERE expires_at < now()`; `sessions_expires_at_idx` already exists. | S |
| PERF-20 | Dead i18n keys and CSS classes after the v7 UI changes | Maintainability | `toolbar.dataTransferTitle` / `toolbar.dataTransferAriaLabel` exist in all 3 locales with 0 references (the button is now a hidden stub, `index.html:102`). A grep scan of `styles.css` found 20 class selectors never referenced; spot-verified dead: `budget-two-col`, `budget-col-card`, `budget-card-period`, `header-toolbar-btn`, `comparison-best`, `btn-ghost`, `cancel-edit-btn`. | Low | Delete them. A scripted dead-key check in `test_i18n_coverage.py` would keep keys clean. | S |
| PERF-21 | Very long render functions concentrate change risk | Maintainability | 2,470 functions in `src/` + `server/src`; 49 over 100 lines, 13 over 200. Largest: `renderHealthDashboard` 790 lines (`src/health.js:912`), `renderDebtsList` 595 (`src/debts.js:449`), `renderLedgerPage` 592 (`src/ledger.js:167`), `initializeEventListeners` 525 (`src/ui.js:32`), `buildProjectedAccountTransactions` 307 (`src/ledgerTransactions.js:48`). | Low | Split by card or section when next touched, starting with Health, where each metric card can be its own function. Don't do a big-bang refactor. | L (incremental) |
| PERF-22 | `CLAUDE.md` is 80.9 KB (10,098 words, about 20k tokens *(est.)*) and is loaded into every agent session | Docs / energy | `CLAUDE.md`; lines 123–289, about 55% of the file, are per-feature implementation notes. | Low | Keep commands, architecture rules and constraints in `CLAUDE.md`. Move the per-feature notes to `docs/architecture/features.md` and link it. | M |
| PERF-23 | Full re-render of long lists *(tracked: #330)* | Render | Recurring page 81 ms (200 templates), Liabilities 57 ms (50 debts); DOM 16,002 nodes after visiting every page. | Low | As #330. | n/a |
| PERF-24 | Repeated add/edit/delete + sync + `saveToStorage` + `updateUI` boilerplate *(tracked: #460, #459)* | Maintainability | 16 `await pgPost(`, 33 `pgPatch(app`, 19 `pgDelete(app` sites, each hand-wired with its own error handling. | Low | A shared `persistRecord(app, resource, record)` helper is the natural vehicle for #459/#460 and PERF-04. | n/a |
| PERF-25 | `remapDebtPersonRefs` / `remapIncomePersonRef` have no production caller *(tracked: #471)* | Dead code | `src/sanitizers.js` exports referenced only by tests (7 and 14 refs). Confirmed by a dead-export scan; the only other hits were test-only `lazyModules.js` hooks. | Low | As #471. Note that PERF-03 needs exactly this kind of id-remap on the server import path. | n/a |
| PERF-26 | `start-stack` flake *(tracked: #469)* | CI | Every Playwright job (20/26) depends on it; the action waits only for frontend `curl` and server health. | Low | As #469. | n/a |
| PERF-27 | Lighthouse CI audits the login gate *(tracked: #470)* | CI / perf gate | This audit couldn't use Lighthouse either. The boot numbers above are the substitute. | Low | As #470. Once fixed, assert a TBT budget at 4× CPU so PERF-08 can't regress. | n/a |

---

## Sustainability

### Size and complexity hotspots

| Artifact | Sep 2026 (v4.40) | Nov 2026 (v7.0) | Growth |
|---|---:|---:|---:|
| `src/*.js` | 54 files / 642 KB | **73 files / 1,605 KB / 31,025 lines** | 2.5× |
| `styles.css` | 170 KB | **264 KB / 9,155 lines** | 1.56× |
| `index.html` | 90 KB | **174 KB / 2,012 lines** | 1.94× |
| Locales | en/es/pl (n/a) | 111 / 119 / 118 KB, 1,847 keys each | n/a |
| Largest modules | n/a | `health.js` 97 KB, `ui.js` 80 KB, `debts.js` 63 KB, `app.js` 53 KB, `retirement.js` 50 KB | n/a |

Code has grown 2.5× in two months while the eager-load share only partly improved: 62 of 73 modules still load at boot. The growth comes mostly from features, not duplication. The concentration, though, sits in a handful of 500–800-line render functions (PERF-21).

### Duplication

- **Calendar logic.** The client/server copy (PERF-09) is the one duplication the project already documents as a hazard. It is also the cheapest to remove, because the server can already import `src/` modules.
- **Sanitizer re-export.** `server/src/sanitizers/index.js` re-exports `src/sanitizers.js` *and* `src/utils.js`. This is good: one validation source. The cost is that the server process also loads `i18n.js` and all three locale files (`utils.js` imports `i18n.js`) and DOM-guarded helpers. A future top-level DOM access in `utils.js` or `i18n.js` would crash the server at import time. Suggestion: move the pure validators into a DOM- and i18n-free `src/validation.js`.
- **CRUD sync boilerplate.** About 68 hand-wired `pgPost`/`pgPatch`/`pgDelete` sites (PERF-24, #459/#460).

### Dead code (verified sample)

- `remapDebtPersonRefs`, `remapIncomePersonRef`: no production caller (#471).
- 2 orphaned i18n keys × 3 locales. About 20 unreferenced CSS classes, 7 hand-verified (PERF-20).
- The v6 storage-adapter layer is gone: `storageAdapters.js` and `switchStorageBackend` have 0 references, and CLAUDE.md no longer mentions them. No other dead exports in `src/` per the scan; it skipped names referenced elsewhere, so dynamically dispatched names can't be ruled out.

### Dependencies

| Scope | Footprint |
|---|---|
| Client runtime | Chart.js 4.4.3 only, from CDN with SRI (205.6 KB / 60.3 KB gz) |
| Server runtime | 7 deps: `argon2` 0.45.1, `cookie-parser`, `express` 5, `express-rate-limit`, `node-pg-migrate`, `nodemailer`, `pg`. 119 lockfile packages; 21.8 MB `node_modules` in the image. `package.json` `allowScripts` still names `argon2@0.41.1` while 0.45.1 is installed (stale entry; check whether it is still needed). |
| Dev toolchain | 6 devDeps (Jest 30, Stryker 10, Babel 8) → 845 lockfile packages, 164.5 MB `node_modules`. Python: `playwright`, `pytest`, `pytest-asyncio`. |
| Dependabot | 2 open alerts, both dev-only in `package-lock.json`: #30 `minimatch` (medium, ReDoS-style DoS) and #27 `deepmerge` (low, prototype poisoning). Neither is shipped. |

### CI and test cost

- **Per PR.** About 97 runner-min, 13 min wall, about 1.9 GB of artifact downloads (see the CI table).
- **Biggest wins.** Rebalance `test-features-c` (PERF-10): wall −5 min *(est.)*. Merge small shards and cache browser deps (PERF-11): −15–20 runner-min *(est.)*.
- **Local suite.** About 70 min, because every Playwright test drives the one real stack serially. Fixing PERF-02/PERF-12 would also speed the harness, since `seed_state` imports through the same per-record path. A seed of the size used here takes 6.7 s *(measured)*.

### Documentation load

`CLAUDE.md` (PERF-22) is the only doc loaded on every session. A spot check found it current for v7: no references to the removed adapters. Its size, though, is mostly per-feature history that `CHANGELOG.md` (220 KB) and the specs already hold.

### Energy and efficiency (green-software view)

| Source of waste | Per occurrence | Fix |
|---|---|---|
| SW revalidation on every load | 66 requests, plus Cache Storage re-writes *(inference)* | PERF-07 |
| Unused locales | about 61 KB gz downloaded and about 237 KB parsed per cold load | PERF-05 |
| Redundant plan-settings PATCH | 1 request + about 5 queries per mutation | PERF-04 |
| Quadratic balance recompute | up to about 1 s CPU per Forecast render (about 4 s on a phone *(est.)*) | PERF-01 |
| Per-record import | about 1,900 requests per 432 KB restore | PERF-02/12 |
| CI | about 27 runner-min of setup per PR, 1.9 GB of artifact transfer | PERF-10/11 |
| Good | No polling timers; navigation causes 0 requests; `/api` is gzipped (192 KB → 15 KB); Reports renders only the active tab | n/a |

---

## Status of carried-over findings

| Prior finding | Prior audit | Status at v7.0.0 |
|---|---|---|
| H1: unbundled module graph blocks LCP/TTI (#146) | Sep, Oct | **Partly fixed.** #146 added modulepreload (15 leaf modules) and #278 lazy-loads 11 modules, so the CI Lighthouse gate passed (before #470). But eager JS has since grown to 62 modules / 1.64 MB decoded. Still open in spirit: see PERF-05, PERF-08. |
| H2: monolithic `styles.css` render-blocking (#190) | Sep, Oct | **Closed as accepted** (#190, 2026-09-14). The file has grown 170 → 264 KB (45 KB gz). No new finding; revisit if #470 shows FCP regress. |
| L1: `saveToStorage()` re-serializes full state, no debounce (#273) | Sep, Oct | **Superseded.** #273 is closed, and v7 rewrote `saveToStorage` to PATCH only plan settings. It is now one network request per call with no debounce or dirty check → PERF-04. |
| L2: `computeAccountBalance` not memoized | Oct | **Escalated to High (PERF-01).** It is now measurably slow (991 ms Forecast, 299 ms sort) at realistic data sizes. |
| L3: `getPaymentOrder` O(months × debts²) | Sep, Oct | **Open, informational.** 3.9 ms for 50 debts; not a bottleneck. |
| No minification (by design) | Sep | **Unchanged by design.** About 75% gzip savings over the wire. |
| HTTP/1.1, no `http2` | Sep | **Unchanged.** 87 requests per boot over 6 connections. Self-hosters with a TLS proxy get h2 there. Not raised as a new finding. |
| Re-run Lighthouse against Docker/nginx | Sep, Oct | **Blocked on #470** (it audits the login gate). |
| Sessions table never pruned | DB audit Sep | **Still open → PERF-19.** |
| Chart destroy-before-recreate, SW precache in sync, Ledger pagination, debounced What-If | Sep, Oct | **Still good.** 27 `new Chart` sites vs 31 `.destroy()`. Precache lists all 73 `src/` files. |

---

## Priority fixes

1. **PERF-02**: concurrency-limit the import and rollback fan-out (S). It stops imports, and the v6→v7 legacy migration, from failing on realistic datasets.
2. **PERF-03**: remap ledger override and cleared keys on import (M), with a round-trip test. Without it, every migrated user silently loses ledger overrides and cleared state.
3. **PERF-01**: compute each month's projection once per render (M). It removes the 0.3–1 s stalls on Forecast and the Accounts sort, and most of Health's boot cost.
4. **PERF-04, PERF-06, PERF-07, PERF-16**: quick wins, all S. Skip unchanged plan-settings PATCHes, `defer` Chart.js, make precached assets cache-first, and reuse the probe body.
5. **PERF-10**: split `test-features-c` (S) for about 5 min less wall per PR *(est.)*.
6. **PERF-05, PERF-08**: lazy-load non-English locales and render only the landing page on boot (M), for phone-class boot time.
7. **PERF-12**: spec a transactional bulk import endpoint (L). It fixes PERF-02/03/17 structurally and speeds the test harness.
