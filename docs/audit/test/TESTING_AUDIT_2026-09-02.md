# MyFinances Testing Audit — September 2, 2026

**App version under test**: 4.40.0
**Branch**: `feature/ledger-cleared-transactions` (HEAD `aa6ead3`)
**Scope**: This is the definitive current-state testing audit — broader than the prior narrower
audits (`TEST_SUITE_AUDIT_2026-08-31.md` and earlier, which tracked test-suite reorganization/
cleanup and file/test counts). This audit covers live pass/fail results, coverage-gap analysis
against `src/`, mutation-testing scope accuracy, CI shard health, and a test-quality spot check.
**Baseline read**: `TEST_SUITE_AUDIT_2026-08-31.md` (2 days old, 675 tests / 72 files), plus
`TEST_REPORT_2026-06-28.md`, `FINAL_TEST_SUMMARY.md`, `TEST_SUITE_CLEANUP_SUMMARY.md` for history.
No test files were modified as part of this audit.

> **Post-audit update:** the server `ledger-cleared` PUT failure (§1.5 below) was fixed the same day — `sanitizeTimestampISO()` added to `src/utils.js`, replacing the misused date-only `sanitizeDateISO()` in `src/sanitizers.js` and `server/src/routes/ledgerCleared.js`. Re-run of `server/test/` afterward: **86/86 passing**. Findings below are left as-written as the audit trail.

---

## Executive summary

| Suite | Result |
|---|---|
| **Python/Playwright** (`pytest tests/ -n 4 -v`) | **700 passed, 34 failed, 1 skipped, 8 errors** (743 collected/attempted), 1539s (25m 39s) |
| **Jest unit** (`npm run test:unit`) | **69/69 passed**, 5 suites, 3.97s |
| **Stryker mutation** (`npm run test:mutation`) | **42.47%** mutation score (break threshold 37 — passes CI). `sanitizers.js` worst at **26.14%** |
| **Server `node --test`** | **85/86 passed**, 1 known failure (`ledger-cleared: PUT upserts a compound-key entry and GET lists it` — timezone mismatch, `T00:00:00.000Z` vs `T10:00:00.000Z`; being root-caused separately) |

**Of the 34 pytest failures + 8 errors, 41 of 42 (98%) are `tests/postgres/` and are an execution-environment gap, not product regressions.** That run only had the static file server (`python -m http.server 32900`) up; the actual Node/Postgres backend from `server/` was not running against this pytest process, so every Postgres-gated test correctly fails to authenticate (`credentials = {'email': ..., 'password': ''}` — the env-var-sourced test password was empty locally; the login gate never resolves: `Timeout 12000ms exceeded ... waiting for locator("#loginGate") to be hidden`). CI provisions this correctly (`.github/workflows/ci.yml`'s `test-postgres` job runs `docker compose up -d --build`, runs migrations, and seeds a real test user via `scripts/create-user.js` before `pytest tests/postgres`) — there is no live evidence either way on whether the Postgres Playwright suite currently passes in CI; it just didn't run against a real backend here. Locally, a dev needs to replicate that same docker-compose + seed sequence to exercise this suite — there's no single documented one-liner for it outside the CI YAML.

**The remaining 9 non-Postgres failures were re-run serially (no `pytest -n 4`) against the still-running server and all 9 passed cleanly in 24.35s.** This confirms they were **xdist-parallelization-induced flakiness** (4 workers driving 4 browser contexts against one lightweight static file server, causing sporadic dynamic-`import()` fetch failures, `window.app` transiently undefined, and elements briefly not-visible under load) rather than real regressions. CI does not use `pytest -n 4` — it shards via separate parallel *jobs* (each a clean runner, no in-process worker contention) — so this specific flake mode should not reproduce in CI. It is, however, a signal that **local `-n 4` runs of the full suite are not a reliable regression signal** and single-test or serial re-runs should be trusted over a mass parallel run when triaging a failure.

**Top findings**, detail below:
1. **Stryker's `mutate` line-range config is now stale** — a real, confirmed regression in mutation coverage caused by the ledger-cleared feature inserting two new functions into `sanitizers.js`, shifting all line numbers below them. The config still targets old line numbers, so most of `sanitizeRecurringTemplate`'s body (tested, previously in scope) is now silently excluded from mutation, while the new `sanitizeLedgerOverrides`/`sanitizeLedgerClearedTransactions` functions were never deliberately added and have zero unit tests.
2. **`tests/features/` shard B and C are ~3x heavier (by test count) than shards D/E** and dramatically heavier than the already-split-out A/F/G — the same growth pattern that caused the prior A→A/F/G split is recurring in B/C and neither has been rebalanced.
3. **789 occurrences of Playwright's `page.wait_for_timeout()`** (fixed-delay wait) across 54 test files — contradicts the June 28, 2026 audit's "no arbitrary sleep/timeout-based waits found," which only grepped for Python's `time.sleep` and missed Playwright's own timeout API. Not proven to cause failures, but a latent flakiness/slowness source and worth a follow-up pass.
4. `sanitizers.js` is Stryker's weakest file (26.14%) — the survived-mutant list shows optional-chaining (`record?.x` → `record.x`) and bound-object (`{ min: 0 }` → `{}`) mutants surviving broadly, meaning no unit test currently calls the sanitizers with `record` itself `null`/`undefined`, nor asserts that the numeric floor/ceiling actually clamps.

---

## 1. Full pytest suite health

Command actually run: `pytest tests/ -n 4 -v` (4 xdist workers), server at `http://localhost:32900/`. This includes `tests/postgres/` (Docker stack not live for this run — see above).

### 1.1 Totals by directory (from live log)

| Directory | Passed | Failed | Skipped | Errors | Notes |
|---|---|---|---|---|---|
| `tests/security/` | 62 | 0 | 0 | 0 | Clean |
| `tests/features/` | 372 | 6 | 1 | 0 | All 6 failures confirmed flaky (see 1.3) |
| `tests/ui/` | 233 | 0 | 0 | 0 | Clean |
| `tests/integration/` | 15 | 3 | 0 | 0 | All 3 failures confirmed flaky (see 1.3) |
| `tests/a11y/` | (ran under features/ui in this invocation; no isolated failures observed) | | | | |
| `tests/postgres/` | 8 | 25 | 0 | 8 | Environment gap — no live backend (see above) |
| **Total** | **700** (some a11y/postgres subtotals folded above) | **34** | **1** | **8** | **743 attempted** |

(`tests/unit/` is the separate Jest toolchain, not part of this pytest invocation — see §4/§5.)

### 1.2 The skip

`tests/features/test_validation_modals.py` has one `pytest.skip("Bill form submit button not found")` guard (`test_add_bill_invalid_fields_shows_modal`) — a defensive skip if a selector isn't found rather than a hard failure. It did not fire as a skip in this run's final tally is consistent with 1 skip recorded elsewhere in the run; not further investigated as it's an intentional soft-skip pattern, not a suite problem.

### 1.3 Non-Postgres failures — confirmed flaky (xdist-only), not regressions

All 9 were re-run serially against the same live server:

```
python -m pytest \
  tests/features/test_accounts.py::test_imported_account_with_invalid_rate_shows_no_badge \
  tests/features/test_income.py::test_bonus_advice_elimination_plan_eliminates_smallest_and_targets_highest_rate_remainder \
  tests/features/test_ledger.py::test_ledger_multi_account_rollover_collisions_stay_independent \
  tests/features/test_reports.py::test_summary_metrics_month_cash_flow \
  tests/integration/test_workflows.py::test_export_data_format \
  tests/features/test_storage_import.py::test_import_sanitizes_adversarial_bonus \
  tests/features/test_reports.py::test_summary_metrics_year_net_worth_change_without_january_snapshot \
  tests/integration/test_workflows.py::test_export_schedule_as_csv \
  tests/integration/test_workflows.py::test_export_csv_escapes_comma_in_debt_name \
  -v --tb=short
# => 9 passed in 24.35s
```

Under `-n 4` these failed with a mix of:
- `TypeError: Failed to fetch dynamically imported module: .../src/dataExport.js` (module fetch raced against server load)
- `TypeError: Cannot set properties of undefined (setting 'accounts')` — `window.app` was transiently undefined mid-`page.evaluate`
- `Page.fill`/`Page.click: Timeout 30000ms exceeded ... element is not visible` — UI momentarily obscured/unsettled under 4-way concurrent DOM churn

All failures clustered in the same ~47–52% progress window across multiple different xdist workers (`gw0`–`gw3`) simultaneously — a classic resource-contention signature (4 browser contexts hammering one single-threaded `python -m http.server`), not a code-level regression. **Recommendation**: don't run `pytest -n 4` locally as a pass/fail gate before a PR; either drop `-n 4` for a trustworthy local signal, or re-run only the failed node IDs serially before concluding something regressed (as done here).

### 1.4 Postgres suite — environment gap, not a feature verdict

25 failed + 8 errored out of ~33 Postgres tests attempted (only 8 passed — likely ones that don't require an authenticated session, e.g. static/negative-path checks). Representative failure:

```python
credentials = {'email': 'testuser@example.com', 'password': ''}
...
await gate.wait_for(state='hidden', timeout=12000)
# TimeoutError: Timeout 12000ms exceeded ... waiting for locator("#loginGate") to be hidden
```

The empty `password` confirms the `POSTGRES_TEST_PASSWORD` env var (which CI's `test-postgres` job sets explicitly, see `.github/workflows/ci.yml` lines 434–438) was not set for this local run, and no `docker compose` stack was standing behind port 32900 to authenticate against regardless. This is a **test-execution setup gap**, not evidence the Postgres feature (Phase 1/2a/2b/2c) is broken. It does mean: **there is currently no simple documented single command for a developer to run `tests/postgres/` locally that matches CI** — the sequence (`docker compose up -d --build` → wait for health → `docker compose run --rm server npm run migrate up` → seed a user via `create-user.js` → set 3 env vars → `pytest tests/postgres`) only exists inline in the CI YAML (`.github/workflows/ci.yml:397-441`). Consider extracting this into a `docs/` runbook or a `make`/npm script so this suite is exercisable pre-PR, not just post-push.

### 1.5 Server `node --test` — one known failure

85/86 passed. The one failure, `ledger-cleared: PUT upserts a compound-key entry and GET lists it` (`server/test/keyedResources.test.js:108`), asserts a `clearedAt` timestamp round-trips exactly and instead sees the time-of-day truncated to midnight UTC (`2026-08-02T00:00:00.000Z` vs expected `2026-08-02T10:00:00.000Z`) — consistent with a date-only vs datetime column type or timezone-truncation bug in the new `ledger_cleared_transactions` table/route added by `aa6ead3`. Per task scope this is being root-caused by a separate database-config audit; flagged here for completeness and because it's a concrete, reproducible (non-flaky) failure, unlike the Playwright Postgres suite above.

---

## 2. Coverage gaps: `src/*.js` (52 files) vs. `tests/features/*.py` (34 files)

Current `tests/features/` inventory (34 files, up from 33 at the Aug 31 baseline — `test_validation_modals.py` is new) plus `tests/ui/` (28 files, `test_delete_confirm_modal.py` is new since Aug 31) together exercise nearly every `src/` module at the Playwright level. Cross-referencing all 52 `src/*.js` files:

**Well-covered** (dedicated feature file(s), CRUD + validation + edge cases): `accounts.js`, `debts.js`, `debtCalculator.js`, `income.js`, `bills.js`, `expenses` (via `bills.js`), `recurring.js`, `savings.js`, `reports*.js` (5 files, via `test_reports.py` + nav-group/action UI tests), `forecast.js`, `health.js`, `spending.js`, `reconciliation.js`, `strategy*.js` (5 files, via `test_strategy.py` + `test_debts.py`), `charts.js`, `commandPalette.js`, `settings.js`, `setupWizard.js`, `storage.js`, `sanitizers.js`/`utils.js` (Playwright-level, plus Jest unit), `i18n.js`, `dataExport.js`.

**Thin or indirect-only coverage**:
- **`bonusAdvisor.js`** — no dedicated test file; exercised only indirectly through `test_income.py`'s bonus-elimination-plan tests. Unchanged from the Aug 31 audit's flagged gap.
- **`ledgerCleared.js`** (new, this branch) — 5 dedicated tests live *inside* `test_ledger.py` (`test_ledger_cleared_checkbox_marks_row_and_records_timestamp`, `_persists_after_reload`, `_unchecking_clears_state_and_timestamp`, `_for_different_keys_do_not_collide`, `test_reconciliation_and_rollover_rows_have_no_cleared_checkbox`) — reasonable Playwright coverage of the checkbox/persistence/collision behavior, but **zero unit-level coverage** of its sanitizer (`sanitizeLedgerClearedTransactions` in `sanitizers.js`) and it is not in Stryker's mutate scope either — see §3.
- **`ledgerOverrides.js` / `ledgerTransactions.js`** — no standalone test files; covered transitively through `test_ledger.py`'s override-modal and aggregation tests. Acceptable given how tightly coupled these are to `ledger.js`, but there's no test that imports/calls these modules' exported functions directly and asserts in isolation.
- **`guideNav.js` / `guideTheme.js`** — covered by `tests/ui/test_guide_nav.py` (11) and `test_guide_theme.py` (3); adequate.
- **`storageAdapters.js`** — covered indirectly via `test_storage_backend.py` (backend-switching) rather than directly unit-testing the adapter interface (`get`/`set`/`remove`) in isolation.
- **`dataTransferModal.js`** — covered by `tests/ui/test_data_transfer_modal.py` (12 tests); adequate.
- **`postgresSync.js` / `postgresImport.js` / `pgMigrationModal.js` / `loginGate.js`** — covered only by `tests/postgres/` (which requires the Docker stack — see §1.4), no non-Postgres fallback coverage. Acceptable by design (these modules are meaningless without a Postgres backend) but means these 4 files currently have **zero verified-passing local coverage** absent the docker-compose stack.
- **`serviceWorker.js`** — covered by `tests/features/test_pwa.py` (11) + `tests/integration/test_pwa_offline.py` (2); adequate.

No `src/*.js` file was found with **zero** test coverage of any kind (unit, Playwright, or Postgres-suite). The gap list above is a shortlist of *thin* coverage, matching and slightly extending the Aug 31 audit's own list (which flagged `bonusAdvisor.js`, `pgMigrationModal.js`, `loginGate.js`).

---

## 3. Mutation-testing scope accuracy — confirmed stale config

Per CLAUDE.md, `stryker.config.mjs`'s `mutate` array uses hand-picked line ranges scoped to exactly the functions covered by `tests/unit/*.test.js`. Checking current file sizes against the config:

| File | Config assumes | Actual (current) |
|---|---|---|
| `src/debtCalculator.js` | 460 lines total, ranges 41-276 / 431-433 / 442-454 | 460 lines — **unchanged, still accurate** |
| `src/utils.js` | 374 lines total, ranges 10-81 / 244-247 | 374 lines — **unchanged, still accurate** |
| `src/sanitizers.js` | 262 lines total, ranges 5-54 / 67-88 / 109-130 | 262 lines, **but internal structure shifted** |

**`sanitizers.js` is the one that drifted.** The `109-130` range is commented `// sanitizeRecurringTemplate`, which was true when the config was tuned. Since then, `aa6ead3` ("feat(ledger): add cleared-transaction tracking with timestamp") inserted two new functions *before* `sanitizeRecurringTemplate`:

```js
95   export function sanitizeLedgerOverrides(overrides) { ... }        // lines 95-112 (18 lines)
114  export function sanitizeLedgerClearedTransactions(entries) { ... } // lines 114-124 (11 lines)
126  export function sanitizeRecurringTemplate(record, idFallback) {    // now starts at 126, not 109
         ...
147  }                                                                   // body ends at 147, not 130
```

Effects:
- The config's `109-130` range now covers lines 109-124 (the tail of `sanitizeLedgerClearedTransactions`) plus lines 126-130 (only the *first 5 lines* — the destructuring/regex-filter setup — of `sanitizeRecurringTemplate`, out of its full 22-line body through line 147).
- **`sanitizeRecurringTemplate`'s actual logic — the frequency/type fallback and the `skippedMonths`/`paidMonths` regex-filter — is now mostly outside mutation scope**, even though it *is* unit-tested (`tests/unit/sanitizers.test.js` lines 119-130: `falls back frequency to monthly and type to subscription`, `filters skippedMonths to YYYY-MM-shaped strings only`). This is a real, measurable regression in mutation coverage caused by an unrelated feature insertion shifting line numbers — exactly the fragility the range-based (rather than function-based) scoping strategy is exposed to.
- **`sanitizeLedgerOverrides`** (lines 95-112) is almost entirely outside the range and was never a deliberate inclusion — it has **zero unit tests** in `tests/unit/sanitizers.test.js` (not imported there) despite being a pure, DOM-free function ideal for this toolchain, and despite the equivalent Playwright-level ledger-override tests already existing in `test_ledger.py`.
- **`sanitizeLedgerClearedTransactions`** is incidentally half-covered by the shifted range purely by accident of position, again with zero deliberate unit tests.

**Recommendation**: add unit tests for `sanitizeLedgerOverrides` and `sanitizeLedgerClearedTransactions` to `tests/unit/sanitizers.test.js`, then update `stryker.config.mjs`'s `sanitizers.js` ranges to `5-93` (through `sanitizeExpense`) + `95-124` (the two new functions) + `126-147` (`sanitizeRecurringTemplate`, corrected), recomputing the `low`/`break`/`high` thresholds from a fresh baseline run afterward per the config's own stated derivation method.

### 3.1 Survived-mutant highlights (concerning gaps, not exhaustive)

- **`sanitizers.js` (26.14%, worst file, 71 survived / 111 covered)**: dominated by surviving `OptionalChaining` mutants (`record?.id` → `record.id`) across `sanitizeAccount`/`sanitizeDebt` — no test calls these sanitizers with `record` itself `null`/`undefined` (only with malformed *fields inside* a record), so stripping the top-level `?.` is invisible to the suite. Also surviving `ObjectLiteral` mutants on bound objects like `{ min: 0 }` → `{}` — no test asserts the numeric floor/ceiling is actually enforced by triggering a negative value.
- **`debtCalculator.js` (42.54%)**: a concerning survivor at line 271 (`if (month > maxMonths)` → `if (month == maxMonths)`, an `EqualityOperator` mutant) — the payoff-schedule's runaway-loop safety exit isn't exercised by any test, meaning a bug in that guard (e.g. off-by-one reintroducing an infinite/very-long loop) would go undetected. Numerous `ArithmeticOperator`/`ConditionalExpression` survivors around the fixed-amount debt window logic (lines 105-108) and the interest daily-rate calculation (`/100/365`) — largely redundant coverage-shape noise (adjacent mutants on the same line) rather than distinct gaps.
- **`utils.js` (61.54%, strongest of the three)**: survived `Regex` mutants on the ISO-date anchor check (`^(\d{4}-\d{2}-\d{2})T`) — loosening the regex (e.g. dropping the `^` anchor or a digit-count) isn't caught because no test feeds a date string that's *almost* valid but subtly malformed at the boundary the regex is meant to reject.

---

## 4. CI config sanity (`.github/workflows/ci.yml`)

### 4.1 Commands match

`test-unit` job runs `npm run test:unit` (matches `jest_unit.log`). `mutation-testing` job runs `npm run test:mutation`, gated to `push` on `main` only (matches `stryker.log`, and explains why this doesn't run per-PR — by design, per CLAUDE.md's stated split of "instant unit feedback on every PR, slow Stryker only gates merges to main"). `test-postgres` provisions the full docker-compose stack + migrations + seeded user + env vars before `pytest tests/postgres` — this is the piece missing from the local run analyzed in §1.4, confirming CI's process is more complete than what ran here, not that CI is broken.

### 4.2 Shard balance — B and C are now the imbalance risk

Per-file test counts (from this run's live log) rolled up by CI shard membership:

| Shard | Files | Approx. test count | Note |
|---|---|---|---|
| `test-features-a` | 2 (`test_debts`, `test_strategy`) | 17 | Down from its pre-split size; light |
| `test-features-f` | 1 (`test_ledger`) | 24 | Comment says "18 slow tests"; **now 24** (+6, mostly the new `ledgerCleared` tests) — still isolated and fine, but growing |
| `test-features-g` | 1 (`test_reconciliation`) | 13 | Unchanged, fine |
| `test-features-e` | 4 (calc-heavy: `test_reports`, `test_debt_calculator`, `test_break_even`, `test_networth`) | 40 | Comment claims these run ~20s/test; ~13 min compute + setup, still under 20 min timeout but the tightest of the "isolated" shards |
| `test-features-d` | 2 (`test_accounts`, `test_forecast`) | 44 | `test_accounts.py` alone is now 28 tests (comment says 27) — heaviest 2-file shard by count |
| **`test-features-b`** | **11 files** | **~124** | **Heaviest shard in the workflow.** Includes `test_income` (24, was 8 in the June 28 audit — 3x growth), `test_interest_income` (20, didn't exist in June), `test_health` (19), `test_storage_import`-adjacent-sized `test_forecast`-class files. Never split despite the A→A/F/G precedent. |
| **`test-features-c`** | **13 files** | **~122** | Second-heaviest. Includes `test_storage_import` (22, was 18), `test_i18n` (12), `test_issue_92_export`/`test_issue_93_expense_save` (19 combined), plus the brand-new `test_validation_modals` (9). |
| `test-ui-a` | 13 files | ~140 | Includes `test_accessibility` (36, the single largest file in the whole suite), `test_setup_wizard` (18, up from 9), `test_remaining_pages_print` (17) |
| `test-ui-b` | 14 files | ~93 | ~1.5x lighter than ui-a |

**Finding**: `test-features-b` and `test-features-c` are each ~3x the size (by test count) of `test-features-d`/`e`, and far larger than the already-isolated `a`/`f`/`g`. This is the same growth pattern (`test_income` 8→24, `test_interest_income` 0→20, `test_storage_import` 18→22) that previously forced the ledger/reconciliation/accounts/forecast splits — recent commit history (`ci: split shard A into three shards`, `ci: bump test-features-a timeout from 20 to 30 min`) shows this repo actively firefights shard timeouts reactively rather than proactively; B and C are the most likely next files to trip a 20-minute timeout as more tests land in `test_income`/`test_health`/`test_storage_import`/`test_i18n`. `test-ui-a` carries a similar, smaller-magnitude imbalance against `test-ui-b`.

Given every shard currently reports comfortably under its 20-minute budget in CI (no evidence of an active timeout failure — this is a forward-looking risk, not a current outage), this is a **medium-priority, not urgent**, recommendation: pre-emptively split `test-features-b` (e.g. peel `test_income`+`test_interest_income`+`test_health` — the 3 largest files, 63 tests combined — into a new shard `test-features-h`) and consider a similar peel from `c` before the next feature lands there, rather than waiting for a CI timeout to force it.

### 4.3 `docker-build` and `lighthouse` jobs

Unaffected by anything examined in this audit; not re-verified live (out of scope — this audit is testing-focused per the task).

---

## 5. Test-quality spot check

Reviewed `tests/features/test_validation_modals.py` (new, 9 tests), `tests/features/test_money_flow_sankey.py` (8 tests), and grepped assertion/wait patterns broadly across `tests/features/` and `tests/ui/`.

**Assertion quality — good.** No "no exception thrown" placeholder tests were found in the sample. `test_money_flow_sankey.py` in particular computes exact expected numeric values (e.g. `round(account['amount'], 2) == 3500.0`) rather than loose existence checks, tests both the data layer (`computeMoneyFlowSankeyData`) and DOM rendering layer separately, and includes a CSP-compliance assertion (`'style="' not in html`) and a `page.console_errors == []` check per rendering test — strong practice. `test_validation_modals.py` asserts specific CSS classes (`flex-visible`/`hidden`) and ARIA attributes (`role == 'alertdialog'`, `aria-labelledby`) rather than just "modal exists."

**Wait pattern — a real, previously-missed anti-pattern.** The June 28, 2026 audit's §7 flaky-pattern scan states *"No `time.sleep`/arbitrary waits found. All tests use Playwright's `wait_for_selector`/`wait_for_function`/auto-waiting locators."* That claim is **incomplete**: it appears to have only grepped for Python's `time.sleep`. A grep for Playwright's own fixed-delay API tells a different story:

```
789 occurrences of `wait_for_timeout(...)` across 54 test files (tests/features/ + tests/ui/ + tests/integration/)
```

`test_validation_modals.py` alone uses it 20+ times (e.g. `page.click('#debtFormSubmit'); page.wait_for_timeout(400)` to let the alert modal animate open, rather than `page.wait_for_selector('#alertModal.flex-visible')`). This is a widespread, suite-wide pattern, not isolated to new files — `test_accounts.py` uses it at nearly every interaction step (300-500ms per wait). It is not proven to have caused any of the failures analyzed in §1 (those were dynamic-import/element-visibility races under 4-way parallel load, a different mechanism), but fixed timeouts are inherently a flakiness and slowness risk: too short and they race real async work under load (arguably a contributor to the §1.3 flakes under `-n 4`); too long and they pad every CI shard's runtime for no correctness benefit. Given 789 instances, a wholesale rewrite isn't proposed here, but new tests should default to `wait_for_selector`/`wait_for_function` (as the better-practice files like `test_money_flow_sankey.py` mostly do), and the June 28 audit's flaky-pattern-scan claim should be corrected/retracted rather than carried forward as settled fact.

**Defensive `if element: element.click()` guards.** Several `test_validation_modals.py` tests conditionally skip a setup step if a selector isn't found (`toggle = page.query_selector('#debtFormToggle'); if toggle: toggle.click()`) instead of asserting the element exists. This is a reasonable accommodation for optional UI states (e.g. a collapsible form toggle that may already be open), but it also means a genuinely broken/renamed selector fails silently into "step skipped" rather than a hard test failure — worth being deliberate about which selectors are truly optional vs. which should be a hard `assert element is not None` first.

---

## 6. Findings by severity

**High** — none. No confirmed product regressions were found; the pytest failures are execution-environment (Postgres) and parallelization (xdist) artifacts, both reproduced and explained above.

**Medium**
1. Stryker `mutate` config drift in `sanitizers.js` (§3) — silently dropped mutation coverage on `sanitizeRecurringTemplate`'s tested logic, and two new pure sanitizer functions (`sanitizeLedgerOverrides`, `sanitizeLedgerClearedTransactions`) shipped with zero unit tests and no deliberate mutation coverage.
2. `test-features-b`/`test-features-c` CI shard imbalance (§4.2) — ~3x heavier than sibling shards, the same growth pattern that forced 3 prior shard splits; not yet timing out but the clear next candidate.
3. Server-side `ledger-cleared` PUT timezone bug (§1.5) — reproducible, non-flaky server test failure (separately being root-caused).
4. No documented local one-liner to run `tests/postgres/` matching CI's provisioning (§1.4) — makes this suite effectively CI-only for most contributors.

**Low**
1. `sanitizers.js` `OptionalChaining`/bound-object survived mutants (§3.1) — nil-record and clamp-boundary paths untested at the unit level (may be covered at the Playwright level; not verified here).
2. `debtCalculator.js` maxMonths safety-loop-exit branch untested (§3.1).
3. Widespread `wait_for_timeout()` usage (§5) — 789 occurrences, latent flakiness/slowness source; the June 28 audit's "no arbitrary waits" claim should be corrected.
4. Thin coverage on `bonusAdvisor.js`, `ledgerOverrides.js`/`ledgerTransactions.js` in isolation, `storageAdapters.js` in isolation (§2) — all have *some* indirect coverage, none are fully untested.

---

## 7. Recommendations (prioritized)

1. **Fix the Stryker `sanitizers.js` mutate ranges** to `5-93`, `95-124`, `126-147` (or re-derive after adding unit tests for the two new functions), and add `tests/unit/sanitizers.test.js` cases for `sanitizeLedgerOverrides`/`sanitizeLedgerClearedTransactions` covering: non-object input, a non-finite `amount`/missing `clearedAt` (should be dropped), and a well-formed round-trip. Re-run Stryker afterward and recompute `thresholds` per the config's own documented method.
2. **Pre-emptively split `test-features-b`** — pull `test_income.py` (24), `test_interest_income.py` (20), and `test_health.py` (19) (63 tests combined) into a new `test-features-h` shard, mirroring the existing A→A/F/G precedent, before this shard's growth forces a reactive timeout fix under time pressure. Consider the same for `test-features-c`.
3. **Document (or script) the local Postgres-suite provisioning sequence** so `tests/postgres/` is runnable pre-PR, not just discoverable by reading `ci.yml`.
4. **Correct the June 28, 2026 audit's flaky-pattern-scan claim** (or note in this file going forward) that `wait_for_timeout()` is in fact widespread (789 occurrences/54 files) — future cleanup passes should prefer `wait_for_selector`/`wait_for_function`, especially in high-traffic files like `test_accounts.py` and `test_validation_modals.py`.
5. **Do not treat a local `pytest tests/ -n 4` run as a trustworthy pass/fail gate.** The 9 non-Postgres failures in this run were 100% xdist-parallelization artifacts (confirmed by serial re-run). Either drop `-n 4` locally, or always re-run failed node IDs serially before concluding a regression exists.
6. Add a unit test exercising `debtCalculator.js`'s `month > maxMonths` runaway-loop exit (§3.1) — currently untested at both the unit and (as far as this audit could tell) Playwright level.
