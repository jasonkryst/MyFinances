# MyFinances — Supplementary Audit (Dependency / PWA / Architecture)
# 2026-10-06

**App version audited:** 6.10.7
**Scope:** Dependency & supply chain, PWA/offline, code architecture & tech
debt — same three areas as the September 2026 baseline.
**Prior audit:** `other/MISC_AUDIT_2026-09-02.md` (app v4.40.0)

---

## Resolved since 2026-09-02

| Finding | Resolution | Notes |
|---|---|---|
| **[#157]** `codeql.yml` and `trivy.yml` pinned different `codeql-action` major versions | **RESOLVED** v5.4.4 — both files pin `@v4`; regression test `test_codeql_action_version_consistent` added | |
| **[#158]** `manifest.json` missing `id`, `categories`, `shortcuts` | **RESOLVED** — `id: "/"`, `categories: "finance productivity"`, `shortcuts` all present in current `manifest.json` | Confirmed by direct read. |
| **[#141]** `qs`/`body-parser` Express 4→5 upgrade | **RESOLVED** — `server/package.json` now specifies `express: "^5.2.1"` | |
| **[Low]** Root dev-tooling (Jest 29, Stryker 8) 1+ major version behind | **RESOLVED** — root `package.json` now shows `jest: "^30.5.2"`, `@stryker-mutator/core: "^10.0.0"`, `@babel/core` and `@babel/preset-env` updated | |
| **[Low]** Server `argon2` outdated (0.41.1) | **RESOLVED** — `server/package.json` shows `argon2: "^0.45.1"` | |
| **[Medium / #147]** `formatCurrency()` hardcoded `currency: 'USD'` | **RESOLVED** — `getCurrencyCode()` added to `src/i18n.js`; user-selectable via Settings modal (20 currencies, stored in `debtTrackerCurrency` localStorage key) | Details in i18n audit |
| **[Medium / #153]** `test-ui-a`/`test-ui-b` CI shard imbalance (148 vs 101 tests) | **RESOLVED** — CI now has three UI shards (`test-ui-a`: 4 slow files, `test-ui-b`: 13 fast files, `test-ui-c`: 13 fast files), balanced per current test counts | |
| **[#150]** 789 `wait_for_timeout()` calls across 54 test files | **MAJOR IMPROVEMENT** — count dropped from 789 to **81** across all test files; still tracked but no longer a dominant code smell | |

---

## Still open (carried from September)

### Medium

**[#149] Circular ES-module import chains centered on `ui.js` and
`postgresSync.js`.**

Confirmed still present. `src/ui.js` imports from `ledger.js` and
`accounts.js`; `src/postgresSync.js` imports from `ui.js` and `storage.js`.
The exact cycles documented in September still exist:

1. `postgresSync.js → ui.js → ledger.js → settings.js → postgresSync.js`
2. `ui.js → ledger.js → ledgerOverrides.js → ui.js`
3. `accounts.js → ledgerTransactions.js → recurring.js → accounts.js`

`ui.js` now also imports from `people.js` (new v6.10.0):
`import { refreshPersonSelectors } from './people.js'`, adding `people.js` to
the import chain. `people.js` in turn imports from `postgresSync.js`, which
creates a new cycle leg:
`ui.js → people.js → postgresSync.js → ui.js`.

All cycle-closing exports remain hoisted `function` declarations (safe per
ESM resolution rules), so this causes no runtime crash. The risk profile
documented in September is unchanged — any refactor of these exports to `const`
arrow functions would introduce a TDZ crash. The new `people.js` leg deepens
the architectural debt slightly.

**[#148] PWA offline test coverage proves app shell survives a reload, not
that the app is usable offline.**

Confirmed unchanged. `tests/integration/test_pwa_offline.py` still has the
same two tests from September (`test_app_shell_loads_offline_after_first_visit`,
`test_first_ever_visit_offline_does_not_load`). Neither exercises navigation,
data entry, or chart rendering while offline.

### Low

**[#150] Remaining `wait_for_timeout()` calls.**

81 calls remain (down from 789 — a 90% reduction). While no longer a dominant
code smell, the remaining 81 instances are still arbitrary sleeps that could
hide flakiness. Closing this fully means replacing each with a
`wait_for_selector` / `wait_for_load_state` or similar event-driven wait.
Still tracked.

---

## New findings

### Medium

**[N1] New circular import leg via `people.js`.**

As noted above, `ui.js` now imports `refreshPersonSelectors` from `people.js`,
and `people.js` imports `pgPost`/`pgPatch`/`pgDelete` from `postgresSync.js`,
which imports `showPgErrorToast` from `ui.js`. This closes a new 3-file cycle
on top of the existing ones: `ui.js → people.js → postgresSync.js → ui.js`.
All exports in this cycle are hoisted function declarations, so there is no
current crash — but it extends the `#149` architectural debt and is a new data
point in the same pattern. Recommendation is unchanged: extract `postgresSync.js`'s
error-toast coupling and `ui.js`'s modal helpers into a leaf-level module.

### Low

**[N2] `people.js` navigation button missing `data-i18n` attribute.**

The "People" nav button was added in v6.10.0 without a `data-i18n` attribute
or a `nav.people` key in any locale dictionary. On `es`/`pl` locales the nav
is fully translated except this one button. Mechanical fix: one attribute +
three locale keys. Detailed in `i18n/I18N_AUDIT_2026-10-06.md` as finding N1.

**[N3] Settings modal has four new hardcoded-English strings.**

Added since September (Show archived debts, Show archived recurring templates,
Send test email, Currency label) — none has a `data-i18n` attribute or a
corresponding key in the locale dictionaries. Settings modal is otherwise fully
translated. Detailed in `i18n/I18N_AUDIT_2026-10-06.md` as findings N3/N4.

**[N4] `wait_for_timeout()` count dropped 789→81 — confirm remaining 81 are
auditable.**

The 90% reduction is a significant improvement. The remaining 81 instances
should be reviewed to confirm each is intentional (e.g., a timing-dependent
animation test where no better signal exists) rather than a lazy fallback.
This is informational — the raw count no longer justifies the original Medium
severity.

### Informational

**[I1] `node-pg-migrate` under `server/` still pulls in a `glob`
vulnerability (CLI-only attack surface).**

`server/package.json` was updated to `express: "^5.2.1"` (resolving #141),
but `node-pg-migrate` is still present and still pulls in `glob` with a
`-c`/`--cmd` shell-injection vulnerability. As documented in September, this
is a developer-CLI-only surface (the migration runner), not reachable via
HTTP. Still low real-world risk. Dependabot's `server-deps` group is expected
to surface a `node-pg-migrate` bump when one is available.

**[I2] No TODO/FIXME/XXX/HACK markers.**

Confirmed still zero across all `src/*.js` and `server/src/*.js` files.

**[I3] `featureFn(app, ...)` delegation pattern — `people.js` is compliant.**

`src/people.js`'s exported functions (`addPerson`, `updatePerson`,
`deletePerson`, `renderPeoplePage`, etc.) all take `app` as their first
argument, consistent with the pattern documented in `CLAUDE.md`. The People
module follows the same one-line-wrapper approach as every other feature module.

---

## Summary of severities

| Section | Critical | High | Medium | Low | Info |
|---|---|---|---|---|---|
| Dependency & Supply Chain | 0 | 0 | 0 | 1 | 1 |
| PWA & Offline | 0 | 0 | 1 | 0 | 0 |
| Code Architecture & Tech Debt | 0 | 0 | 2 | 2 | 2 |

Open Medium items: #149 (circular imports, now with new `people.js` leg),
#148 (offline test coverage). Open Low: #150 (81 residual `wait_for_timeout`
calls), I1 (node-pg-migrate/glob, CLI-only).
