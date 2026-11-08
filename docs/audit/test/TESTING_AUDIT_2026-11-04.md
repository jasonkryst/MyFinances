# MyFinances Testing Audit — November 4, 2026

**App version under test**: 7.0.0 (PostgreSQL-only storage, PR #458, merge commit `3d156a1` on `main`; audited from branch `docs/v7-security-audit`)
**Scope**: All test suites: Playwright/pytest (`tests/features`, `ui`, `integration`, `security`, `a11y`, `postgres`), Jest unit tests (`tests/unit`), Stryker mutation testing (`stryker.config.mjs`, `tools/strykerScope.mjs`), the server's node:test suite (`server/test`) and the CI wiring in `.github/workflows/ci.yml` (shards, `build-images`, `start-stack`, `ci-complete`). Tracks changes since `TESTING_AUDIT_2026-10-06.md` (v6.10.7).
**Method**: Static review of the test code, the harness (`tests/conftest.py`) and CI YAML. Python AST scans for missing or weak assertions, plus greps for sleeps, skips and locators. GitHub Actions history for timing, flakes and mutation scores. Selected local runs.
**Tools run**:

| Tool | Result |
|---|---|
| `pytest tests --collect-only -q` | 2,141 tests in 140 files |
| Jest (`npx jest tests/unit`, node:26 in Docker) | **457 / 457 passed**, 13 suites, 8.1 s. Prints one "worker process has failed to exit gracefully" warning. |
| Server suite (`npm test`, node:26 in Docker, against `server-postgres-test-1`) | **220 / 220 passed**, 17 files, 198 s |
| Playwright, local stack at :32901 | `test_p1_batch2.py`, `test_ledger_filter_persistence.py`, `test_plan_history.py`: **39 passed, 2 skipped**, 137 s. The two skips are finding T-02. |
| `gh run view` / `gh run list` | Green PR run 41765808874; main runs 41829904101 and 41645175088; 40 recent CI runs checked for flakes |
| Chromium launch micro-benchmark (5 runs) | Used for T-08 |
| Stryker | **Not run locally**, as briefed. Scores are taken from the `mutation-testing` job on `main`. |

Findings are verified unless marked *(inferred)* or *(est.)*.

---

## Executive summary

**Overall: GOOD breadth, with weak spots in reliability and the shape of the test pyramid.** v7 converted the whole Playwright suite to run against the real nginx + Node + Postgres stack. All 2,141 tests are sharded and ran green on the final PR run. However, **the `main` push run for the v7 merge commit is red**. A race in `test_plan_history.py` failed 3 tests there, after the same tree had passed on the PR. A second finding is that two Ledger tests have **always skipped in CI**, so CI stays green while they test nothing. About 11% of browser tests exercise only module functions through `page.evaluate`. They pay the cost of the full stack for work Jest could do in milliseconds.

| Severity | Count | Findings |
|---|---|---|
| High | 2 | T-01, T-02 |
| Medium | 7 | T-03 – T-09 |
| Low | 9 | T-10 – T-18 |

Another 10 observations duplicate open issues: #474, #475, #476, #467, #469, #470, #473, #526, #527 and #528. They are listed under [Duplicates of open issues](#duplicates-of-open-issues), with this audit's evidence.

**Top five:**
1. **T-01 (High).** `main` is red at `3d156a1`. `test_plan_history.py` reads `app.planHistory` as soon as Results is visible, but the entry is pushed only after `await pgPost(...)`.
2. **T-02 (High).** `test_ledger_filter_persistence.py` targets `#clearFiltersBtn`, but the real id is `#ledgerClearFiltersBtn`. Both Clear-filters tests skip on every CI run. Another 14 "element missing" `pytest.skip` guards would hide a regression the same way.
3. **T-03 (Medium).** Eight "rejected input" tests assert only that no card appears, and they check straight after the click. Since v7 a card renders only after `await pgPost`, so these tests would still pass if validation broke.
4. **T-04 (Medium).** The Savings **Contribute** flows (emergency and sinking funds) have no test. They use native `prompt()`, and the harness auto-accepts every dialog with an empty value.
5. **T-05 (Medium).** The pyramid is top-heavy. 240 browser tests are logic-only, 32 `utils.js` exports have no unit test (including `escapeHtml`), and the pure parts of `recurringPaid`, `ledgerTransactions`, `recurring`, `debtOwnership` and `categoryBudgets` have no unit tests at all.

---

## Inventory

| Suite | Files | Tests | Runner / where | Notes |
|---|---|---|---|---|
| `tests/features` | 74 | 1,476 | Playwright, 11 shards (a–k) | `test_i18n_coverage.py` alone has 175 |
| `tests/ui` | 43 | 476 | Playwright, 4 shards (a–d) | |
| `tests/security` | 6 | 80 | Playwright + static, 1 job | |
| `tests/postgres` | 12 | 79 | Playwright async, 1 job (+ Mailpit) | |
| `tests/integration` | 4 | 20 | Playwright, 1 job | |
| `tests/a11y` | 1 | 10 | Playwright + axe, 1 job | |
| **Playwright total** | **140** | **2,141** | 19 jobs | 1,231 `feature`, 411 `ui`, 83 `security`, 20 `integration`, 6 `slow` marks |
| `tests/unit` (Jest) | 13 | 457 (390 static `test(`/`it(` + `.each` expansion) | `test-unit` | sanitizers 149, retirementCalculator 67, utils 40, passwordPolicy 28, balanceHistoryCore 26 |
| `server/test` (node:test) | 17 | 220 (163 static `test(`) | `test-server` | passwordSecurity 33, setup 18, crudResources 14 (×11 resources), keyedResources 12, planSettings 12 |
| Stryker | 6 source files in scope | 1,765 mutants | `mutation-testing`, post-merge on `main` only | score 67.20% |

**Pyramid:** 2,141 browser tests (76%) against 677 unit and server tests (24%). By test count the browser layer is 3.2× the size of the fast layers, and it costs about 63 runner-minutes of pytest time per PR, at about 1.77 s per test (T-05, T-08).

---

## Coverage map by feature

Unit = Jest; Server = node:test; E2E = Playwright (file → tests).

| Area | Unit | Server | E2E | Gaps |
|---|---|---|---|---|
| Debts | `debtCalculator` 12, `sanitizeDebt`/ownership split | crud ×4, `ownershipSplit` jsonb | `test_debts` 49, `test_debt_ownership_split` 25, `test_break_even` 17, `ui/test_debt_card_layout` 6 | `debtCalculator.js` mutation score 43.5% (T-07); negative-amount test is weak (T-03); `debtOwnership.js` math is untested by Jest (T-05) |
| Accounts | `sanitizeAccount`, `balanceHistoryCore` 26 | crud, notes/HSA round-trip | `test_accounts` 54, `test_interest_income` 20, `test_balance_history` 24, `ui/test_accounts_ui` 7 | `computeAccountBalance` is reachable only through the browser |
| Income / bonuses | `computeNetIncomeAmount`, `computeMonthlyIncomeForMonth` | crud, withholding | `test_income` 61, `test_bonus_advisor_discoverability` 8 | `getIncomePaydaysInMonth`/`countIncomePaydaysInMonth` have no unit test, though the server copies them; 3 weak rejection tests (T-03) |
| Recurring | `sanitizeRecurringTemplate` | crud, `income` type | `test_recurring` 19, `_archive` 13, `_income` 19, `_occurrences` 5, `_paid_ledger_sync` 18, `_r01_r02` 12 | Occurrence and paid-state logic has no unit tests (T-05); 7 date-dependent skips (T-10) |
| Savings | EF/sinking sanitizers | crud | `test_savings` 21 | **Contribute flows untested** (T-04); 13 fixed sleeps |
| Plan / strategy | `debtCalculator`, `sanitizePlanHistoryEntry` | `planHistory` 5, `planSettings` 12 | `test_strategy` 13, `test_plan_history` 5, `test_plan_stale_warning` 6, `test_refinance_scenario` 19, `ui/test_whatif_simulator` 4, `ui/test_strategy_calendar` 4 | **Plan-history race, currently red on `main`** (T-01) |
| Reports (all 8 sub-tabs) | — | — | `test_reports` 15, `_money_flow_sankey` 8, `_networth` 11, `_cash_flow_trend` 5, `_spending_analysis` 10, `ui/test_spending_ui` 26, `_report_range_utils` 8, `ui/test_reports_nav` 12, `_reports_date_range` 5, `_category_budgets` 13 | Range helpers are pure `utils.js` functions, tested only in a browser (T-05) |
| Ledger | `sanitizeLedger*` | ledger-overrides / ledger-cleared | `test_ledger` 67, `test_ledger_filter_persistence` 6 | **Clear-filters tests always skip** (T-02); `ledgerTransactions` has no unit tests |
| Reconcile | `sanitizeReconciliation` | crud | `test_reconciliation` 18, `_statement_range` 29, `ui/test_reconciliation_actions` 14 | — |
| People | `sanitizePerson`, remap helpers | field parity only | `test_people` 36, `test_import_person_remap` 12 | No server CRUD or isolation test for `/api/persons`; person FK ownership is untested (T-15) |
| Transfers | — | crud + IDOR | `test_transfers` 12, `ui/test_transfers` 13 | `sanitizeTransfer` has no unit test and is outside the Stryker scope (T-06) |
| Import / export | sanitizers, `settingsExport` 21 | — | `test_storage_import` 26, `test_data_export` 4, `test_issue_92_export` 9, `integration/test_workflows` 11, `postgres/test_postgres_import` 15 | `sanitizeParsedState` is deliberately left to Playwright |
| Retirement | `retirementCalculator` 67 | crud | `test_retirement` 47, `_coast_fire` 17 | — (91.7% mutation score) |
| Home purchase | `sanitizeHomePurchasePlan` | plan-settings jsonb | `test_home_purchase` 15 | — |
| Category budgets / $0 policy | — | plan-settings jsonb | `test_category_budgets` 13, `test_zero_amount_policy` 32 | `sanitizeBudgetCategories` (prototype-key filter) has no unit test and is out of scope (T-06) |
| Settings | `settings` 9, `settingsExport` 21 | settings keyed | `test_settings` 17, `test_settings_backup` 8, `ui/test_setup_wizard` 13 | `settings.js` is outside the Stryker scope (T-06); weak focus-fallback test (#474) |
| Auth / login gate / password | `passwordPolicy` 28 | auth 11, passwordSecurity 33, setup 18, middleware 5, argon2 1 | `ui/test_password_security` 24, `postgres/test_password_reset` 9, `_setup_wizard` 6, `ui/test_login_gate_theme` 4 | `/auth/forgot-password` has no server test, E2E only (T-15) |
| v7 boot / gates / banner / legacy | `storage` 16, `lazyModules` 9 | app 7, migrations 10 | `test_server_only_storage` 13, `test_sync_error_banner` 14, `test_app_ready` 4, `postgres/test_legacy_local_data` 9, `security/test_no_browser_financial_storage` 3, `integration/test_pwa_offline` 4 | Legacy Transfer retry (#467) |
| Calendar feed | — | **none** for `calendarGenerator.js` or the `/api/calendar/token` routes | `test_calendar_feed` 28 (client), `postgres/test_calendar_feed_content` 5, `_calendar_security` 6 | No client/server parity test (#526) |
| Email | — | emailSend 3, emailTemplates 7, emailTransport 5, notifications 5 | `postgres/test_postgres_notifications` 1 | Reset email is only exercised E2E |
| i18n | `i18n` 6 | — | `test_i18n_coverage` 175, `test_i18n` 21 | — |
| PWA | — | — | `test_pwa` 13, `test_pwa_icons` 8, `ui/test_pwa_update_banner` 5, `integration/test_pwa_offline` 4 | — |
| CI guards | `strykerScope` 5 | `check-migration-order.sh` | `test_ci_shard_coverage` 9, `test_versioning` 8, `test_whats_new` 13, `ui/test_css_integrity` 12 | The guard also matches paths inside comments (T-14) |

**Server routes vs `server/test`.** All 23 routers in `server/src/routes` are referenced by at least one test file. The thin ones are:
- `calendar.js` and the public `/calendar.ics`: no node:test at all (E2E only).
- `persons.js`: only `fieldParity.test.js`.
- `auth.js` `/forgot-password`: no node:test.

---

## Findings

| # | Issue | Area | Evidence | Severity | Recommendation | Est. effort |
|---|---|---|---|---|---|---|
| T-01 | **`test_plan_history.py` races the plan-history POST; `main` is red at the v7 merge** | Plan / flake | Run 41829904101 (push, `3d156a1`): `test-features-a` failed `test_calculate_records_plan_history_entry` (`assert 0 == 1`), `test_repeated_calculations_show_newest_first` (`1 == 2`) and `test_plan_history_caps_at_twenty_entries`. PR run 41765808874 passed on the same tree, and locally all 5 passed. Cause: `src/strategyPlanCalculation.js:118-123` makes `#resultsSection` visible, *then* awaits `recordPlanHistoryEntry`, which awaits `pgPost` before `planHistory.push`. The helper `_calculate` (`tests/features/test_plan_history.py:21-27`) waits only for `#resultsSection.visible`, then lines 37, 55 and 83 read `window.app.planHistory`. | High | In `_calculate`, also wait for the history to grow: `wait_for_function('(n) => window.app.planHistory.length === n', arg)`, or wait for the `#planHistoryBody tr` count. Then re-run `main`. | S (≤1 h) |
| T-02 | **Two Ledger Clear-filters tests always skip; 14 other "element missing" skips can hide regressions** | Ledger / weak tests | `tests/features/test_ledger_filter_persistence.py:139-141` and `:166-168` query `#clearFiltersBtn`, but the app's id is `#ledgerClearFiltersBtn` (`src/ledger.js:546`). CI run 41765808874 `test-features-j`: "79 passed, **2 skipped**", the only skips in the whole run. The same 2 skipped locally. The same `if not el: pytest.skip(...)` pattern is at `test_ledger_filter_persistence.py:48,53,80,101,129,161`, `test_p1_batch2.py:398,416,434,451,479`, `test_validation_modals.py:196` and `ui/test_spending_ui.py:549,572`. | High | Fix the selector. Replace every element-missing `pytest.skip` with an `assert`, so a missing control fails the test. Optionally add a CI step that fails on any unexpected `SKIPPED` (allow-list the date skips from T-10). | S |
| T-03 | **Rejection tests check for absence straight after the click, with no positive signal** | Debts, Income, Expenses | `test_income.py:149,175,1079`, `test_debts.py:309` and `test_expenses.py:143,192,221,244` click submit and immediately assert that `query_selector(...) is None`. Since v7, adds render after `await pgPost` (`src/income.js:271-273`), so a broken validator would create the card *after* the assertion had already passed. None of these tests asserts that the validation `#alertModal` appeared. The AST scan also found 167 tests whose ≤2 asserts are existence or visibility only (e.g. the 9 `test_filter_sort.py *_present` tests). | Medium | Assert the alert modal and its text (`t('income.errAmountGreater')`, etc.). Then assert the server state with `wait_for_api(page, '/api/incomes', lambda r: r == [])` after dismissing it. | S |
| T-04 | **Savings Contribute flows are untested, and the harness swallows their `prompt()`** | Savings | `src/savings.js:572` and `:776` call native `prompt()`. `tests/conftest.py:65` (and 5 copies) does `page.on("dialog", lambda d: d.accept())`, which returns `""`, so the flow exits at `if (!amount) return`. No test clicks `[data-emergency-action="contribute"]` or `[data-sinking-action="contribute"]`; `test_savings.py:286,307` only count the buttons. *(inferred)* The native dialog also departs from the app's no-native-dialogs pattern. | Medium | Add tests that use `page.once("dialog", lambda d: d.accept("50"))` for both fund types, and assert the new balance in the UI and through `/api/emergency-funds` / `/api/sinking-funds`. Track replacing `prompt()` with a themed modal separately. | S–M |
| T-05 | **Top-heavy pyramid: logic tested only through the browser** | Pyramid | The AST scan found 240 browser tests that call only `page.evaluate` with no DOM use, for example: `test_storage_import` 24, `test_ledger` 18, `test_reconciliation` 16, `test_debt_calculator` 10 (Jest also covers this), `test_spending_analysis` 10, `test_report_range_utils` 8 (pure `utils.js` helpers). 32 of 45 `utils.js` exports have no Jest test, including `escapeHtml`, `sanitizeTimestampISO`, `getIncomePaydaysInMonth`, `computeSavingsRate` and `isRecurringInflow`. `recurringPaid` (8 exports), `ledgerTransactions` (7), `recurring` (15), `debtOwnership` (9) and `categoryBudgets` (7) have no unit test file. | Medium | Move the pure helpers to Jest first: the report-range helpers, payday/occurrence math, `escapeHtml`, `getDebtShare`/`autoBalancePercents` and `computeCategoryBudgets` (with an `app` stub). Add them to `MUTATE_SCOPE`. Keep one browser smoke test per feature. *(inferred)* Some modules need a DOM-free split first. | M (1–3 d) |
| T-06 | **Stryker scope holes: unit-tested or security-relevant functions are not mutated** | Mutation | `tools/strykerScope.mjs:13-41`: `sanitizeTransfer` and `sanitizeBudgetCategories` (the `__proto__`/`constructor` filter) are neither listed nor in `EXCLUDED`, and neither has a Jest test. `settings.js` (`settings.test.js` 9 and `settingsExport.test.js` 21 tests), `storage.js` (16), `lazyModules.js` (9) and `i18n.js` (6) are tested but unscoped. The `main` mutation log shows e.g. `getZeroAmountPolicy … (covered 0)`. The scope guard checks only imports from files that are already scoped. | Medium | Add unit tests for the two sanitizers. Add them and `settings.js`'s pure functions to `MUTATE_SCOPE`. Extend `strykerScope.test.js` so every `export function sanitize*` in `sanitizers.js` must be listed or `EXCLUDED`. | S–M |
| T-07 | **The global mutation score hides weak files, and mutation testing never gates a PR** | Mutation | Run 41829904101 `mutation-testing`: total **67.20%** (1,175 killed / 459 survived / 120 no-coverage / 11 timeouts of 1,765). `debtCalculator.js` scored **43.49%** with 69 no-coverage mutants; `sanitizers.js` **54.35%** with 261 survivors. The thresholds `high 69 / low 64 / break 54` (`stryker.config.mjs:20`) are global, and the job runs only on push to `main` (`ci.yml:723`), so a drop shows up only after merge. | Medium | Kill the `calculatePaymentPlan` no-coverage mutants first (payment-plan edge cases). Add a per-file floor (a small script over `reports/mutation/mutation.json`). Consider an incremental Stryker run on PRs that touch scoped files. | M |
| T-08 | **The harness launches a new Chromium per test and loads the app twice per test** | Harness / CI cost | `tests/conftest.py:38-45`: the `browser` fixture is function-scoped. Measured locally: launch plus page **0.74 s**, against **0.07 s** for a new context plus page (5 runs each). Across 2,141 tests that's about 24 runner-minutes per full run *(est.; Linux CI may be faster)*. `app_page` (`:348-356`) runs `goto(networkidle)`, then `reset_server_state`, which wipes and **reloads** (`:249-255`). Local setup times are 2.5–2.9 s per test (`--durations`). | Medium | Make `browser` session-scoped and give each test a fresh `context`. Reset server data over HTTP with `_http_json`, before the single `goto`. Re-measure on a shard. | S–M |
| T-09 | **No per-test timeout or `--maxfail`: a broken boot burns the 20-minute job and prints no summary** | CI | `test-features-d` was **cancelled** at the job timeout in runs 41763545520 (20 m 25 s), 41760091841, 41764269633 and 41764646676. In 41763545520 the log ends with `ERROR` setups and `##[error]The operation was canceled.`, with no pytest summary. `tests/requirements.txt` has no `pytest-timeout`, and the CI `pytest` calls have no `--maxfail`. | Medium | Add `pytest-timeout` (e.g. `timeout = 120`) and `--maxfail=15` to the Playwright jobs, so a broken stack fails fast with a readable summary. | S |
| T-10 | **Date-dependent runtime skips lose coverage on some days of each month** | Recurring / Reports | `test_recurring_r01_r02.py:151,175,196,218,241,262` ("Cannot reliably test overdue on the 1st"), `test_number_clarity.py:197`, `test_p1_batch3.py:120` and `test_recurring_paid_ledger_sync.py:357`. | Low | Pin the browser clock with Playwright's `page.clock.set_fixed_time(...)` (or seed dates relative to a fixed day), and drop the skips. | S–M |
| T-11 | **The service-worker-blocked `app_page` fixture is copied 3 times, and the copies have drifted** | Harness | `test_code_splitting.py:26`, `test_sync_error_banner.py:16` and `ui/test_password_security.py:20`. None wraps `page.reload` with the readiness wait. The `test_sync_error_banner` copy never sets `page.console_errors`, so `assert_no_errors` there would raise `AttributeError`. (#474 covers only the reload in `test_code_splitting`.) | Low | Add one `app_page_no_sw` fixture to `conftest.py` that reuses `_wrap_reload` and the console hooks, and delete the 3 copies. | S |
| T-12 | **Fixed sleeps are back up to 204 (`wait_for_timeout`, 93 s total)** | Quality | 204 calls in 44 files; summing the literal delays gives 93.4 s. Top files: `test_filter_sort` **22** (unchanged since the 10-06 audit), `test_health` 17, `a11y/run_a11y_audit.py` 17, `test_savings` 13, `postgres/test_postgres_import` 11, `test_p1_batch2` 10, `test_code_splitting` 10. There are no `time.sleep` calls, and 0 string-expression `wait_for_function` calls (all 89 are function form, which the CSP allows). | Low | Replace sleeps with `wait_for_function`/`wait_for_api` on the expected state. Start with `test_filter_sort`, `test_health` and `test_savings`. Add a ratchet test that fails if the count grows. | M |
| T-13 | **84 unscoped `text=` locators** | Quality / flake risk | `test_debts` 21, `test_income` 16, `postgres/test_postgres_mutations` 10, `test_accounts` 7, `test_interest_income` 5. CLAUDE.md documents the hidden Health `.health-card-util-name` span that matches unscoped names. | Low | Scope each to its page container (`#debtsList >> text=…`), or use `get_by_role`/`locator(...).filter(has_text=)`. | S–M |
| T-14 | **The shard-coverage guard counts paths in YAML comments; the CI header comment is stale** | CI guard | `test_ci_shard_coverage.py:20-23` regex-scans the whole `ci.yml`. The comment at `ci.yml:776` names `tests/features/test_ci_shard_coverage.py`, so removing that file from shard K would still pass. The header (`ci.yml:38`) says "9 parallel shards"; there are 11 (a–k). | Low | Strip `#` comment lines before matching, and add a negative test for it. Update the header comment. | S |
| T-15 | **Server-side test gaps: forgot-password, persons, person FK ownership** | Server | No node:test covers `POST /auth/forgot-password` (`server/src/routes/auth.js:184-209`): unknown email → `ok`, token row written, mail failure tolerated. `/api/persons` has only `fieldParity` coverage; it isn't in the `crudResources` isolation loop. The `incomes.personId` ownership check (`routes/incomes.js:8`) has no IDOR test. `debts.personIds` accepts ids that don't exist, and `crudResources.test.js:372` depends on that. | Low | Add forgot-password tests. Add `/api/persons` to the CRUD loop. Add an `incomes.personId` IDOR test. Decide whether `debts.personIds` should be validated, and test either way. | S–M |
| T-16 | **Shared single-user harness: concurrent runs clobber each other, and a fresh stack gets claimed** | Harness | Every `app_page` wipes the one user's data (`conftest.py:249-255`), and there is no inter-process lock, so two pytest processes against one stack corrupt each other (the brief's "never run two pytest at once" is the only guard). `_login_or_register` (`:151-184`) **registers** the test user on any stack that reports `needsSetup: true`, so pointing `TEST_BASE_URL` at a brand-new real deployment claims it. | Low | Take a file lock keyed on `_API_ROOT` for the session. Require an explicit opt-in (e.g. `MYFINANCES_TEST_STACK=1`) before registering. Document both in `tests/README.md`. | S |
| T-17 | **Test dependencies are unpinned** | CI reproducibility | `tests/requirements.txt` lists `playwright`, `pytest`, `pytest-asyncio` and `httpx` without versions. Local `__pycache__` holds both `pytest-9.1.1` and `pytest-9.2.0` bytecode. The Playwright browser cache key hashes this file, which never changes. | Low | Pin versions (or add a constraints file) and let Dependabot bump them. | S |
| T-18 | **A Jest worker leaks an open handle** | Unit | In both local runs Jest printed "A worker process has failed to exit gracefully and has been force exited… improper teardown". It appears next to `storage.test.js` *(inferred: the source)*. | Low | Run with `--detectOpenHandles`, then clear or `unref()` the timer or listener in teardown. | S |

---

## CI timing and flakes

**Green PR run 41765808874** (`4a8e75e`, the final #458 head). Wall clock 13.0 min, set by `test-features-c`.

| Job | Tests | Job min | pytest s | Setup/teardown s | s/test |
|---|---|---|---|---|---|
| test-features-c | 405 | 12.5 | 664 | 85 | 1.64 |
| test-features-b | 192 | 7.7 | 371 | 89 | 1.93 |
| test-ui-b | 165 | 7.5 | 367 | 85 | 2.23 |
| test-features-e | 150 | 6.9 | 308 | 108 | 2.05 |
| test-features-h | 206 | 6.6 | 315 | 81 | 1.53 |
| test-ui-c | 141 | 5.6 | 249 | 88 | 1.77 |
| test-features-a | 107 | 5.2 | 210 | 104 | 1.96 |
| test-ui-a | 111 | 5.1 | 214 | 90 | 1.93 |
| test-features-j | 81 (2 skipped) | 4.5 | 181 | 91 | 2.23 |
| test-postgres | 79 | 4.1 | 136 | 112 | 1.72 |
| test-features-f | 67 | 3.8 | 127 | 100 | 1.89 |
| test-features-k | 80 | 3.6 | 134 | 81 | 1.68 |
| test-features-d | 70 | 3.5 | 120 | 87 | 1.72 |
| test-security | 80 | 3.2 | 98 | 93 | 1.22 |
| test-ui-d | 59 | 3.0 | 88 | 92 | 1.50 |
| test-features-i | 81 | 3.0 | 88 | 91 | 1.09 |
| lighthouse | — | 2.7 | — | — | — |
| test-features-g | 37 | 2.6 | 73 | 81 | 1.98 |
| test-integration | 20 | 1.9 | 34 | 81 | 1.71 |
| test-server | 220 | 1.8 | — | — | — |
| test-a11y | 10 | 1.6 | 18 | 80 | 1.78 |
| test-unit | 457 | 0.4 | — | — | — |

The job-level sums match the collected count (2,141). Total pytest time is about 63 min. Shard imbalance (features-c is 12.5 min, against a median of about 4 min) and the fixed ~80–110 s of setup per job are already tracked in **#527** and **#528**.

**Flake history** (40 most recent `ci.yml` runs):

| Run | Branch / event | Failure | Classification |
|---|---|---|---|
| 41829904101 | `main` push, `3d156a1` | `test-features-a`: 3 × `test_plan_history.py` | **Flake** (passed on PR 41765808874 with the same tree; race, T-01). **`main` is currently red.** |
| 41755245842 attempt 1 | PR #458 | `test-features-a`, `lighthouse`: `start-stack` → "failed to bind host port for 0.0.0.0:32900 … address already in use" | **Flake** (attempt 2 green). Tracked in #469; this audit adds the root-cause line. |
| 41763545520, 41764269633, 41764646676, 41760091841 | PR #458 | 18 jobs failed, `test-features-d` cancelled at 20 min | Real breakage during development, but it shows the T-09 cost (no fail-fast) |
| 41765163299 | PR #458 (`61db878`, "TEMP bisect") | `test-server`: `/api and /auth responses are Cache-Control: no-store` | Real (deliberate bisect commit) |
| 41641582634, 41525102706 | PR #456, #286 | ui-b; unit + server | Real (fixed in the next commit, different SHA) |

**Gating soundness.** `ci-complete` uses `if: always()`, fails on `failure|cancelled`, and its `needs` lists every job except `mutation-testing`, which `test_ci_shard_coverage.py` enforces. Two holes remain:
- A test that is skipped at runtime (T-02) still counts as green.
- Path matching includes comments (T-14).

---

## Mutation testing

- **Config.** `stryker.config.mjs` takes its `mutate` list from `buildMutateGlobs()` (name-based since #452). The Jest runner uses `perTest` coverage. Thresholds are `high 69 / low 64 / break 54`.
- **Scope** (`tools/strykerScope.mjs`):
  - `debtCalculator.js`: 3 functions
  - `utils.js`: 13 functions
  - `sanitizers.js`: 23 functions; `sanitizeParsedState` is excluded
  - `retirementCalculator.js`: 9 functions
  - `balanceHistoryCore.js` and `passwordPolicy.js`: the whole file

**Latest `main` runs:**

| Run | Commit | Score | Killed | Survived | No cov | Timeout | Mutants | Duration |
|---|---|---|---|---|---|---|---|---|
| 41829904101 | `3d156a1` (v7) | **67.20%** | 1,175 | 459 | 120 | 11 | 1,765 | 1 m 35 s |

**Per file at `3d156a1`:**

| File | Score | Covered score | Survived | No cov |
|---|---|---|---|---|
| retirementCalculator.js | 91.67 | 92.83 | 17 | 3 |
| balanceHistoryCore.js | 85.87 | 85.87 | 26 | 0 |
| passwordPolicy.js | 85.02 | 86.55 | 30 | 4 |
| utils.js | 75.98 | 76.40 | 42 | 1 |
| sanitizers.js | 54.35 | 58.11 | 261 | 43 |
| **debtCalculator.js** | **43.49** | 58.50 | 83 | **69** |

The score is up from 48.77% (October) to 67.20%, after the #452 scope fix and new tests. The remaining weak spots are `calculatePaymentPlan` (69 mutants that no test reaches) and the sanitizer survivors. Mutation testing runs post-merge only, so it never blocks a PR (T-07). Scope holes are in T-06.

---

## Carried-over findings (from TESTING_AUDIT_2026-10-06)

| Finding (10-06) | Status |
|---|---|
| 9 feature files (172 tests) in no CI shard | **Resolved.** All 140 files are sharded, and the `test_ci_shard_coverage.py` guard (#415) enforces it. Minor hole in T-14. |
| `test_filter_sort.py` has 22 `wait_for_timeout` | **Open.** Still 22 (T-12). |
| 8 sanitizers have no unit tests (`sanitizeBonus`, EF, sinking, net-worth snapshot, forecast settings, setting, reconciliation, plan history) | **Resolved.** All 8 are tested in `sanitizers.test.js` and in `MUTATE_SCOPE`. New gaps: `sanitizeTransfer`, `sanitizeBudgetCategories` (T-06). |
| Stryker line ranges stale | **Resolved** (#452: name-based scope plus a guard test). |
| `sanitizePerson` not in Stryker scope | **Resolved.** |
| `debtCalculator` runaway-loop (`maxMonths`) untested | **Resolved.** `debtCalculator.test.js:110` ("throws when the plan would exceed 600 months"). |
| `sanitizeTimestampISO` untested | **Open** (T-05). |
| `test_plan_history.py` thin (5 tests) | **Open, and now flaky** (T-01). |
| `bonusAdvisor.js` has no dedicated test | **Partially addressed.** `test_bonus_advisor_discoverability.py` (8); the elimination-plan logic still has no unit test. |
| `storageAdapters.js` untested in isolation | **Obsolete.** v7 removed the local and session adapters. `storage.test.js` (16) covers the server-only storage module. |
| Calendar client/server parity | **Open.** Tracked in #526. |
| Local Postgres test runbook | **Resolved.** CLAUDE.md "Server tests" plus the real-stack harness; every Playwright test now runs against Postgres. |
| XSS test for filter dropdown values | **Not re-verified** in this audit. |

---

## Duplicates of open issues

These findings are fully covered by open issues, so they are not exported again.

| Observation | Issue | Evidence this audit adds |
|---|---|---|
| Tests weakened in the v7 conversion | #474 | All 6 items confirmed at `3d156a1`: `test_issue_93_expense_save.py:99` (the issue says `test_expenses.py`), `test_recurring_paid_ledger_sync.py:326,345`, `test_settings.py:321-322`, `test_debt_ownership_split.py:509,522,544`, `test_code_splitting.py:26-46` (no `_wrap_reload`) and `test_harness.py:49-60`. An assertion-diff of `13c72cd..3d156a1` found no further weakening: removed asserts belong to obsolete local-storage tests, or were replaced by raising `wait_for_api` calls. |
| Legacy-import Transfer retry untested | #467 | Still open. `test_legacy_local_data.py` clicks `#pgMigrationTransferBtn` once per test (lines 70, 106). |
| `start-stack` flake | #469 | Run 41755245842 attempt 1: "failed to bind host port for 0.0.0.0:32900 … address already in use" in `test-features-a` and `lighthouse`. |
| Lighthouse audits the login gate | #470 | Not re-measured. |
| Browser-storage scanner hardening | #473 | `security/test_no_browser_financial_storage.py` (3 tests) is unchanged. |
| Harness session cache and `_APP_STATE_KEYS` | #475 | `conftest.py:143-148` (non-atomic write) and `:291-297` (hand list) confirmed. |
| Stale `ci.yml` "Kept inline" comment | #476 | Confirmed at `ci.yml:10`. T-14 covers the other stale header (shard count). |
| Calendar client/server parity / duplication | #526 | No node:test for `calendarGenerator.js`; the E2E tests cover only archived debts and paydays. |
| `test-features-c` sets the wall clock | #527 | 12.5 min, 405 tests (175 of them `test_i18n_coverage`). |
| Per-shard setup cost | #528 | 80–112 s of non-pytest time per job (table above). |

---

## Priority fixes

1. **T-01**: wait for `planHistory` to grow in `test_plan_history.py`, then re-run `main` to green. *(S, p0)*
2. **T-02**: fix `#ledgerClearFiltersBtn`, and turn the element-missing skips into asserts. *(S, p0)*
3. **T-09**: add `pytest-timeout` and `--maxfail` so broken stacks fail in minutes, not 20. *(S)*
4. **T-03 and T-04**: give rejection tests a positive signal, and add Contribute tests with `page.once("dialog", …accept("50"))`. *(S–M)*
5. **T-08**: session-scoped browser plus a single app load per test. Measure, then fold the savings into the #527/#528 rebalancing. *(S–M)*
6. **T-06 and T-07**: close the Stryker scope holes, then target `debtCalculator.js` no-coverage mutants and add per-file floors. *(M)*
7. **T-05**: move pure helpers from browser tests to Jest, starting with `utils.js` range, payday and escape helpers, `recurringPaid` and `debtOwnership`. *(M, ongoing)*
8. Low-severity hygiene: T-10 (pin the clock), T-11 (one no-SW fixture), T-12 (sleep ratchet), T-13 (scoped locators), T-14 to T-18.
