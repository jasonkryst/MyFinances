
# Changelog

All notable changes to MyFinances are documented here.  
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).  
Detailed specs and implementation notes live in [`docs/superpowers/`](docs/superpowers/).

---

## [4.27.0] — 2026-08-30

### Fixed
- **Issue #95**: JSON export/import now works correctly on the PostgreSQL backend.
  - **Export** was already correct (reads in-memory state populated from the server at boot); no change needed.
  - **Import replace mode**: previously `saveToStorage` only PATCHed `/api/plan-settings`, leaving all resource arrays (debts, accounts, incomes, etc.) unwritten to the server — on the next page reload, `loadFromPostgres` silently discarded the import. Import now: (1) wipes all server resources via `pgDeleteAll`, (2) POSTs accounts first to receive server-assigned IDs and builds a `localId → serverId` map, (3) remaps `accountId`/`targetAccountId` FK references across all other resources, (4) POSTs all resource arrays in parallel, (5) PUTs keyed resources (ledger overrides, net-worth snapshots, settings), (6) re-creates milestones, and (7) PATCHes plan-settings. On any failure it rolls back: wipes the partial write and re-POSTs the pre-import snapshot.
  - **Import merge mode**: builds an ID map from existing server accounts (matched by name), POSTs only new (unmatched) records per resource, PUTs keyed resources as upserts, and rolls back only newly created records on failure.
  - **`clearAllData` (pgDeleteAll)**: now also deletes milestones via `DELETE /api/plan-settings/milestones` and resets strategy/payment/stimulus fields on the plan-settings row, preventing them from surviving a full data clear.

### Added
- **Server**: `DELETE /api/plan-settings/milestones` endpoint — removes all net-worth milestones for the authenticated user. Used by the replace-mode import to wipe stale milestones before re-importing.

---## [4.26.0] — 2026-08-30

### Fixed
- **Issue #93**: Expenses silently disappeared after page reload. `addExpense` and `saveEditExpense` stored `expense.date` as a JavaScript `Date` object; `JSON.stringify` serialised it as a full UTC ISO-8601 timestamp (e.g. "2026-08-30T05:00:00.000Z"), which the `sanitizeDateISO` regex (`^\d{4}-\d{2}-\d{2}`) rejected on reload, causing `sanitizeParsedState` to silently drop every expense. Fixed by storing the date as a bare YYYY-MM-DD string. `sanitizeDateISO` also updated to accept full ISO timestamps, self-healing any records already corrupted in localStorage.
- **Issue #92**: `perMonthStimulus` (per-month extra payment schedule in the Strategy tab) was persisted to localStorage but absent from both `exportAllJSON` and `importAllJSON`, silently wiping it on every export/import cycle. Added to the export payload and restored in both import branches. Export `version` field now reads `APP_VERSION` instead of the hardcoded `'4.0.0'`. The "no data" guard in `importAllJSON` widened to accept files with only accounts, savings goals, or reconciliations. Merge mode now deduplicates all name-keyed collections (accounts, incomes, bills, recurring templates, sinking funds) instead of replacing them wholesale.

---
## [4.25.0] — 2026-08-30

### Fixed
- `docker-compose.yml`: Postgres secret file path is now configurable via `POSTGRES_SECRET_FILE` env var (default `./secrets/postgres_password.txt`), fixing Portainer GitOps deployments where the git checkout directory does not contain the gitignored secret file.

### Documentation
- `DEPLOYMENT.md`: new "PostgreSQL Backend Deployment" section covering prerequisites, `setup.sh`/`setup.ps1` first-time bootstrap, HTTPS requirements, Portainer GitOps wiring (including the `POSTGRES_SECRET_FILE` host-path step), update workflow, and bare-Node manual path.
- `server/README.md`: replaced outdated `cp .env.example .env` / `DATABASE_URL` instructions with `setup.sh` quick-start and bare-Node local-dev path; noted that Docker secrets replace `.env` for container deployments.

---
## [4.24.0] — 2026-08-26

### Added
- Deployment secrets automation: `setup.sh` (Linux/Mac) and `setup.ps1` (Windows) generate a cryptographically random Postgres password, write `secrets/postgres_password.txt`, start the Docker stack, run migrations, and prompt to create the first user — all in one command.
- `server/docker-entrypoint.sh`: server container now reads `/run/secrets/postgres_password` at startup and constructs `DATABASE_URL` internally so the database password is never exposed as an environment variable (invisible to `docker inspect`). Falls back to `DATABASE_URL` env var for local dev/test.
- `.env.example` documenting available environment variables for manual/Portainer deployments.
- Error toast (`showPgErrorToast`) surfaced in `src/ui.js` for failed Postgres sync operations, with `.pg-error-toast` styles in `styles-csp-classes.css`.

### Fixed
- Income mutations (`addIncome`) now call `pgPost /api/incomes` and swap the DB-assigned id — income entries were not persisting to Postgres.
- Net-worth snapshot captures now call `pgPut /api/net-worth-snapshots/:date` — snapshots were not persisting to Postgres.
- `docker-compose.yml`: server service mounts the `postgres_password` Docker secret; `DATABASE_URL`/`POSTGRES_PASSWORD` env var removed.
- CI `test-postgres` job uses `docker compose run --rm` for migrations and user creation so they go through the container entrypoint and inherit `DATABASE_URL`.

---

## [4.23.0] — 2026-08-25

PostgreSQL Phase 2b — per-resource mutation wiring. Every add/edit/delete operation in the frontend now persists directly to the Postgres REST API when the Postgres backend is selected. New `src/postgresSync.js` module provides `pgPost`/`pgPatch`/`pgDelete`/`pgPut`/`pgDeleteAll` helpers shared by all 11 feature modules. `addEmergencyFund` handles both create and update paths. `clearAllData` fans out delete-all requests to all 13 resource endpoints. Server adds `DELETE /` to both `crudRouter.js` and `keyedRouter.js` for bulk deletion. See `docs/superpowers/specs/2026-08-24-postgresql-storage-phase2b-design.md`..

---

## [4.22.0] — 2026-08-23

### Added
- PostgreSQL backend option in Settings modal: selecting "PostgreSQL (self-hosted server)" saves the preference and reloads the page
- Full-page `#loginGate` overlay shown before the app shell when Postgres is selected and no valid session exists
- Async app bootstrap: `DebtTrackerApp.init()` (called from an async `DOMContentLoaded` handler) handles session check, login gate, and parallel load from 14 REST endpoints via `Promise.all`
- `getCsrfCookie()` helper in `storage.js` for all authenticated Postgres mutation calls (Phase 2b will use this at every mutation site)

---

## [4.21.0] — 2026-08-23

### Added
- **Self-hosted PostgreSQL storage backend (Phase 1, issue #53)** — a standalone Node.js API (`server/`) with relational tables and granular REST endpoints for every record type, secured by argon2id password hashing and server-side sessions. Opt-in — the browser app's local-only, zero-setup mode is unchanged. Frontend integration (an async storage adapter, login UI, Settings backend picker) is a separate, upcoming Phase 2.

---

## [4.20.0] — 2026-08-18

### Changed
- **Installed PWA now fills the window edge-to-edge** — the standalone app window previously rendered the same centered `.container` card (capped at 1200px, gradient backdrop visible as side gutters) used in a browser tab, which read as "a website" rather than "an app." A new `@media (display-mode: standalone)` rule drops the card's max-width, rounding, shadow, and body padding so content fills the installed window at any size; browser-tab rendering is unchanged.

---

## [4.19.0] — 2026-08-17

### Fixed
- **Clipped tables on narrow/PWA viewports** — the Debt Overview card's category grid and the Reports "Account Balances" (Money Flow) grid used fixed-pixel columns inside an `overflow: hidden` container, so on narrow phone-width viewports the Balance/Projected columns were silently clipped instead of wrapping or scrolling. Both now restack into labelled cards below their breakpoint, matching the pattern already used by `.nw-history-table--compact` and `.var-row`.

### Changed
- **CI now required to merge to `main`** — branch protection requires all 9 CI jobs (tests, security, a11y, mutation testing, Docker build, Trivy, Lighthouse) to pass and the branch to be up to date before a PR can merge.

---

## [4.18.0] — 2026-08-17

### Added
- **Last updated date on debt cards** — every debt card now shows the date it was created or last edited (balance/minimum-payment updates via "Update Balance", and inline edits, both refresh the date). Preserved through export/import like any other debt field. (#88)

### Fixed
- **Stale data after import** — importing a backup now immediately refreshes whichever page you're currently viewing (Accounts, Reports, Ledger, etc.), not just the Debts list, so newly imported data shows up without navigating away and back. (#87)

---

## [4.17.0] — 2026-08-09

### Fixed
- **Version Update** — Updates version.

---

## [4.16.0] — 2026-08-09

### Fixed
- **Stale Chrome releases** — unhashed app-shell files now revalidate online instead of being marked immutable for a year, and the service worker now prefers fresh same-origin responses with offline cache fallback. This prevents older HTML, JavaScript, CSS, manifests, or service workers from keeping visitors on a prior release while preserving offline support. (#83)

---

## [4.15.0] — 2026-08-09

### Added
- **Money Flow Sankey diagram** — new single-month flow visualization on the Reports → Money Flow tab, showing money moving from income sources through the account to bills, expenses, recurring costs, debt minimums, and savings, as hand-drawn inline SVG (no new external dependency — Chart.js remains the app's only one). A Surplus/Shortfall node balances the diagram when income and outflow for the month don't match. (#79)

---

## [4.14.0] — 2026-08-09

### Added
- **Cash Flow Trend chart** — new multi-month (3M/6M/12M) view on the Reports → Money Flow tab, showing Income vs. Outflow per month as bars with a Net balance line overlaid, alongside the existing single-month Money Flow chart. Reuses the ledger-derived per-month totals that already power the Income vs Expenses report, so the two stay consistent. (#76)

---

## [4.13.0] — 2026-08-06

### Added
- **PWA support (installable + offline)** — added `manifest.json`, a root-scoped `sw.js` service worker (app-shell precaching + stale-while-revalidate runtime cache for the Chart.js CDN script), and a generated icon set (`icons/`, via `tools/generate-icons.js`), so the app can be installed to a home screen/desktop and loads with no network connectivity after a first visit. New service worker versions install and wait rather than silently taking over — a dismissible "Reload" banner prompts the user instead. See `docs/superpowers/specs/2026-08-06-pwa-support-design.md` (#75).

---

## [4.12.1] — 2026-08-05

### Fixed
- **CI pipeline failures on Trivy, Lighthouse, and accessibility checks** — the same 3 failures existed on `main` (not caused by prior PRs) and were fixed independently: `Dockerfile` now runs `apk update && apk upgrade` to pick up patched Alpine packages, clearing 11 fixable HIGH Trivy CVEs; `nginx.conf` gzips CSS/JS/JSON/SVG and the Lighthouse CI job now runs against the real `docker compose` nginx container instead of `python -m http.server`, bringing the performance score above the 0.8 minimum; `index.html`/`guide.html` gained `<meta name="description">` tags and the Health page's `data-health-nav` links gained `href="#"` (matching the existing pattern in `forecast.js`), fixing the SEO score that had been masked by the performance failure; a scoped color override for `.rpt-cal-today .rpt-cal-count` fixed a calendar contrast regression.

---

## [4.12.0] — 2026-08-05

### Changed
- **Consolidated Export/Import into a Backup & Restore modal** — the toolbar's separate ⬇️ Export / ⬆️ Import icon buttons are now one `#dataTransferBtn` button that opens a two-tab modal (Export / Import). `#exportJsonBtn`/`#importJsonBtn`/`#importJsonInput` kept their ids and behavior, just relocated. Import's feedback (invalid file, no recognisable data, file too large, read error, and the Replace-vs-Merge choice) moved from native `alert()`/`confirm()` popups into inline modal UI, styled with the existing `.target-result` success/warning/error banner pattern. See `docs/superpowers/specs/2026-08-05-data-transfer-modal-design.md`.

---

## [4.11.0] — 2026-08-04

### Changed
- **Theme selector moved into Settings (#71)** — the Light/Dark/High Contrast `<select>` no longer lives in the always-visible header toolbar; it's now the first control inside the Settings modal (⚙️ gear icon), grouped with Data Storage and Language. Its `id` (`themeSwitcher`), change-applies-immediately behavior, localStorage persistence, and the command palette's "Cycle theme" action are all unchanged — only its location moved. Translated strings moved from `toolbar.theme*` to `settings.theme*` in `src/locales/{en,es,pl}.js`.

---

## [4.10.0] — 2026-08-04

### Added
- **i18n infrastructure + Spanish/Polish pilot (#35)** — new `src/i18n.js` module (`t()` lookup with English fallback, `applyStaticTranslations()` for static markup, locale persisted under `debtTrackerLocale`) and `src/locales/{en,es,pl}.js` dictionaries. Navigation, the toolbar, the Settings modal, and the Health dashboard are translated into Spanish and Polish, selectable from a new Language control in Settings. `formatCurrency`/`formatShortDate`/`formatMonthYear` now format numbers/dates per the active locale everywhere in the app, not just the translated pages.

### Known limitations
- Only nav/toolbar/Settings/Health are translated — Accounts, Income, Liabilities, Recurring, Savings, Plan, Reports, Ledger, and Reconcile remain English pending follow-up issues.
- No grammatical pluralization — every translated string uses one fixed form regardless of count (e.g. Polish would grammatically need a different word form for 1 vs. 2-4 vs. 5+ months).
- No browser-language auto-detection on first run; the locale defaults to English until a user explicitly picks one in Settings.

---

## [4.9.0] — 2026-08-03

### Added
- **High Contrast theme (#33)** — the header's Light/Dark toggle is now a labeled 3-way selector (Light / Dark / High Contrast). High Contrast is built as Dark Mode plus extra overrides (`body.dark-mode.high-contrast-mode` in `styles.css`), so it inherits dark mode's existing surface colors and chart/gauge color logic, then swaps the ~20 shared CSS custom properties and a handful of known hardcoded-color spots (buttons, calendar pills, header/nav/inputs/tables, focus ring) to a pure black/white/bright-accent palette clearing WCAG AA (and mostly AAA) contrast. `guide.html`/`guide.css` pick up the same theme. The command palette's theme action now cycles Light → Dark → High Contrast.

### Fixed
- **`.nav-group-label` contrast (#33)** — the "Overview"/"Manage"/"Analyze" nav pills used translucent-white-on-translucent-white styling whose real contrast depended on the header gradient behind them; measured at ~2.9:1 in light mode against WCAG 1.4.3's 4.5:1 minimum (and intermittently flagged `pytest tests/a11y/` at other ratios due to a CSS-transition-timing artifact in the audit script). Redesigned as a solid dark badge with near-opaque text, which composites to ~6.8:1 (light) / ~12.7:1 (dark) regardless of theme.

### Known limitations
- High Contrast reuses dark mode's several hundred other component-specific hardcoded-color overrides as-is rather than giving each a bespoke high-contrast pass — see the scope note in `styles.css` above the `body.dark-mode.high-contrast-mode` block.

---

## [4.8.1] — 2026-08-03

### Fixed
- **Summary Report mobile table scroll (#31)** — the Reports → Summary tab's Cash Flow, Account Balances, and Net Worth tables shared the `.nw-history-table` class (and its 680px `min-width`) with genuinely wide tables like Net Worth History and Cash Flow Forecast, forcing an unnecessary horizontal scrollbar on mobile even though they only have 2–4 narrow columns. They now opt out via a new `.nw-history-table--compact` modifier and restack into label/value cards below 640px width, while the wider report tables keep their original scroll-in-wrapper behavior.

---

## [4.8.0] — 2026-08-02

### Added
- **Bonus Advisor (#64)** — one-time bonuses can now be tagged with a Purpose (Cash Flow or Long-term Savings), shown as a badge in the bonus list. A new "What should I do with this?" button computes real numbers for each option: interest saved and months-sooner debt payoff (via the existing `DebtCalculator` stimulus mechanism) vs. projected 1-year/5-year growth (via the existing account-interest helper) if left in a linked interest-bearing account. The Cash Flow card also includes a "Pay Off Debts Now" plan — which debts the bonus can eliminate outright (smallest balance first) plus any remainder applied to the highest-rate debt remaining — showing how much monthly cash flow frees up immediately, as a deliberately non-interest-optimal alternative to the avalanche/snowball result above it. New `src/bonusAdvisor.js` module; `purpose` added to the bonus record and sanitized in `src/sanitizers.js`. See `docs/superpowers/specs/2026-08-02-bonus-advisor-design.md`.
- **Interest-rate filters** — the Debts list toolbar gains an "Interest" dropdown (Any / Interest Bearing Only / No Interest Only, by actual APR) next to the existing category filter, and the Bonus Advisor's "Pay Off Debts Now" plan gets a matching filter to narrow which debts it considers.

---

## [4.7.3] — 2026-08-02

### Added
- **Stryker.js mutation testing (#52)** — new dev-only Jest + Stryker toolchain (`package.json`, `stryker.config.mjs`) mutation-tests the pure `src/debtCalculator.js`, `src/utils.js`, and `src/sanitizers.js` functions covered by new `tests/unit/*.test.js`. `stryker.config.mjs`'s `mutate` scope uses line ranges limited to the tested functions (a whole-file scope produced a ~22% score dominated by untested-function no-coverage mutants); the resulting real local score (47.04%) sets the `thresholds` (`low: 47`, `break: 37`, `high: 52`). Wired into a new `mutation-testing` CI job. See `docs/superpowers/specs/2026-08-02-stryker-js-mutation-testing-design.md` and `docs/superpowers/plans/2026-08-02-stryker-js-mutation-testing.md`.

---

## [4.7.2] — 2026-07-29

### Added
- **CI workflow (Story #57)** — `.github/workflows/ci.yml` runs pytest by category (security/feature/ui/integration), a Docker build, a Trivy image scan, and a Lighthouse audit (`lighthouserc.json`) on every push/PR. See `docs/superpowers/specs/2026-07-28-github-actions-ci-workflow-design.md` and `docs/superpowers/plans/2026-07-28-github-actions-ci-workflow.md`.
- **README CI/Docker badges** — CI, Copilot review, and Docker release status badges added to `README.md`.

### Fixed
- **CI reliability** — headless Chrome now launches with `--no-sandbox` under CI's containerized runner; the Docker base image was bumped to resolve known CVEs; the pytest job's broken pip cache was removed, `@lhci/cli` pinned to a real published version, server-readiness detection fixed, job timeouts added, and SARIF upload guarded so it doesn't fail on fork PRs (which don't have upload permissions).

### Changed
- **Docker image renamed** from `bookwheel` to `myfinances` in `docker-image.yml` to match the project name.

_Note: `4.7.1` was a version-only commit with no accompanying changes and has no changelog entry — see [#59](https://github.com/jasonkryst/MyFinances/issues/59)._

---

## [4.7.0] — 2026-07-17

### Changed
- **Internal src/ reorganization** — split six oversized modules (`reports.js`, `strategy.js`, `ledger.js`, `debts.js`, `storage.js`, `app.js`) into 15 new focused files (`sanitizers.js`, `dataExport.js`, `ledgerTransactions.js`, `ledgerOverrides.js`, `strategyPlanCalculation.js`, `strategyCalendar.js`, `strategyComparison.js`, `strategySummaryTable.js`, `strategyScheduleTable.js`, `debtBreakEven.js`, `reportsNetWorth.js`, `reportsCalendar.js`, `reportsCashFlow.js`, `reportsVariance.js`, `reportsSummary.js`), and consolidated a dozen instances of copy-pasted logic into shared helpers in `utils.js` and `accounts.js` (date formatting, `escapeHtml`, currency formatting, account-type icons, account `<option>`-list building, and a `recalculatePaymentPlan` helper unifying five near-duplicate payment-recalculation blocks). Fixed a real timezone-rollback bug found during the date-formatter consolidation (some copies padded bare `YYYY-MM-DD` strings before formatting and some didn't, which could render the wrong day near UTC midnight). Two misplaced functions moved to their correct modules (`switchLiabilitiesSubTab` to `ui.js`, an income-record migration to `storage.js`), and dead code removed (`app.js` compatibility shims, a defensive `formatCurrency` fallback with no live path). Pure refactor — no user-facing behavior change; see `docs/superpowers/specs/2026-07-16-src-reorganization-design.md` and `docs/superpowers/plans/2026-07-16-src-reorganization.md`.

---

## [4.6.1] — 2026-07-15

### Fixed
- **Ledger running-balance summation bug (#46)** — same-date rows (a "Balance Rollover" marker landing on the same day as that month's own transaction, two same-day real transactions, or a reconciliation sharing a date with either) could display in an order that didn't match the true running-balance chain. The tie-break lived only in `getLedgerTransactions`'s own fixed descending sort and used a type-priority heuristic (rollover/reconciliation always last); the actual on-screen order comes from `getFilteredSortedLedgerTransactions`'s separate sort, which had no tie-break at all and simply preserved whatever order rows arrived in — correct by accident under the default descending view, but visibly wrong under ascending (a $0.00 rollover row could appear to silently shift the balance by the amount of an adjacent transaction). Replaced the heuristic with a `_seq` field recording the true order each row's balance was computed in, and made the display sort break same-date ties by `_seq` in the same direction as the primary date sort. Added 7 tests (`tests/features/test_ledger.py`) covering the rollover/transaction collision, plain same-day real-transaction ties, a three-way rollover+bill+reconciliation collision, overrides applied to a colliding transaction, and multi-account independence — each verified in both ascending and descending sort.

---

## [4.6.0] — 2026-07-14

### Added
- **Storage abstraction layer (#41)** — `storage.js` now persists through a swappable adapter (`src/storageAdapters.js`) instead of calling `localStorage` directly. Users can choose Local Storage (default, persists across visits) or Session Storage (cleared when the tab closes) from the Settings modal; switching migrates existing data into the new backend and clears the old copy. The adapter interface stays synchronous by design — a documented seam for a future async backend (e.g. IndexedDB) exists but isn't implemented in this change. See `docs/superpowers/specs/2026-07-14-storage-abstraction-design.md`.

---

## [4.5.0] — 2026-07-14

### Fixed
- **Spending report UI tests (#43)** — `tests/ui/test_spending_ui.py` and `tests/ui/test_chart_accessibility.py::test_spending_charts_have_sr_tables` seeded expense fixtures with a hardcoded `2026-06` date; since `renderReportsSpending()` derives "this month" from the live system clock, the fixtures silently fell out of range once the wall clock passed June, leaving the Spending tab in its empty state for 7 tests. Added a `current_month_iso()` test helper (`tests/conftest.py`) and seed expense dates against the real current month instead

---

## [4.4.1] — 2026-07-15

### Added
- **10 Playwright tests** (`tests/features/test_accounts.py`) — dedicated Accounts-page coverage for the interest-rate APY badge introduced in 4.4.0 (#45): threshold boundary (0.01% shows, 0.009% doesn't), whole-number and max-rate (100%) formatting, per-card scoping across multiple mixed-rate accounts, badge removal on edit-to-zero, reload persistence, and import-clamped/invalid-rate display

### Changed
- Synced `README.md` and `tests/README.md` test counts/file listings with actual suite state (497 tests / 54 files); both had drifted since 4.3.0

---

## [4.4.0] — 2026-07-14

### Added
- **Interest Income (#30)** — accounts can now carry an annual interest rate (% APY). Non-zero rates auto-generate a monthly *Interest* deposit in the Ledger on the last day of each month, computed as APY ÷ 12 on the account's projected end-of-month balance and compounding month over month. Interest rows support the existing ledger amount override, and an overridden (true) amount feeds subsequent months' compounding. Interest counts as income in Reports (stat strip, income-by-source chart, month-over-month summary, summary metrics, calendar, and net-worth snapshot income). Zero/negative-balance months and sub-cent amounts generate nothing; debt-side interest remains modeled in the Debts module
- **Accounts UI** — Interest Rate (% APY) field on the Add Account form and inline edit card; accounts with a rate show a 📈 APY badge
- **23 Playwright tests** (`tests/features/test_interest_income.py`, `tests/features/test_storage_import.py`, `tests/integration/test_interest_income_workflow.py`) — engine math, compounding (ledger and Cash Flow Forecast), override feedback, last-day posting, projection-only persistence, negative/zero/sub-cent skips, accounts UI CRUD, reports integration (stat strip and summary metrics), import sanitization (clamping −5 → 0, 200 → 100, junk → 0, round-trip), and an end-to-end workflow

---

## [4.3.2] — 2026-07-01
### Fixed
- **Dark Mode Support** - Fixes issues with dark mode theme colors across various parts of the app.

## [4.3.1] — 2026-07-01
### Fixed
- **Modal Dialog** - Fixes issues with dark mode theme colors.

## [4.3.0] — 2026-06-30

### Added
- **Break-Even Analysis per Debt** — each credit-card debt card now shows a Payoff Analysis badge comparing your plan payment to minimum-payment-only: months to payoff, total interest, months saved, and interest saved; no-plan state shows a minimum-only estimate with a clear banner
- **Min-type toggle** — switch the minimum-payment scenario between Fixed (constant minimum) and % of Balance (recalculated each month) directly on the badge; updates live without page reload
- **Mini payoff chart** — Chart.js line chart on each debt card showing balance decay over time for both scenarios; fully accessible via a companion screen-reader data table
- **Accelerate modal** — "Accelerate this debt →" button opens a modal with a live extra-payment preview: type an amount and instantly see new payoff date, interest saved, and a comparison chart; "Apply to Plan" navigates to the Plan page with the new total pre-filled
- **Interest Saved / Months Saved columns** — two new sortable columns in the Plan page Debt Summary table showing per-debt savings vs. minimum-only; `fixedAmount` debts show `—`; footnote explains the comparison baseline
- **13 Playwright tests** (`tests/features/test_break_even.py`) — 8 positive + 5 negative/edge cases covering badge no-plan state, plan-active auto-render, min-type toggle, accelerate modal open/preview/apply, plan table columns, fixed-amount exclusion, 0% APR, balance=minimum, invalid percent, $0 extra, negative extra

### Fixed
- Dark mode contrast for `.break-even-show-link` (blue-400 `#60a5fa`), `.break-even-savings--positive`, `.be-col-saved`, and `.accelerate-preview-delta` (green-400 `#4ade80`) — matches the established dark mode color palette

---

## [4.2.1] — 2026-06-28

### Changed
- Reorganized README: removed three duplicate sections (Security & Compliance, Data Privacy & Security, stale Testing brief), extracted version history to dedicated `CHANGELOG.md`, expanded Features section with Navigation/Accessibility, Health Dashboard, Reconciliation, and Ledger sub-sections, updated all test counts to 452/51 files
- Created `CHANGELOG.md` — version history from v3.0 through v4.2.0 in Keep a Changelog format; README now links to it instead of growing inline
- Updated `ROADMAP.md`: added v4.2.0 entry, corrected release schedule from v3.x to v4.3/v4.4/v5.x, expanded Tier 5 with guide content audit and Savings Goals scope note
- Updated `tests/README.md`: 344→452 tests, 11 new test files added to directory listing and coverage matrix
- Created `docs/README.md`: index for the `docs/` folder describing audit, superpowers, and implementation subdirectories
- Saved full test-suite audit report `docs/audit/test/TEST_REPORT_2026-06-28.md` (452/452 passed, all June 19 coverage gaps closed)

---

## [4.2.0] — 2026-06-28

### Fixed
- Ledger running balance now snaps to the authoritative statement balance on reconciliation marker rows when "Reconciliation Adjusts Balance" mode is active, so all subsequent rows project forward from the correct value
- Added a sort tiebreaker so synthetic rows (rollover markers, reconciliation markers) always appear below same-date real transactions in newest-first view, eliminating confusing balance jumps from unstable ordering

### Added
- Inline ℹ info icon on every reconciliation marker row in the Ledger: muted-grey when the reconciliation mode is "Visible only" (informational), primary-blue when "Adjusts Balance" (balance-snapping active); tooltip explains current behaviour and references the setting by name; keyboard-accessible via `tabindex`

---

## [4.1.0] — 2026-06-24

### Added
- Print / Save as PDF button on Liabilities, Recurring, Plan (Strategy), Savings, Ledger, and Reconcile pages — completing the print-friendly rollout across every page; `@media print` rules hide forms and controls so only read-only data content prints

### Fixed
- Five tables in Reports, Reconciliation, and Ledger were not wrapped in `.table-wrapper`, causing columns to be cut off on narrow mobile viewports; now consistently wrapped in the horizontal-scroll pattern

---

## [4.0.0] — 2026-06-21

### Added
- Reconciliation marker rows now appear on the unified Ledger for full transparency, regardless of reconciliation mode
- Reconciliation Mode setting — **Adjust Balance** (reconciliation mutates `startingBalance` going forward) vs. **Visible Only** (recorded and shown on ledger, does not change the tracked balance); changeable any time via the Settings modal (⚙ gear icon or command palette)
- First-run setup wizard asks new users to choose their reconciliation mode once; existing users default silently to Visible Only
- Extensible `app.settings` array backed by `src/settings.js`; storage format bumped to `"4.0.0"` with round-trip sanitization
- Reports Calendar day cells now show compact dot-count indicators; clicking or pressing Enter/Space opens a `#calendarDayModal` with the full event list (icon, name, amount) at every viewport width
- Print / Save as PDF button added to Health, Accounts, Income, and Reports pages

---

## [3.9.0] — 2026-06-20

### Added
- Command palette (Ctrl/Cmd+K or toolbar 🔍 button) — fuzzy-filters across all 10 pages plus common actions (export/import JSON, toggle dark mode, calculate plan); Arrow-key navigation, Enter to activate, Escape restores prior focus; full `role="dialog"` / `role="listbox"` ARIA semantics (`src/commandPalette.js`)
- `prefers-reduced-motion` support — global CSS media query collapses all transitions and animations to near-instant; `Chart.defaults.animation` disabled app-wide when the OS preference is set
- Screen-reader `.sr-only` data-table fallback for all chart groups (Health gauges, Spending pie/bar, Forecast line, Net Worth trend); built by `renderChartDataTable()` in `src/utils.js` and rebuilt on every chart re-render
- localStorage quota monitoring — every save estimates the serialized payload against a conservative 5 MB limit and shows a dismissible soft-warning banner above ~80% usage; a hard-failure banner fires if `setItem` actually throws (quota exceeded)
- Test suite expanded from 344 → 365 tests / 41 → 45 files, zero regressions

### Fixed
- Unclosed Markdown code fence in README Quick Start was swallowing the entire Security & Privacy section into the code block

---

## [3.8.0] — 2026-06-19

### Added
- Regression tests for inline-edit negative-amount validation paths (`saveEditIncome`, `saveEditBonus`) — the underlying fix shipped in v3.7.0 but these two paths lacked dedicated test coverage; now closed (`test_edit_income_negative_amount_rejected`, `test_edit_bonus_negative_amount_rejected`)
- Test suite: 344 tests / 41 files

---

## [3.7.0] — 2026-06-19

### Fixed
- Negative-amount validation bypass in Income (`addIncome`, `saveEditIncome`, `addBonus`, `saveEditBonus`) and Fixed-Amount Debt (`addDebt`) forms — `sanitizeFiniteNumber(raw, NaN, {min: 0.01})` was clamping negative input up to `0.01` rather than to the NaN fallback, so the subsequent `amount <= 0` guard never fired; fixed by validating the raw string before clamping, matching the existing `bills.js` / `recurring.js` pattern
- Exception messages rendered via `innerHTML` in `src/ui.js` were not passed through `escapeHtml()`; now wrapped for defense-in-depth consistency with `src/strategy.js`
- Added a contract comment to `src/accounts.js` documenting that callers of the `innerHTML` option-list helper must pre-escape values via `escapeHtml()`

### Changed
- `tests/debug/` relocated to `tools/debug/` so the `tests/` tree contains only pytest-collected tests
- Test suite: 342 tests / 41 files

---

## [3.6.0] — 2026-06-17

### Fixed
- CSP violation: `connect-src` now allows `https://cdn.jsdelivr.net` (Chart.js sourcemap fetch) in both `index.html` meta tag and `nginx.conf` header
- `guide.html` inline `<script>` and `<style>` blocks externalized to `src/guideTheme.js` and `guide.css` for production CSP compliance (nginx's `Content-Security-Policy` header blocked inline scripts, unlike the `<meta>` tag)

### Added
- Static test asserting `index.html` CSP meta tag and `nginx.conf` CSP header remain in sync — catches this class of divergence automatically going forward
- Bills data-model test coverage (`tests/features/test_bills.py`)
- CSV schedule export tests in `tests/integration/test_workflows.py`
- Test suite expanded from 140 → 264 tests / 38 files

---

## [3.5.0] — 2026-06-16

### Added
- Spending Analysis tab in Reports (`src/spending.js`) — doughnut pie chart of all outflows for the selected month, 6-month stacked bar trend (current month at full opacity, prior 5 at reduced), ranked category list with month-over-month % change badges, drill-down modal with individual transactions per category; `.sr-only` screen-reader data tables for both charts via `renderChartDataTable()`
- Main navigation redesigned into three labeled groups — **Overview** (Health, Accounts, Income), **Manage** (Liabilities, Recurring, Savings, Plan), **Analyze** (Reports, Ledger, Reconcile) — with active-group highlighting, `aria-current`, keyboard reachability, and hamburger menu on ≤768px
- Reports navigation redesigned with a sticky, grouped tab bar replacing the previous flat row

---

## [3.4.0] — 2026-06-13

### Added
- Account Reconciliation tool (`src/reconciliation.js`) — Reconcile page with per-account statement balance entry, live colour-coded difference, "Expected transactions since {date}" listing, and history log recording previous → statement balance, difference, date, and an optional note; per-entry delete (does not revert balance)
- "🔄 Reconcile this account" quick-modal on the Ledger page when a single account is selected; Escape/Enter keyboard handling
- `app.reconciliations` round-trips through localStorage and JSON export/import with sanitization; orphaned entries (account deleted later) render as "Unknown account" rather than crashing

---

## [3.3.0] — 2026-06-10

### Added
- Cash Flow Forecast tab in Reports (`src/forecast.js`) — selectable 1/2/3/6/12 month horizon; "Total Cash Position" (all asset-type accounts) or per-account view; summary stats (current/lowest/highest projected balance); line chart with red lowest-month and green highest-month highlights, line turns red for any negative month-end balance; notable-month detection flags months whose outflow exceeds a configurable threshold (default 130% of average) with their top 3 drivers; negative-balance warning banner
- Intra-month dip detection — walks each month's transactions chronologically to find the true lowest balance mid-month (e.g. rent due before a paycheck arrives); surfaces warning banners, updates the "Lowest Projected" stat to the intra-month low with its date, and flags table rows even when the month ends positive
- Forecast settings (horizon, account, notable-month threshold) persisted to localStorage and JSON export/import

---

## [3.2.0] — 2026-06-14

### Added
- Debt Payoff Date display on every debt card — `📅 Payoff Date` row sourced from the plan calculation; shows "Run a plan to see" hint until a plan is calculated
- Recurring Template "Mark as Paid This Month" toggle — `paidMonths` array per template (mirrors `skippedMonths`); distinct from Skip (paid = occurred, skip = suppressed); resets each calendar month; round-trips through export/import

---

## [3.1.0] — 2026-06-08

### Added
- Financial Health Dashboard (`src/health.js`) — app's default landing page with six metric cards: Debt-to-Income Ratio (Chart.js doughnut gauge, Healthy/Moderate/High Risk badge), Savings Rate, Emergency Fund Runway, Debt Payoff Timeline, Monthly Cash Flow (Surplus/Break Even/Deficit), Budget Allocation; internal nav links route to relevant pages
- Net Worth Tracker — monthly snapshots with month-level upsert (auto on page load, manual capture button); historical trend chart (3/6/12 month range selector); Net Worth vs. Liabilities chart; Asset Growth vs. Debt Reduction chart; snapshot history audit table; milestone celebration toasts at +$5K net worth increments from the first snapshot; Accounts widget showing current net worth and change from prior snapshot
- Multi-account ledger: items without an account link route to a sentinel bucket and appear in report-wide aggregations but are excluded from per-account ledger views
- Import now preserves account IDs so all `accountId` cross-references remain valid after a full restore
- Reports aggregations now include items not linked to any account (previously only linked items were counted)
- Test suite: 22 new tests covering Health Dashboard (feature, security, integration)

---

## [3.0.0] and earlier

Core feature set: debt management (credit cards + fixed-amount recurring), account management with projected balances, income tracking (bi-weekly + monthly sources, one-time entries), budget tracking (bills + variable expenses), recurring transaction templates (subscriptions, reimbursements, transfers), savings goals (emergency fund + sinking funds with three allocation methods), unified ledger with amount overrides, calendar + reports (income vs. expenses, money flow, variance dashboard, net worth), debt payoff plan calculator with four strategies (Avalanche, Snowball, Priority-Low, Priority-High), what-if slider, target payoff date back-calculator (binary search), interest paid to date estimate, JSON export/import (legacy v1.0 + current v4.0.0 format), CSV schedule export, dark mode, in-app guide (`guide.html`), strict Content Security Policy.

