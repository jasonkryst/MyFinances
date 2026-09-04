# MyFinances — Consolidated Audit Summary

**Date:** 2026-09-02
**App version audited:** 4.40.0 (fixes below shipped as 4.40.1)
**Branch:** `feature/ledger-cleared-transactions`
**Scope:** Nine parallel audits — Documentation, Security, Accessibility, i18n, Features & Functionality, Performance, Database/Server Config, Testing, and Misc (dependencies/PWA/tech-debt) — each run with live verification (full `pytest` suite, Jest unit tests, Stryker mutation testing, the server test suite against a real Postgres 16 container, the built-in a11y DOM-audit script, and Lighthouse).

This file is the single entry point. Every finding below links back to its full report for file:line evidence and remediation detail. **No Critical-severity findings were found in any audit.**

---

## Already fixed this session

| Type | Item | Fix |
|---|---|---|
| Features / Database / Security | `clearedAt`/`updatedAt` timestamps silently truncated to midnight on every load/import/Postgres write (`sanitizeLedgerClearedTransactions`/`sanitizeLedgerOverrides` reused the date-only `sanitizeDateISO()`) | Added `sanitizeTimestampISO()` (`src/utils.js`), used in `src/sanitizers.js` and `server/src/routes/ledgerCleared.js`. Verified: `server/test/` 85/86 → 86/86. Commit `addfe31`. |
| Documentation | Stale port in `setup.ps1` (5500→32900) and `server/README.md` (3000→4000); nonexistent `COOKIE_SECURE` env var in `DEPLOYMENT.md` (should be `NODE_ENV`); badly stale version/test-count numbers in README/ROADMAP/`tests/README.md`; `CLAUDE.md`'s module list missing 14 of 51 `src/*.js` files; broken anchor in `README.md`→`SECURITY.md` | Rewritten in place. Commit `5b07884`. |

---

## Fixed in v4.41.0 (PR #139, prior to this file's last update)

The three Database findings below were resolved by a follow-up PR and were never reflected back into this summary until now:

| Type | Item | Fix |
|---|---|---|
| Database (H1) | Zero indexes beyond primary keys across all 6 migrations — every `user_id`/`account_id` FK column unindexed | New migration `server/migrations/1755600000006_add-user-and-account-indexes.js` adds a `CREATE INDEX` per FK column across all eleven affected tables. |
| Database (H2) | No backup/restore story for the Postgres data volume anywhere in the repo or docs | New `backup.sh`/`backup.ps1` + `restore.sh`/`restore.ps1` wrapping `pg_dump -Fc`/`pg_restore`, documented in `DEPLOYMENT.md`'s new "Backup and Restore" section. |
| Database (M3) | Several enum-shaped columns (`recurring_templates.frequency/type`, `sinking_funds.allocation_method`, `incomes.frequency`) lacked `CHECK` constraints | New migration `server/migrations/1755600000007_add-enum-check-constraints.js` adds them, matching sanitizer allow-lists. |

See `database/DATABASE_AUDIT_2026-09-02.md` (H1/H2/M3 marked resolved) and the CHANGELOG's `[4.41.0]` entry.

---

## Fixed 2026-09-03

Three of the highest-impact remaining open findings — not already covered by the database-hardening (4.41.0) or ledger-timestamp (4.40.1) fixes — were resolved in v4.43.0. A fourth (the `NODE_ENV` Security finding) was investigated, its obvious fix implemented, then **reverted** after it turned out to conflict with existing `DEPLOYMENT.md` guidance — see note below the table.

| Type | Item | Fix |
|---|---|---|
| Performance | `index.html`'s `<script src="src/debtCalculator.js">` had no `defer`, confirmed render-blocking (~640ms) by Lighthouse | Added `defer`; safe since its only consumer, `app.js`, is itself a deferred `type="module"` script. `performance/PERFORMANCE_AUDIT_2026-09-02.md` updated. |
| Accessibility | 7 of 16 Chart.js canvases (all 5 in `src/charts.js`'s Strategy/Plan Charts tab, both in `src/bills.js`'s Budget Charts tab) had no screen-reader `<table>` fallback | All 7 now call `renderChartDataTable()`. New `tests/ui/test_chart_accessibility.py` coverage (`test_strategy_schedule_charts_have_sr_tables`, `test_budget_cashflow_charts_have_sr_tables`) closes the gap that let this slip past the existing suite. `a11y/A11Y_AUDIT_REPORT_2026-09-02.md` (+ alias) updated. |
| Testing | Stryker's `mutate` line-range config in `stryker.config.mjs` was stale, dropping most of `sanitizeRecurringTemplate` from mutation scope while `sanitizeLedgerOverrides`/`sanitizeLedgerClearedTransactions` had zero unit tests and unreliable coverage | Ranges corrected; 8 new Jest tests added for both functions in `tests/unit/sanitizers.test.js`; thresholds re-derived from a fresh run (46.93%). `test/TESTING_AUDIT_2026-09-02.md` updated. |

Verified clean after all three fixes: 78/78 Jest, 62/62 `tests/security/`, 6/6 `tests/ui/test_chart_accessibility.py`, 240/240 full `tests/ui/` + `tests/features/test_bills.py`.

**NODE_ENV finding: investigated 2026-09-03, not fixed as a naive default that day — properly resolved 2026-09-04, see below.** `DEPLOYMENT.md`'s "HTTPS Requirement" section documented (deliberately, from the 2026-09-02 doc-audit fix) that `NODE_ENV=production` had to be set only *after* HTTPS was terminated in front of the stack — `auth.js`'s cookie `Secure` flag had no protocol-detection fallback, so setting it while still testing over plain HTTP silently broke login. Hardcoding it into `docker-compose.yml` would have traded that regression for the security hardening, so it was reverted rather than shipped on 2026-09-03. The real fix (pairing `trust proxy` with per-request `req.secure`) landed the next day — see "Fixed 2026-09-04" below.

---

## Fixed 2026-09-04

A second, larger follow-up pass resolved most of the remaining Medium/Low findings, across four batches:

**Quick wins**

| Type | Item | Fix |
|---|---|---|
| Security | `CLAUDE.md` claimed "no open self-registration endpoint" but `POST /auth/register` is a live, unauthenticated route | `CLAUDE.md`'s Phase 1 bullet corrected to describe it accurately (one-shot, atomic, rate-limited); `server/README.md`'s Production section gained a deployment-timing warning. |
| Misc | `qs`/`body-parser` `npm audit fix` claimed "no breaking change" | **Correction, not a fix:** verified wrong — `npm audit fix` (no `--force`) makes zero changes; the real fix needs `express` 4→5, a genuine major upgrade. `other/MISC_AUDIT_2026-09-02.md` and this file's Medium table corrected; remains open as its own scoped effort. |
| Accessibility | Mobile Health-page Print button 81×30px, under the 44×44 target | `.page-print-btn` (shared by every page's print button, not just Health) gained a `min-height`/`min-width: 44px` mobile rule. New `test_health_print_button_meets_mobile_tap_target_size`. |
| Accessibility | Dark-mode `.nav-group-label` contrast readings (1.93:1, 4.07:1) — suspected transition-timing artifact | **Confirmed false positive** by direct reproduction: readings below the 150ms sample point are mid-CSS-transition; settled readings (150ms+) are 8.72:1–21:1. `run_a11y_audit.py`'s sample wait bumped 150ms→350ms so future runs don't reproduce it. |
| Features | 7 dead/unused exports | 5 deleted (`renderBillList`, `getLocalePreference`, `getRecurringTotalsForMonth`, `calculateSavingsProjection`, `incomeDaysInMonth`); `CLAUDE.md`/`stryker.config.mjs` updated accordingly. The other 2 (`getExpensesByDayForMonth`/`getBonusesByDayForMonth`) were wired in instead — see below. |
| Features | Strategy mini-calendar showed only bill due-dates; expense/bonus day-helpers existed but were unused ("unclear if intentional") | **Product decision: wire in, don't delete.** Expense (purple) and bonus (teal) day-markers added to the calendar alongside existing debt/income/bill markers, with matching legend entries and dark-mode/high-contrast styling. 4 new tests in `tests/ui/test_strategy_calendar.py` (previously zero coverage of the calendar view). |
| Features / Documentation | `CLAUDE.md` didn't mention the Bills UI was intentionally removed | New `CLAUDE.md` bullet documents it, cross-referencing `test_bills.py`. |
| Misc | `.plans/MIGRATION_PLAN.md` stale planning scratch | Deleted. |

**Modal focus-trap fix (a11y F3)**

All 3 modals missing a Tab focus-trap (`openReconcileModal`, `showDeleteConfirmModal`, `showAccountReplacementModal`) now implement the same first/last-focusable Tab-cycling pattern as the app's other modals, plus focus-restore to the triggering element on dismiss. 6 new Playwright tests in `tests/ui/test_accessibility.py` — genuine Tab-cycling assertions, closing a gap where even the *existing* tests named "...focus_and_keyboard_trap" never actually tested Tab. Debugging this surfaced a real bug in the first draft: the Reconcile modal's actual UI trigger is `#reconcileFromLedgerBtn` on the **Ledger** page, not the Reconcile page's own (unrelated) inline-form button — fixed before landing.

**Server hardening (Database M1/M2 + the deferred NODE_ENV finding)**

`app.set('trust proxy', 1)` (`server/src/app.js`) fixes Database finding M1 (rate limiters no longer key off nginx's container IP) *and* enables a real fix for the NODE_ENV/Secure-cookie finding deferred on 2026-09-03: `server/src/routes/auth.js` now derives the session/CSRF cookies' `Secure` flag from per-request `req.secure` (which Express computes from nginx's `X-Forwarded-Proto` once `trust proxy` is set) instead of a static `NODE_ENV` check — correct automatically in both plain-HTTP local testing and a real HTTPS deployment, no manual step or deployment-ordering requirement either way. `server/src/db.js`'s pool (Database M2) gained `statement_timeout`, explicit `max`/`idleTimeoutMillis`/`connectionTimeoutMillis`, and conditional `ssl` (required with full cert validation for any non-local host — no insecure opt-out). `DEPLOYMENT.md`, `.env.example`, and `CLAUDE.md` updated to describe the new per-request behavior. Verified against a real Postgres container: all 113 server tests pass, including 3 new ones (`trust proxy is set to trust exactly one hop`, and two Secure-cookie behavior tests).

**i18n gaps (I18N_AUDIT M1/M2)**

Health page's DTI/Savings gauge screen-reader tables and the Settings modal's PostgreSQL storage option/note now use `t()`, backed by new `en`/`es`/`pl` keys. 2 new tests in `tests/features/test_i18n.py`. (`formatCurrency()`'s hardcoded USD remains untouched — a documented deliberate design decision, not treated as a bug.)

**Verification:** 78/78 Jest, 113/113 server (`node:test` against a real Postgres container), and the full relevant pytest slices (accessibility, a11y, i18n, chart-accessibility, strategy-calendar, overview-print) all pass. Full `pytest tests/` was not re-run end-to-end this pass; see individual suite runs above.

Still open after this pass, addressed in a same-day round 3 below: `renderReportsPage()`/What-If debounce (Performance), CI shard rebalancing (Testing), `sanitizeDebt()` allowlist (Security). Still open, deliberately deferred or out of scope: Lighthouse code-splitting (High, large effort), the `qs`/`body-parser` Express-major-bump (Misc, needs its own scoped effort), `formatCurrency()` hardcoded USD (i18n, deliberate), PWA offline test coverage and the `ui.js`/`postgresSync.js` circular-import cycle (Misc, Medium/Low), the 789 `wait_for_timeout()` sweep (Testing, Medium), `tests/README.md`'s remaining per-file prose gaps (Documentation, Low), and 1+ major version-behind dev/server dependencies in dev-only chains (Misc, Low).

---

## Fixed 2026-09-04 (round 3)

A third round the same day, after PR #144 merged, picked off the last well-scoped items:

| Type | Item | Fix |
|---|---|---|
| Security | `sanitizeDebt()` used spread-then-override instead of the allowlist pattern every other sanitizer uses | Removed the `...record` spread — the function already built a complete allowlist, so this was a pure removal. New Jest test asserts an injected unknown field (and a `__proto__` pollution attempt) doesn't survive. |
| Performance | `renderReportsPage()` rebuilt all 8 report sub-panels and 11 Chart.js instances on every tab click, month-nav, or range change | Now looks up the active tab and only renders that tab's panel(s), via a `REPORT_TAB_RENDERERS` lookup — for every trigger, not just tab clicks (more thorough than the audit's own suggestion, since a hidden tab always re-renders fresh the moment it's switched to). Surfaced that `reportsNetWorth.js`'s charts had no self-destroy guard (added) and that 2 of the 11 tracked chart keys were entirely dead code (removed). Fixing this surfaced 6 pre-existing tests across 4 files that assumed the old "render everything" behavior without ever switching to the tab they were checking — all fixed to click into the relevant tab first. |
| Performance | Strategy page's What-If slider recomputed the full payoff simulation on every raw `input` event | New `debounce()` utility (`src/utils.js`) wraps the simulation at 150ms; the amount label still updates immediately for responsive feedback. 4 new tests in `tests/ui/test_whatif_simulator.py` (zero prior coverage of this panel), including one that explicitly asserts the mid-debounce state. |
| Testing | CI shards `test-features-b`/`-c` had grown to ~123 tests each — ~3x every sibling shard | Bin-packed all 24 files across `b`/`c`/new `h` for balance (82/81/83 tests, 8 files each) — more thorough than the audit's suggested single peel, which would have left `c` untouched. YAML validated; verified no file dropped or duplicated. |

**Verification:** 719/719 pytest (full suite, not ignoring anything but `tests/postgres/`), 79/79 Jest.

Still open: everything listed above as deferred/out of scope, unchanged.

---

## Open findings by priority

### High

| Type | Finding | Report |
|---|---|---|
| Performance | Lighthouse performance score **0.60** (fails the 0.8 CI gate in `lighthouserc.json`); LCP 8.6s / TTI 8.6s. Root cause: 54 `src/*.js` modules load eagerly with zero code-splitting, and the LCP element sits behind the Setup Wizard's import chain. Tracked: [#146](https://github.com/jasonkryst/MyFinances/issues/146). | `performance/PERFORMANCE_AUDIT_2026-09-02.md` |

### Medium

| Type | Finding | Report |
|---|---|---|
| i18n | `formatCurrency()` hardcodes `currency: 'USD'` — a Polish- or other-locale user never sees their own currency, only US-dollar formatting with locale-aware digit grouping. This is a deliberate, tested design decision (`docs/superpowers/specs/2026-08-04-i18n-support-design.md`), but remains the most user-visible i18n gap for a finance app. Tracked: [#147](https://github.com/jasonkryst/MyFinances/issues/147). | `i18n/I18N_AUDIT_2026-09-02.md` |
| Misc | `qs`/`body-parser` under `server/`'s Express dependency chain has live-request-path `npm audit` findings. **Corrected 2026-09-04:** the original "fixable via plain `npm audit fix`, no breaking change" claim was verified wrong — `npm audit fix` (no `--force`) makes zero changes; the only real fix is bumping `express` 4.22.2→5.2.1 (a genuine major/breaking upgrade with real API changes), not a quick fix. Needs its own scoped effort with full server-test-suite verification. Tracked: [#141](https://github.com/jasonkryst/MyFinances/issues/141) (blocks PR #115, the Dependabot bump that would fix this). | `other/MISC_AUDIT_2026-09-02.md` |
| Misc | `tests/integration/test_pwa_offline.py` only asserts the app shell survives an offline reload — no test exercises navigation, data entry, or chart rendering while offline, so the PWA's "usable offline" promise is asserted much more weakly than its own module docstring claims. Tracked: [#148](https://github.com/jasonkryst/MyFinances/issues/148). | `other/MISC_AUDIT_2026-09-02.md` |
| Misc | Real circular ES-module import chains centered on `ui.js` and `postgresSync.js` (e.g. a 4-file cycle `postgresSync.js → ui.js → ledger.js → settings.js → postgresSync.js`). Not currently crashing (cycle-closing exports are hoisted `function` declarations) but a latent TDZ risk if any were refactored to `const`/arrow functions. Tracked: [#149](https://github.com/jasonkryst/MyFinances/issues/149). | `other/MISC_AUDIT_2026-09-02.md` |
| Testing | 789 `wait_for_timeout()` calls exist across 54 test files — corrects the June 28 baseline audit's claim that no arbitrary waits were found. Tracked: [#150](https://github.com/jasonkryst/MyFinances/issues/150). | `test/TESTING_AUDIT_2026-09-02.md` |
| Testing | `test-ui-a`/`test-ui-b` CI shard imbalance (148 vs 101 tests) — smaller-magnitude version of the `test-features-b`/`-c` imbalance fixed in PR #145, not addressed in that pass. Tracked: [#153](https://github.com/jasonkryst/MyFinances/issues/153). | `test/TESTING_AUDIT_2026-09-02.md` |
| Database | `nginx.conf`'s `/api/`/`/auth/` blocks have no explicit proxy timeouts or `client_max_body_size` (coincidentally matches Express's 1MB limit today, but undocumented and fragile). Tracked: [#154](https://github.com/jasonkryst/MyFinances/issues/154). | `database/DATABASE_AUDIT_2026-09-02.md` |
| Security | `/auth/register`'s primary remediation (doc corrections) resolved in PR #144; the optional defense-in-depth alternative (gate behind an explicit `ALLOW_SETUP` env var) is not required but tracked separately. Tracked: [#156](https://github.com/jasonkryst/MyFinances/issues/156). | `security/SECURITY_AUDIT_2026-09-02.md` |

### Low

| Type | Finding | Report |
|---|---|---|
| Documentation | `tests/README.md`'s per-file prose write-ups are still missing ~14 newer test files (counts/tree/coverage-matrix were fixed this session; the prose rewrite was left as a separate follow-up). Tracked: [#151](https://github.com/jasonkryst/MyFinances/issues/151). | `documentation/DOCUMENTATION_AUDIT_2026-09-02.md` |
| Misc | Root dev-tooling (Jest/Stryker) and most `server/` dependencies are 1+ major version behind with `npm audit` findings, but almost all sit in dev-only/CLI-only chains (Stryker's bundled Babel/ajv/tmp, `node-pg-migrate`'s `glob`). | `other/MISC_AUDIT_2026-09-02.md` |
| Database | No `cpus`/`memory` resource limits on any `docker-compose.yml` service. Tracked: [#154](https://github.com/jasonkryst/MyFinances/issues/154). | `database/DATABASE_AUDIT_2026-09-02.md` |
| Database | `sessions` has no index on `expires_at` (no sweep job exists yet either); migration `down()` functions are all destructive `DROP TABLE` with no populated-database guard (a forward-looking guardrail, not a current bug). Tracked: [#155](https://github.com/jasonkryst/MyFinances/issues/155). | `database/DATABASE_AUDIT_2026-09-02.md` |
| Misc | `codeql.yml` and `trivy.yml` pin different major versions of `github/codeql-action` for their SARIF-upload steps. Tracked: [#157](https://github.com/jasonkryst/MyFinances/issues/157). | `other/MISC_AUDIT_2026-09-02.md` |
| Misc | `manifest.json` omits optional-but-recommended PWA fields (`id`, `categories`, `shortcuts`). Tracked: [#158](https://github.com/jasonkryst/MyFinances/issues/158). | `other/MISC_AUDIT_2026-09-02.md` |

---

## Full reports

- `documentation/DOCUMENTATION_AUDIT_2026-09-02.md`
- `security/SECURITY_AUDIT_2026-09-02.md` (+ `security/SECURITY_AUDIT.md` latest alias)
- `a11y/A11Y_AUDIT_REPORT_2026-09-02.md` (+ `a11y/A11Y_AUDIT_REPORT.md` latest alias, + `a11y/raw_findings_2026-09-02.json`)
- `i18n/I18N_AUDIT_2026-09-02.md`
- `features/FEATURES_AUDIT_2026-09-02.md`
- `performance/PERFORMANCE_AUDIT_2026-09-02.md`
- `database/DATABASE_AUDIT_2026-09-02.md`
- `test/TESTING_AUDIT_2026-09-02.md`
- `other/MISC_AUDIT_2026-09-02.md`

## What was verified clean (no action needed)

- CSP, XSS, sanitizer coverage, CSRF, IDOR, SQL-injection surface: all confirmed sound (`tests/security/` 62/62 passing live).
- i18n locale-file parity: `en`/`es`/`pl` all 111/111 matching keys, no broken fallbacks in pilot scope.
- All 20 `new Chart(` call sites properly destroy prior instances — no chart memory leaks.
- Service worker precache list and `CACHE_NAME` were in sync with `APP_VERSION` at audit time.
- Zero TODO/FIXME/XXX/HACK markers anywhere in `src/` or `server/src/`.
- Feature-module delegation pattern (`featureFn(app, ...)`) followed with no deviations across all 10 pages.
- Dependabot config covers all 5 expected ecosystems with a real merge history; Chart.js CDN is pinned to an exact version with an SRI hash.
- The 33 `tests/postgres/` + 9 non-Postgres pytest failures seen in one local full-suite run were **not real regressions**: the Postgres failures were a test-execution environment gap (no backend server running for that pass), and the 9 non-Postgres failures all passed cleanly on a serial re-run — confirmed `pytest -n 4` parallelization flakiness, not application bugs.

## Tracked work items (2026-09-04)

Every remaining open finding across all 9 sub-reports — not just the ones rolled up into this file's own tables — now has a GitHub issue, filed after the three same-day fix rounds (PRs #143, #144, #145) closed out everything else well-scoped enough to fix directly. A second pass swept every individual report file directly (not just this summary) for lower-priority findings that never made it into the top-level tables above.

| Issue | Finding |
|---|---|
| [#146](https://github.com/jasonkryst/MyFinances/issues/146) | Lighthouse code-splitting (High — the last one) |
| [#147](https://github.com/jasonkryst/MyFinances/issues/147) | `formatCurrency()` hardcoded USD (multi-currency support) |
| [#148](https://github.com/jasonkryst/MyFinances/issues/148) | PWA offline test coverage |
| [#149](https://github.com/jasonkryst/MyFinances/issues/149) | `ui.js`/`postgresSync.js` circular import cycle |
| [#150](https://github.com/jasonkryst/MyFinances/issues/150) | 789 `wait_for_timeout()` sweep |
| [#151](https://github.com/jasonkryst/MyFinances/issues/151) | `tests/README.md` prose gaps |
| [#153](https://github.com/jasonkryst/MyFinances/issues/153) | `test-ui-a`/`test-ui-b` shard imbalance |
| [#154](https://github.com/jasonkryst/MyFinances/issues/154) | nginx/docker-compose deployment hardening (proxy timeouts, resource limits) |
| [#155](https://github.com/jasonkryst/MyFinances/issues/155) | Migration/schema hygiene (`sessions.expires_at` index, destructive `down()` guards) |
| [#156](https://github.com/jasonkryst/MyFinances/issues/156) | Optional `/auth/register` defense-in-depth (`ALLOW_SETUP` env-var gate) |
| [#157](https://github.com/jasonkryst/MyFinances/issues/157) | `codeql-action` version alignment between `codeql.yml`/`trivy.yml` |
| [#158](https://github.com/jasonkryst/MyFinances/issues/158) | `manifest.json` missing recommended PWA fields |
| [#141](https://github.com/jasonkryst/MyFinances/issues/141) (pre-existing) | `qs`/`body-parser` — same root cause as the blocked Express 4→5 bump in PR #115; commented with cross-reference |

Not filed as issues (deliberately out of scope, no current driver, or already resolved): `formatCurrency()`'s RTL-readiness note (i18n L2, folded into #147's context), the Ledger page's minor translated/untranslated scope adjacency (i18n L3 — explicitly "not a bug" per that report), dev-dependency version drift (already handled by Dependabot's routine PRs — see #141/PR #115), the security audit's L2 (`ledger-cleared` timestamp truncation — was already resolved same-day as the original 2026-09-02 audit, just missing its own resolution note until now).
