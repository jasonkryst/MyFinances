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

## Open findings by priority

### High

| Type | Finding | Report |
|---|---|---|
| Performance | Lighthouse performance score **0.60** (fails the 0.8 CI gate in `lighthouserc.json`); LCP 8.6s / TTI 8.6s. Root cause: 54 `src/*.js` modules load eagerly with zero code-splitting, and the LCP element sits behind the Setup Wizard's import chain. | `performance/PERFORMANCE_AUDIT_2026-09-02.md` |
| Database | Zero indexes beyond primary keys across all 6 migrations — every `user_id`/`account_id` FK column is unindexed. | `database/DATABASE_AUDIT_2026-09-02.md` |
| Database | No backup/restore story for the Postgres data volume anywhere in the repo or docs. | `database/DATABASE_AUDIT_2026-09-02.md` |
| Accessibility | 7 of 16 Chart.js canvases (all 5 in `src/charts.js`'s Strategy/Plan Charts tab, both in `src/bills.js`'s Budget Charts tab) have no screen-reader `<table>` fallback, breaking the documented `renderChartDataTable()` convention. Not caught by `test_chart_accessibility.py`, which never visits these tabs. | `a11y/A11Y_AUDIT_REPORT_2026-09-02.md` |
| Testing | Stryker's `mutate` line-range config in `stryker.config.mjs` is stale — the ledger-cleared feature shifted `sanitizers.js` line numbers, so most of `sanitizeRecurringTemplate` silently dropped out of mutation scope while the two newest functions (`sanitizeLedgerOverrides`, `sanitizeLedgerClearedTransactions` — the ones just patched above) have **zero unit tests** and aren't reliably covered either. | `test/TESTING_AUDIT_2026-09-02.md` |

### Medium

| Type | Finding | Report |
|---|---|---|
| Security | `docker-compose.yml` never sets `NODE_ENV=production` for the `server` service, so the session cookie's `Secure` flag (gated on `NODE_ENV` in `server/src/routes/auth.js`) stays off by default on a deployment that follows the documented `docker compose up -d` path. | `security/SECURITY_AUDIT_2026-09-02.md` (addendum) |
| Security | `CLAUDE.md` claims "no open self-registration endpoint" but `POST /auth/register` is a live, undocumented first-user-creation route (safely implemented — atomic insert, rate-limited — but no doc warns operators not to expose the server before completing setup). | `security/SECURITY_AUDIT_2026-09-02.md` |
| i18n | `formatCurrency()` hardcodes `currency: 'USD'` — a Polish- or other-locale user never sees their own currency, only US-dollar formatting with locale-aware digit grouping. This is a deliberate, tested design decision (`docs/superpowers/specs/2026-08-04-i18n-support-design.md`), but remains the most user-visible i18n gap for a finance app. | `i18n/I18N_AUDIT_2026-09-02.md` |
| i18n / Accessibility | Health page's `renderChartDataTable()` screen-reader tables (DTI/Savings gauges) are entirely hardcoded English despite the page otherwise being translated — a visible label is localized but its screen-reader equivalent isn't. | `i18n/I18N_AUDIT_2026-09-02.md` |
| i18n | Settings modal's PostgreSQL storage option and helper text (`index.html` lines 1155, 1158) are hardcoded English inside an otherwise-translated modal. | `i18n/I18N_AUDIT_2026-09-02.md` |
| Accessibility | 3 of 6 modal dialogs (Reconcile, `showDeleteConfirmModal`, `showAccountReplacementModal`) lack a keyboard Tab focus-trap, and the latter two never restore focus on dismiss — high blast radius since the delete-confirm modal is reused app-wide. | `a11y/A11Y_AUDIT_REPORT_2026-09-02.md` |
| Performance | `index.html`'s `<script src="src/debtCalculator.js">` has no `defer`, confirmed render-blocking (~640ms) by Lighthouse; likely safe to defer since only the already-deferred `app.js` module consumes it. | `performance/PERFORMANCE_AUDIT_2026-09-02.md` |
| Performance | `renderReportsPage()` (`src/reports.js`) rebuilds all 8 report sub-panels and 11 Chart.js instances on every tab click instead of just the active tab. | `performance/PERFORMANCE_AUDIT_2026-09-02.md` |
| Performance | The Strategy page's What-If slider (`strategyComparison.js`) recomputes the full payoff simulation on every raw `input` event with no debounce. | `performance/PERFORMANCE_AUDIT_2026-09-02.md` |
| Database | `server/src/app.js` never sets `trust proxy`, so `express-rate-limit` keys off nginx's container IP rather than the real client IP despite nginx correctly forwarding `X-Forwarded-For`. | `database/DATABASE_AUDIT_2026-09-02.md` |
| Database | `server/src/db.js`'s connection pool has no `statement_timeout`, size tuning, or SSL configuration. | `database/DATABASE_AUDIT_2026-09-02.md` |
| Database | Several enum-shaped columns (`recurring_templates.frequency/type`, `sinking_funds.allocation_method`, `incomes.frequency`) lack `CHECK` constraints, inconsistent with `bonuses.purpose` which has one. | `database/DATABASE_AUDIT_2026-09-02.md` |
| Misc | `qs`/`body-parser` under `server/`'s Express dependency chain has live-request-path `npm audit` findings, fixable via plain `npm audit fix` with no breaking change (unlike the other dependency findings, which sit in dev-only/CLI-only chains). | `other/MISC_AUDIT_2026-09-02.md` |
| Misc | `tests/integration/test_pwa_offline.py` only asserts the app shell survives an offline reload — no test exercises navigation, data entry, or chart rendering while offline, so the PWA's "usable offline" promise is asserted much more weakly than its own module docstring claims. | `other/MISC_AUDIT_2026-09-02.md` |
| Misc | Real circular ES-module import chains centered on `ui.js` and `postgresSync.js` (e.g. a 4-file cycle `postgresSync.js → ui.js → ledger.js → settings.js → postgresSync.js`). Not currently crashing (cycle-closing exports are hoisted `function` declarations) but a latent TDZ risk if any were refactored to `const`/arrow functions. | `other/MISC_AUDIT_2026-09-02.md` |
| Testing | CI shards `test-features-b`/`-c` are now growing ~3x heavier than sibling shards — the same growth pattern that forced three prior shard splits (see recent CHANGELOG entries). | `test/TESTING_AUDIT_2026-09-02.md` |
| Testing | 789 `wait_for_timeout()` calls exist across 54 test files — corrects the June 28 baseline audit's claim that no arbitrary waits were found. | `test/TESTING_AUDIT_2026-09-02.md` |

### Low

| Type | Finding | Report |
|---|---|---|
| Security | `sanitizeDebt()` is the only record sanitizer using spread-then-override instead of the allowlist pattern every other sanitizer uses; not currently exploitable (no renderer iterates arbitrary debt keys) but inconsistent defensive depth. | `security/SECURITY_AUDIT_2026-09-02.md` |
| Accessibility | Dark-mode `.nav-group-label` contrast readings (1.93:1, 4.07:1) on the Liabilities page coincide suspiciously with the audit script's 150ms wait matching the CSS's own 0.15s transition — likely a mid-transition sampling artifact, not a real defect; needs re-verification with a longer wait before treating as live. | `a11y/A11Y_AUDIT_REPORT_2026-09-02.md` |
| Accessibility | Mobile Health-page Print button is 81×30px, under the 44×44 AAA target size (WCAG SC 2.5.5 — not an AA requirement). | `a11y/A11Y_AUDIT_REPORT_2026-09-02.md` |
| Features | 7 dead/unused exports across feature modules (`renderBillList`, `getLocalePreference`, `getRecurringTotalsForMonth`, `calculateSavingsProjection`, `incomeDaysInMonth`, `getExpensesByDayForMonth`, `getBonusesByDayForMonth`). | `features/FEATURES_AUDIT_2026-09-02.md` |
| Features | Strategy page's mini-calendar shows only bill due-dates; matching expense/bonus day-helpers exist but are unused — unclear if intentional. | `features/FEATURES_AUDIT_2026-09-02.md` |
| Features / Documentation | `CLAUDE.md` doesn't mention the Bills UI was intentionally removed (2026-05-29, per ROADMAP.md/tests) in favor of Recurring Templates, even though `bills.js`/`app.bills` remain a live data dependency for Accounts/Health/Ledger/Strategy. | `features/FEATURES_AUDIT_2026-09-02.md` |
| Documentation | `tests/README.md`'s per-file prose write-ups are still missing ~14 newer test files (counts/tree/coverage-matrix were fixed this session; the prose rewrite was left as a separate follow-up). | `documentation/DOCUMENTATION_AUDIT_2026-09-02.md` |
| Misc | Root dev-tooling (Jest/Stryker) and most `server/` dependencies are 1+ major version behind with `npm audit` findings, but almost all sit in dev-only/CLI-only chains (Stryker's bundled Babel/ajv/tmp, `node-pg-migrate`'s `glob`). | `other/MISC_AUDIT_2026-09-02.md` |
| Misc | `.plans/MIGRATION_PLAN.md` is stale scratch describing a `src/features/<domain>/` module layout superseded by the actual flat-file structure `CLAUDE.md` documents — should be deleted or marked historical. | `other/MISC_AUDIT_2026-09-02.md` |

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
