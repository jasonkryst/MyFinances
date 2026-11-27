# Testing Audit: v8.8.6 (2026-11-27)

**Baseline:** [TESTING_AUDIT_2026-11-04.md](TESTING_AUDIT_2026-11-04.md) (2 High / 7 Medium / 9 Low). **Method:** static inventory (file counts, grep of test functions, CI config, guards). Tests were **not** executed: the Playwright suite needs the Docker stack, and a local Jest run failed on environment setup (below). CI is the source of truth for pass/fail.

## Inventory (static, approximate)

| Suite | Files | Count | Notes |
|---|---|---|---|
| Playwright (`tests/**/*.py`) | about 240 | 2,531 `def test_` (parametrized cases run more) | features, ui, security, a11y, integration, postgres |
| Jest (`tests/unit/`) | 75 entries | grep finds about 1,550 `it(`/`test(`; README states 1,735 (Jest counts `each` cases) | pure modules |
| Server (`server/test/`) | about 40 files | grep finds about 470; README states 527 | `node:test` against a real Postgres |
| Mutation | 29+ files with floors in `tools/mutationFloors.json` | scope by function name in `tools/strykerScope.mjs` | floors derived from CI artifacts |

2026-11-04 had 2,141 Playwright, 457 Jest and 220 server tests: the suites have grown by roughly 18%, 280% and 140% respectively (using the README's Jest and server numbers).

## Resolved since 2026-11-04

| Prior | Now |
|---|---|
| T-09 no per-test timeout or `--maxfail` | `pytest.ini` timeout 120 s, `pytest-timeout` pinned, CI `--maxfail=15`, `timeout-minutes: 15` (CLAUDE.md) |
| T-17 unpinned test dependencies | `tests/requirements.txt` pins all five packages exactly (#559) |
| T-16 concurrent runs clobber each other | stack lock, enforced (#558) |
| T-15 server gaps (forgot-password, persons) | `forgotPassword.test.js`, `loginRecovery.test.js`, `sessions.test.js`, `apiTokens.test.js`, `auditLog.test.js` exist |
| T-14 shard-coverage guard counts YAML comments | `test_ci_shard_coverage.py` still exists and is in shard K; not re-read |
| T-11 duplicated SW-blocked fixture | `app_page_no_sw` is a shared fixture (CLAUDE.md) |
| T-04 `prompt()` in Savings Contribute | `src/savings.js:662` replaced it with a modal (#546) |

## Findings

### TEST-01 (Info): Jest does not run in a plain local checkout here
`npx jest` fails with `Module ... jest-circus/build/runner.js in the testRunner option was not found`. `node_modules` in this checkout is incomplete (an install problem, not a repo defect; CI installs cleanly and the maintainer runs Jest through Docker per the project notes). **Suggestion:** add a one-line "if Jest cannot find `jest-circus`, run `npm ci`" note to `tests/README.md`, or a `npm run test:unit:docker` script.

### TEST-02 (Low): residual skip and sleep debt
`grep` finds **187** `wait_for_timeout` calls and **20** `pytest.skip` calls without a `skip-ok` marker. Both are capped by ratchet or guard tests (`test_sleep_ratchet.py`, the element-missing skip guard), so the count cannot grow silently, but it is also not shrinking on its own. The 20 un-annotated skips should each be triaged: either assert instead, or annotate with the reason. No new issue is proposed because the guards exist; treat it as a periodic clean-up.

### TEST-03 (Info): README test counts are approximate by design
The README says "Counts are from 2026-11-23 (v7.32.1) and will drift", but the app is now 8.8.6. Updated in this PR to cite this audit's static counts and the date; the CI run remains authoritative.

### TEST-04 (Low, carried): cross-page invariant tests
See FUNC-R1 in the [functionality audit](../features/FEATURES_AUDIT_2026-11-27.md). The suite is strong per feature and weaker where several pages must agree.

## Positive observations
- CI gating is explicit: `ci-complete` is the one required check and a guard fails if a job is missing from its `needs:`.
- Playwright hygiene is enforced by tests (no new sleeps, no bare `text=` locators, no date-dependent skips, new files must join a shard).
- Mutation floors are derived from CI artifacts, not local runs, and scoped by function name.
- The harness refuses to run against a stack holding real data (`app_page` wipes only the test user's data, and the docs warn loudly).

## Recommendation
Keep the ratchets; spend effort on (1) the cross-page invariant test, (2) triaging the 20 plain skips, (3) a manual phone/Back-button check that CI cannot do.
