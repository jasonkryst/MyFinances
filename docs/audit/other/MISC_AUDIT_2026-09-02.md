# MyFinances — Supplementary Audit (Dependency / PWA / Architecture)

Date: 2026-09-02
App version audited: 4.40.0
Scope: dependency & supply chain, PWA/offline, code architecture & tech debt — areas not covered by the parallel documentation/security/a11y/i18n/features/performance/database/testing audits.

---

## 1. Dependency & Supply-Chain Audit

### Executive summary
No exact-pinned-vs-loose CDN risk (Chart.js is pinned to an exact version with an SRI hash — this is best practice, not a finding). Both `package.json` (root) and `server/package.json` have outdated dependencies and `npm audit` findings, but all are in **dev-only tooling** (root Jest/Stryker, never shipped) or **dev/ops CLI tooling** (server's `node-pg-migrate`), not runtime-reachable attacker-facing code. Dependabot config covers all 5 expected ecosystems and has a real merge history. CodeQL/Trivy workflows are present and reasonably configured, with one minor version-pinning inconsistency.

### Findings

**[Low] Root dev-tooling dependencies are one-plus major version behind, with transitive vulnerabilities (`package.json`, dev-only toolchain per CLAUDE.md)**
`npm outdated` (repo root):
| Package | Current | Latest |
|---|---|---|
| @babel/core | 7.29.7 | 8.0.1 |
| @babel/preset-env | 7.29.7 | 8.0.2 |
| @stryker-mutator/core | 8.7.1 | 10.0.0 |
| @stryker-mutator/jest-runner | 8.7.1 | 10.0.0 |
| babel-jest | 29.7.0 | 30.5.1 |
| jest | 29.7.0 | 30.5.1 |

`npm audit` (repo root): 11 vulnerabilities (5 low, 4 moderate, 2 high), all transitive through `@stryker-mutator/core`'s bundled `@babel/core`, `ajv`, `@inquirer/prompts` → `tmp`/`external-editor`. Highest-severity items: `tmp` (high — arbitrary file/dir write via symlink, path traversal) and `fast-uri` (high — SSRF/host-confusion variants) pulled in via Stryker's own dependency chain, not via Jest/Babel directly. `npm audit fix --force` would resolve these but requires bumping to Stryker 10.x (breaking per npm's own output).
Risk is low in practice: this toolchain runs only on developer machines / CI mutation-testing jobs and never ships to the browser (confirmed by CLAUDE.md: "Node/Jest/Stryker are never shipped to the browser"). Still worth scheduling a Stryker 9→10 upgrade to clear the advisories, since Dependabot's `dev-tooling` group (all deps in one PR) means this bump likely arrives as a single larger PR rather than incrementally.

**[Low] Server dependencies one-plus major behind, with two transitive advisories (`server/package.json`)**
`npm outdated` (server/):
| Package | Current | Latest |
|---|---|---|
| argon2 | 0.41.1 | 0.45.1 |
| express | 4.22.2 | 5.2.1 |
| express-rate-limit | 7.5.1 | 8.7.0 |
| node-pg-migrate | 7.9.1 | 9.0.0 |

`npm audit` (server/): 5 vulnerabilities (3 moderate, 2 high):
- `glob` (high — CLI command injection via `-c`/`--cmd` with `shell:true`) pulled in by `node-pg-migrate`. This is a **CLI-only** attack surface (a developer/operator running `npm run migrate` locally), not reachable by the running Express server or any HTTP request path — low real-world risk given this server has no open self-registration and is self-hosted per CLAUDE.md.
- `qs` (moderate — array-limit bypass, DoS via attacker-controlled `isBuffer`) via `body-parser` → `express` 4.22.2. This one **is** in the request-handling path (`express.json()`/`express.urlencoded()` parse the `qs` query-string library on every request). **Correction, verified 2026-09-03: this claim was wrong.** `express@4.22.2` is already the newest 4.x release and pins `body-parser@^1.20.5`, which is itself pinned to `qs@^6.14.0` (patched `qs@6.16.0` doesn't satisfy that range) — `npm audit fix` (no `--force`) confirmed makes zero changes (verified: empty `package.json`/`package-lock.json` diff after running it). The only real fix path is `body-parser@2.x` (which needs `qs@^6.15.2`, satisfiable), but `body-parser@2.x` is Express 5's bundled body-parser — reaching it means bumping `express` itself to `5.2.1`, exactly the major-version row already listed above in this same table. This is a genuine breaking-change dependency upgrade (Express 5 removes/changes several APIs — `app.del()`, `req.query` mutability, some `path-to-regexp` syntax), not a quick `npm audit fix`, and needs its own scoped effort with full server-test-suite verification, not a one-line fix.

**[Info] Dependabot config covers all 5 expected ecosystems and has a real PR history**
`.github/dependabot.yml` has entries for: npm root (`dev-tooling` group), npm `/server` (`server-deps` group), docker root (frontend nginx image), docker `/server` (backend Node image), and `github-actions` (grouped). All weekly. `git log --all --oneline | grep -i depend` shows merged Dependabot PRs across every one of these ecosystems (server npm deps, github-actions, root dev-tooling, docker `server` Node/Alpine bump, docker root nginx bump), plus the original `#111`/`8b236ea` PR that introduced the config — so it is not just configured but actively landing PRs.

**[Info] Chart.js CDN pin is done correctly**
`index.html:904`: `<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.3/dist/chart.umd.min.js" integrity="sha384-JUh163oCRItcbPme8pYnROHQMC6fNKTBWtRG3I3I0erJkzNgL7uxKlNwcrcFKeqF" crossorigin="anonymous">`. Exact version pin (not a range like `@4` or `@latest`) plus Subresource Integrity hash plus `crossorigin="anonymous"` — a jsdelivr-side substitution would fail the SRI check and the script simply wouldn't execute. CSP `script-src` also restricts to `'self' https://cdn.jsdelivr.net` (`index.html:8`). No action needed; this is the correct pattern and a good reference for any future third-party script additions.

**[Low] Minor GitHub Actions version inconsistency between the two security workflows**
`.github/workflows/codeql.yml` uses `github/codeql-action/{init,autobuild,analyze}@v3` throughout. `.github/workflows/trivy.yml` uses `github/codeql-action/upload-sarif@v4` (three times, lines 45/74/92) to push Trivy's SARIF output into the same Security tab. Both workflows target the same underlying `codeql-action` but pin different majors for the SARIF-upload step vs. the CodeQL analysis steps. Not a functional bug (both majors are still accepted by GitHub as of this writing), but worth aligning to one major version so a future breaking change to `codeql-action` doesn't surface inconsistently between the two workflows. Both workflows otherwise look sensible: push+PR+weekly-cron triggers, `security-events: write` permission scoped correctly, `continue-on-error: true` guarding the upload step specifically (so a SARIF-upload hiccup doesn't fail the whole job) rather than the scan itself.

---

## 2. PWA / Offline Audit

### Executive summary
The service worker implementation matches what CLAUDE.md describes: `CACHE_NAME` is correctly in sync with `APP_VERSION` (both `4.40.0`), the update flow waits for explicit user action rather than silently hot-swapping assets, and the Chart.js CDN script is runtime-cached (stale-while-revalidate) rather than precached. Test coverage is real but shallow — it proves the app shell survives a reload while offline, not that the app is *usable* offline (data entry, page navigation, chart rendering all untested offline).

### Findings

**[Info] `CACHE_NAME`/`APP_VERSION` are in sync**
`sw.js:6`: `const CACHE_NAME = 'myfinances-v4.40.0';` matches `src/utils.js:4`: `export const APP_VERSION = '4.40.0';`. Consistent with `tests/features/test_pwa.py::test_sw_cache_name_matches_app_version` passing today. No drift found.

**[Info] Precache vs. runtime-cache split matches CLAUDE.md's description**
`sw.js:13-32` (`PRECACHE_URLS`) explicitly enumerates the entire app shell — `index.html`, both stylesheets, `guide.html`/`guide.css`, the manifest, icons, and every `src/*.js` module (including the newer `ledgerCleared.js`, `postgresSync.js`, `postgresImport.js`, `loginGate.js`, locale files) — installed via `cache.addAll()` on `install`. The Chart.js CDN script is *not* in this list; instead `sw.js:98-109`'s fetch handler special-cases `request.url.startsWith(CDN_URL)` to use `staleWhileRevalidate` (serve from cache immediately if present, refresh in background), while all same-origin requests use `networkFirst` (prefer network so an old worker can't keep serving stale app-shell files while online, falling back to cache only when the network fetch throws). This exactly matches CLAUDE.md's "the Chart.js CDN script should be runtime-cached."

**[Info] Update flow matches CLAUDE.md — new service worker waits, doesn't auto-activate**
`sw.js:42-55`'s `activate` handler deliberately has no `skipWaiting()`/`clients.claim()` (comment at `sw.js:43-45` states this explicitly), and only responds to an explicit `SKIP_WAITING` postMessage (`sw.js:57-61`). `src/serviceWorker.js:8-16` listens for `updatefound`/`statechange` and calls `app.showUpdateAvailableBanner(...)` only when `installingWorker.state === 'installed' && navigator.serviceWorker.controller` (i.e., there's already an active controller — this is a genuine *update*, not the first-ever install). `src/ui.js:722-747`'s `showUpdateAvailableBanner()` renders a dismissible banner with a "Reload" button that posts `SKIP_WAITING` to the waiting worker; `src/serviceWorker.js:21-26`'s `controllerchange` listener then does the actual `window.location.reload()`, guarded by a `hasReloaded` flag so it can't double-fire. This is a correct, safe implementation of the wait-then-prompt pattern CLAUDE.md documents.

**[Medium] Offline test coverage proves the app shell survives a reload, not that the app is usable offline**
`tests/integration/test_pwa_offline.py` has exactly two tests:
- `test_app_shell_loads_offline_after_first_visit` — loads online once, goes offline, reloads, and asserts only that `h1` is visible and the page title is non-empty.
- `test_first_ever_visit_offline_does_not_load` — documents the expected limitation that a never-visited context can't load offline at all.

Neither test exercises: navigating between pages while offline (`switchPage`/`renderPageData` dispatch), adding/editing a debt or transaction while offline (localStorage read/write path, which doesn't depend on the network at all but is untested in this offline context), or confirming Chart.js actually renders a chart while offline (the `staleWhileRevalidate` CDN caching path is inferred to work from the code but never asserted against an offline chart render — e.g. the Reports or Strategy pages). Given offline support is explicitly called out as "the core offline promise of a PWA" in this file's own module docstring, a test that only checks for a non-empty `<h1>` after reload is a weak proxy for that promise. Recommend adding at least one offline test that performs a real interaction (e.g., switch to a data page and confirm rendered content, not just shell chrome).

**[Low] `manifest.json` omits a few optional-but-recommended PWA fields**
`manifest.json` has no `id` field (recommended by the current Web App Manifest spec so an app's identity is stable across `start_url`/`scope` changes on reinstall — without it, the browser derives identity from `start_url`, which is fine today but is a latent risk if `start_url` ever changes), and no `categories`/`shortcuts`. Not a functional bug — installability and offline behavior both work without them — just a minor completeness gap relative to current manifest best practice.

---

## 3. Code Architecture & Tech Debt Scan

### Executive summary
No `TODO`/`FIXME`/`XXX`/`HACK` comments exist anywhere in `src/` or `server/src/` — either an unusually clean codebase or a convention of not leaving marker comments (worth confirming with the team which it is, since neither a doc search nor grep found a substitute tracking mechanism like inline issue links). The `featureFn(app, ...)` delegation pattern is followed consistently; the exceptions found are legitimate pure-utility/pure-formatter modules (`sanitizers.js`, `utils.js`, `storageAdapters.js`) exactly as CLAUDE.md itself describes them, not violations. The one substantive finding is real: the ES module graph has several genuine import cycles centered on `ui.js` and `postgresSync.js` as hubs. A stale root-level planning document (`.plans/MIGRATION_PLAN.md`) describes a modularization effort that has since been superseded by the actual (larger, differently-organized) module set documented in CLAUDE.md.

### Findings

**[Info] No TODO/FIXME/XXX/HACK markers found**
`grep -rn "TODO\|FIXME\|XXX\|HACK" src/ server/src/ --include=*.js` returned zero matches. Either genuinely no known-gaps-with-markers exist, or the team tracks such gaps exclusively via GitHub issues rather than inline comments — worth a 30-second confirmation with the project owner, since an audit that finds "nothing" here is different from an audit that confirms "nothing is missing."

**[Info] `featureFn(app, ...)` delegation pattern is followed; apparent exceptions are intentional pure-utility modules**
Comparing exported-function counts against how many take `app` as the first argument across all 51 files in `src/`, the modules with the lowest ratios are exactly the ones CLAUDE.md documents as pure/shared-utility modules by design:
- `sanitizers.js`: 16 exported functions, 0 take `app` (sanitizer functions operate on a raw record, not the app instance — matches CLAUDE.md's description).
- `utils.js`: 26 exported functions, 1 takes `app` (shared formatting/date/number helpers — matches CLAUDE.md's description of it hosting "shared formatting/date/number helpers").
- `storageAdapters.js`: 3 exported functions, 0 take `app` (adapter factory/backend-preference functions predate any `app` instance at boot).
- `ui.js`: 17 exported functions, 8 take `app`. The 9 that don't (`applyTheme`, `updateFormVisibility`, `showMilestone`, `showStorageQuotaWarning`, `showUpdateAvailableBanner`, `showNetWorthMilestone`, `showPgErrorToast`, `showDeleteConfirmModal`, `showAlertModal`) are all generic modal/toast/banner helpers that take only the specific data they render (a message string, a debt name, a usage number) rather than the full app object — a reasonable, narrower-surface variant of the same pattern rather than a violation of it.

No module was found reaching into `window`/`document` global state in a way that bypasses its own module boundary or duplicates logic that belongs elsewhere; DOM access (`document.*`) is heaviest in `ui.js` (120 references) and the feature modules that own significant rendered UI (`debts.js` 57, `savings.js` 52, `bills.js` 31, `income.js` 30), which is expected given those modules own that DOM.

**[Medium] Real circular import chains exist in the ES module graph, centered on `ui.js` and `postgresSync.js`**
A dependency-graph DFS over every `import ... from './*.js'` statement in `src/` (verified by hand against the actual `import` lines, not just the automated pass) found several genuine cycles:

1. `accounts.js → ledgerTransactions.js → recurring.js → accounts.js`
   `accounts.js:4` imports `getLedgerTransactionsForMonth` from `ledgerTransactions.js`; `ledgerTransactions.js` imports `getRecurringOccurrencesInMonth` from `recurring.js`; `recurring.js:11` imports `buildAccountOptionsHtml` back from `accounts.js`.
2. `postgresSync.js ↔ storage.js` (direct 2-file cycle)
   `postgresSync.js:1` imports `getCsrfCookie` from `storage.js`; `storage.js:5` imports `pgDeleteAll` back from `postgresSync.js`.
3. `postgresSync.js → ui.js → ledger.js → settings.js → postgresSync.js`
   `ui.js:2` imports `renderLedgerPage` from `ledger.js`; `ledger.js:4` imports `getSetting`/`setSetting` from `settings.js`; `settings.js:4` imports `pgPut` from `postgresSync.js`; `postgresSync.js:3` imports `showPgErrorToast` back from `ui.js`.
4. `ui.js → ledger.js → ledgerOverrides.js → ui.js`
   `ledger.js:6` imports from `ledgerOverrides.js`; `ledgerOverrides.js:5` imports `showAlertModal` back from `ui.js`.
5. `accounts.js → ledgerTransactions.js → recurring.js → postgresSync.js → ui.js → accounts.js`
   `ui.js:3` imports `refreshAccountSelectors` back from `accounts.js`, closing a longer cycle through the same `recurring.js`/`postgresSync.js` hub.

None of these are the specific example CLAUDE.md's audit brief flagged as worth checking (`ledgerCleared.js` does *not* cycle back to `ledger.js` — it only imports `postgresSync.js`), but the broader graph does have real cycles. Because every export involved is a hoisted `function` declaration (not a `const`/class field), these do not currently crash at module-evaluation time — ESM circular imports of hoisted function declarations resolve fine as long as nothing calls the imported function during synchronous top-level module evaluation, which is the case here. That said, this is real architectural debt: `ui.js` (generic UI/modal layer) and `postgresSync.js` (generic sync layer) are both importing from and being imported by domain feature modules (`ledger.js`, `accounts.js`, `recurring.js`, `settings.js`), so neither is actually a lower layer than the feature modules despite reading that way. This raises real risk for future refactors — e.g., converting any of the involved exports from a `function` to an arrow-function `const` (common during a refactor for `this`-binding reasons) would introduce a genuine TDZ crash on that cycle. Consider either accepting this as a known trade-off (many small ES modules in a no-build-step app naturally tend toward this) or extracting the two hub responsibilities (`ui.js`'s modal helpers, `postgresSync.js`'s CSRF/error-toast coupling) into leaf-level modules the feature modules can depend on one-directionally.

**[Low] `.plans/MIGRATION_PLAN.md` is stale planning scratch, not active work — RESOLVED 2026-09-03: deleted.**
`.plans/` contains a single file, `MIGRATION_PLAN.md` (12.6 KB, last touched by commit `9368e8c` "Bug Fixes", dated 2026-05-28). It documents an "app.js to `src` module migration" with a "Target Architecture" section listing a much smaller/differently-organized module set (`src/features/debts/`, `src/features/strategy/`, `src/features/ledger/`, `src/services/storage.js`, etc.) than what actually exists today — the real `src/` directory has 51 flat files (`debts.js`, `strategy.js`, `strategyPlanCalculation.js`, `strategyCalendar.js`, `strategyComparison.js`, `strategySummaryTable.js`, `strategyScheduleTable.js`, `ledger.js`, `ledgerTransactions.js`, `ledgerOverrides.js`, `ledgerCleared.js`, `postgresSync.js`, `postgresImport.js`, `loginGate.js`, `i18n.js`, `locales/`, etc.) rather than the nested `src/features/<domain>/` layout the plan describes as its target, and CLAUDE.md documents the flat-file layout as the actual, intentional architecture. The "Status"/"Migration Phases" sections describe phases as "completed" that predate features shipped much later (i18n, PWA, Postgres backend, ledger-cleared tracking). This file is dead planning scratch from an earlier, superseded refactor and should either be deleted or clearly marked historical — as-is, a future contributor searching `.plans/` for "the" architecture plan would be misled about the current target structure.

---

## Summary of severities

| Section | Critical | High | Medium | Low | Info |
|---|---|---|---|---|---|
| Dependency & Supply Chain | 0 | 0 | 0 | 3 | 2 |
| PWA & Offline | 0 | 0 | 1 | 1 | 3 |
| Code Architecture & Tech Debt | 0 | 0 | 1 | 1 | 2 |
