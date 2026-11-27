# Functionality Audit: v8.8.6 (2026-11-27)

**Baseline:** [FEATURES_AUDIT_2026-11-04.md](FEATURES_AUDIT_2026-11-04.md) (17 works / 3 degraded / 1 broken; F-01 to F-12).
**Method:** static review only. The app was not run this pass, so nothing below is a "verified in the browser" claim. Evidence is the code that implements each fix, the feature reference (`docs/architecture/features.md`) and the test guards that name it. A full manual regression of the 8.x features (phone tab bar, routing, change history, API tokens, sessions) is the main gap and is recommended before the next release.

## Status of the 2026-11-04 findings

| ID | Finding then | Now | Evidence in code |
|---|---|---|---|
| F-01 | Stale full-record PATCH reverts other edits | **Fixed** | `row_version` columns (migration), `pgPatch` diffs against a shadow and sends `rowVersion`, `src/recordVersions.js`, `seedShadows(app)` rule in CLAUDE.md |
| F-02 | Any save overwrites the whole plan-settings row | **Fixed** | `saveToStorage(app, fields)` PATCHes named fields only; `src/planSettingsPatch.js` (mutation floor 90) |
| F-03 | No refresh across tabs/devices | **Fixed** | `src/liveRefresh.js`, `REFRESH_ON_FOCUS_SECONDS` in compose |
| F-04 | Recurring transfer templates counted as income/spending | **Fixed** | `isTransferLegTx` used at 18 sites in `src/`; rule recorded in CLAUDE.md |
| F-05 | Merge import duplicates collections | **Fixed** | `mergeDedupe.js` `KEY_FNS`, `POST /api/import` (#529), `importCore.js` |
| F-06 | Server accepts invalid transfers/reconciliations | **Fixed** | `server/src/validity.js` (`validatedSanitizer`) |
| F-07 | Arbitrary settings keys, $0/targetless templates | **Fixed** | `isAllowedSetting` gate in `routes/settings.js`; `confirmZeroAmountAllowed` |
| F-08 | `sanitizeFiniteNumber(null, null)` returns 0 | **Not re-checked** | `src/sanitizers.js` still calls `sanitizeFiniteNumber(x, 0)` for required fields; the nullable-pension case needs a unit test read |
| F-09 | Ledger filters in two places | **Fixed** | "Ledger filters live on the server (#571)" |
| F-10 | "Monthly income" has no single definition | **Partly** | `computeMonthlyIncomeForMonth` documented as net; Health vs Reports parity is a standing rule ("check all three") but not enforced by a test |
| F-11 | Perpetual "Bills $0.00" | **Not re-checked** | needs a browser |
| F-12 | Net Worth report empty without snapshots | **Fixed** | "Net Worth trend without snapshots (#574, #585)" |

## Features added since 7.0.0 and their guards

Ledger manual transactions with splits (#688), amount changes dated from a date, income end date, recurring annual bonus, promotional APR with deferred interest, sinking-fund target dates, undo, notifications (bell, page, email), change history (#580, #749), active sessions and new-device email (#683), read-only API tokens (#581), settings-only export/import, phone tab bar and More sheet (8.8.0), path routing (#730, #747), year-in-review report, category budget rollover (#687), desktop layout (#363).

Each has an entry in `docs/architecture/features.md` and a named guard (Jest, server test or Playwright file). The server suite has dedicated files for most (`amountChanges`, `apiTokens`, `auditLog`, `sessions`, `notifications*`, `manualSplits`, `sinkingFundTargetDate`, `incomeEndDate`, `debtPromo`).

## Findings

No new functional defects were found by static review. Two **risks** to carry:

- **FUNC-R1: Health, Reports and Forecast can diverge.** CLAUDE.md asks authors to check all three when a data shape changes. There is no cross-page invariant test (for one seeded dataset, "monthly income" is equal wherever it is displayed). F-10 was exactly this class of bug. A single Jest test over the pure cores (`netWorthCore`, `projectionCore`, `computeMonthlyIncomeForMonth`) would convert the convention into a guard. Worth a small issue if the owner wants one.
- **FUNC-R2: manual regression of 8.x UI.** The phone tab bar, More sheet and Back-closes-overlays behaviour were developed with a manual Android Chrome check still pending in the session notes (#736). Confirm it was done before relying on it.

## Recommendation
Run the Playwright suite on `main` (CI does on every PR) and do a 30-minute manual pass of: sign-in on a second device, edit on both, import a backup, mark a recurring bill Cleared in the Ledger, check Health/Reports income agree, and use the phone layout.
