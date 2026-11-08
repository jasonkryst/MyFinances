# MyFinances — Features Audit and Recommendations

**Date**: 2026-11-04 (live checks run 2026-11-08 against the same code)
**Version audited**: 7.0.0 (PostgreSQL-only storage, merged in #458 at `3d156a1`; audited from branch `docs/v7-security-audit`, which only adds docs on top)
**Scope**: Every user-facing feature area, verified end to end on the server-only app; a review of the code behind each area (client module, server route and `columns` map, migration, sanitizer, sync path); ranked recommendations.
**Out of scope**: security, accessibility, i18n, performance and test coverage as audit topics. Each has its own 2026-11-04 report. Issues they filed (#459–#560) are cross-referenced here, not re-filed.
**Method**:
1. Read `CLAUDE.md`, `README.md`, the previous features audit, and the open-issue list (111 open issues).
2. Seeded a realistic two-person household through the real import path (`seed_state` → `replaceForPostgres`): 4 accounts (one retirement account, multi-line notes), 4 debts (split 70/30, one archived), net and variable income, a bonus, 4 recurring templates (subscription, income, transfer), emergency and sinking funds, a transfer, retirement snapshots, a home-purchase plan and category budgets.
3. Drove the live stack at `http://localhost:32901/` with throwaway Playwright scripts. These reused `tests/conftest.py`'s `ensure_session`, `seed_state` and `wait_for_app_ready`. The checks: mutations followed by reloads, every page and sub-tab, downloads, direct API calls, two tabs in one session, a second browser context (as a second device), a blocked API (offline gate), and legacy browser data.
4. Code review of `src/*`, `server/src/crudRouter.js`, `server/src/routes/*`, `server/migrations/*` and `src/sanitizers.js`.

**Tools**: Playwright 1.x (Chromium, headless), the repo's pytest harness helpers, `gh`, ripgrep.

Verified facts are marked **[verified]** (live evidence) or **[code]** (read in source). Recommendations are proposals and are kept in §6.

---

## 1. Summary

The feature set is complete and works on the server-only build. Every page and every Reports and Plan sub-tab rendered with seeded data and no page errors. Every mutation I tried survived a reload, which proves it reached Postgres: account notes, transfers, retirement snapshots, Recurring "mark paid" → Ledger cleared and override, reconciliation with a statement range, category budgets, generic settings and people. The calendar feed (client download and token webcal) produced identical event sets. The v7 gates also work: the legacy-data modal, the unreachable-server gate and the sync-error banner.

The main problem is **concurrency**, which v7 introduced:
- **Lost updates.** Every edit PATCHes the **whole record**, and every record mutation also PATCHes the **whole plan-settings row** (#521). Neither carries a version check.
- **No refresh.** No tab ever re-reads the server.

As a result, a second tab or device that is merely *open* silently reverts edits made elsewhere. I showed this live for a debt rename and for category budgets. Local storage had one writer per browser, so this is a v7 regression in practice.

Smaller functional issues:
- **Reports.** They count recurring **transfer** legs as both income and spending.
- **Merge import.** Re-importing a backup in merge mode duplicates every collection that has no name to dedupe on.
- **Server validation.** The server accepts transfers that the client would reject: same account, negative amount, or no amount.

| Feature status (21 areas) | Count |
|---|---|
| Works | 17 |
| Degraded | 3 (Reports, Import/export, i18n switch) |
| Broken | 1 (multi-tab / multi-device editing) |

| New findings by severity | Count |
|---|---|
| High | 2 |
| Medium | 4 |
| Low | 6 |

**Top 5 findings**
1. **F-01 (High)**: a stale tab or device's full-record PATCH silently reverts another device's edit. Shown live with a debt rename.
2. **F-02 (High)**: any save from a stale tab overwrites the whole plan-settings row. That wipes category budgets, the home-purchase plan, the retirement target and the strategy set elsewhere.
3. **F-04 (Medium)**: recurring transfer templates are counted as income *and* spending in Reports. A $300 savings sweep added $300 to Reports income ($7,879.73, against $7,536 on Health) and showed up as "Savings $300" spending.
4. **F-05 (Medium)**: a merge import of your own backup duplicates expenses, emergency funds, transfers, retirement snapshots, reconciliations and plan history. Only debt duplicates are reported.
5. **F-03 (Medium)**: no tab or device ever refreshes. A record deleted elsewhere stays visible, and editing it shows "check your connection".

---

## 2. Feature matrix

Status is for the server-only app. "Persists" means the change was still there after a reload, i.e. it came back from `loadFromPostgres`.

| # | Area | Status | Persists | Backing modules (client / server) | Tests | Related issues |
|---|---|---|---|---|---|---|
| 1 | Health | Works | n/a (derived) | `health.js`, `settings.js` (FIRE) / none | `test_health*.py`, `test_number_clarity.py` | #504, F-10 |
| 2 | Accounts (notes, transfers, retirement) | Works | ✅ notes `Line one\nLine two`, transfer memo, snapshot | `accounts.js`, `transfers.js`, `retirement.js`, `retirementCalculator.js` / `routes/accounts.js`, `transfers.js`, `retirementSnapshots.js` | `test_accounts.py`, `test_transfers.py`, `test_retirement*.py` | F-06, F-08 |
| 3 | Income / bonuses (gross vs net) | Works | ✅ `withholdingPercent` 22, `isVariable` round-trip | `income.js`, `utils.js` / `incomes.js`, `bonuses.js` | `test_income.py` | — |
| 4 | Liabilities: debts (split, archive, bulk) | Works | ✅ split `{a:0.7,b:0.3}` remapped to new person ids | `debts.js`, `debtOwnership.js` / `debts.js` (`ownership_split jsonb`) | `test_debts.py`, `test_debt_ownership_split.py` | F-01 |
| 5 | Liabilities: budget (category budgets) | Works | ✅ `Transportation: fixed 250` | `categoryBudgets.js`, `bills.js` / `planSettings.js` | `test_category_budgets.py` | F-02 |
| 6 | Recurring (income type, paid ↔ Ledger) | Works | ✅ `paidMonths ["2026-11"]`, cleared key and `-1875` override | `recurring.js`, `recurringPaid.js` / `recurringTemplates.js`, `ledgerCleared.js`, `ledgerOverrides.js` | `test_recurring*.py` | #463 |
| 7 | Savings: emergency, sinking, home purchase | Works | ✅ (seed round-trip, all fields) | `savings.js`, `homePurchase.js` / `emergencyFunds.js`, `sinkingFunds.js`, `planSettings.js` | `test_savings.py`, `test_home_purchase.py` | #546 |
| 8 | Plan / Strategy (strategies, refinance, calendar, comparison) | Works | ✅ strategy and payment restored, plan-history row created | `strategy*.js`, `debtCalculator.js` / `planSettings.js`, `planHistory.js` | `test_strategy.py`, `test_refinance_scenario.py`, `test_plan_history.py` | #543 |
| 9 | Reports (8 sub-tabs) | **Degraded** | n/a | `reports*.js`, `spending.js`, `forecast.js` | `test_reports.py`, `test_money_flow_sankey.py`, `test_networth.py` | F-04, F-10, F-11, F-12, #518 |
| 10 | Ledger (overrides, cleared, filters, CSV) | Works | ✅ override and cleared; filters partly device-local | `ledger*.js`, `dataExport.js` / `ledgerOverrides.js`, `ledgerCleared.js`, `planSettings.js` | `test_ledger*.py` | F-09, #477, #463 |
| 11 | Reconcile | Works | ✅ `2026-10-01..31`, 4321.09 | `reconciliation.js` / `reconciliations.js` | `test_reconciliation*.py` | F-06 |
| 12 | People | Works | ✅ | `people.js` / `persons.js` | `test_people.py` | #97 |
| 13 | Import / export (JSON replace/merge, CSV, settings backup) | **Degraded** | replace ✅ but orphans keys; merge duplicates | `dataExport.js`, `postgresImport.js`, `settingsBackup.js` | `test_data_export.py`, `tests/postgres/test_postgres_import.py` | #520 (confirmed), #519, #478, F-05 |
| 14 | Settings (5 tabs) | Works | ✅ `fireMultiplier` 30 | `setupWizard.js`, `settings.js` / `settings.js` route | `test_settings.py` | F-07 |
| 15 | Security (change password) | Works | n/a | `securitySettings.js`, `passwordUi.js` / `auth.js` | `tests/ui/test_password_security.py` | — |
| 16 | Calendar feed (.ics + webcal token) | Works | ✅ token stable | `calendarFeed.js` / `calendar.js`, `calendarGenerator.js` | `test_calendar_feed.py`, `tests/postgres/test_calendar_*` | #526, #516, #479 |
| 17 | Email test | Works (SMTP unset → clean 503) | n/a | `setupWizard.js` / `notifications.js`, `email/` | `tests/postgres/test_postgres_notifications.py` | #211 |
| 18 | PWA install / offline gate | Works | n/a | `serviceWorker.js`, `sw.js` | `test_pwa.py` | #344, #524 |
| 19 | Command palette and shortcuts | Works | n/a | `commandPalette.js`, `keyboardShortcuts.js` | `tests/ui/test_command_palette.py`, `test_keyboard_shortcuts.py` | #505 |
| 20 | i18n switch | **Degraded** | device only | `i18n.js` | `test_i18n*.py` | #510, #497, #504, #505 |
| 21 | v7 gates, sync banner, legacy flow | Works | n/a | `loginGate.js`, `pgMigrationModal.js`, `postgresSync.js` | `test_server_only_storage.py`, `test_sync_error_banner.py`, `tests/postgres/test_legacy_local_data.py` | #459, #460, #464 |
| — | Multi-tab / multi-device editing (cross-cutting) | **Broken** | — | `postgresSync.js`, `storage.js`, `crudRouter.js` | none | F-01, F-02, F-03, #98 |

### Evidence per area

- **Health.** The page renders 4,207 characters of content with no errors. Cash-flow income for November: $7,536, made of net salary and freelance $6,636 plus the $900 recurring income inflow.
- **Accounts.**
  - Created "Brokerage" through the real `#accountForm` with a two-line note; it survived a reload.
  - `app.addTransfer` with memo "probe transfer" survived a reload.
  - A retirement snapshot survived a reload. The seeded snapshots' `annualSalary: null` came back as `0` (F-08).
- **Income.** In the seed round-trip, every income field compared equal: `withholdingPercent`, `isVariable`, category and frequency.
- **Debts.** The 70/30 `ownershipSplit` came back keyed by the new server person ids, which shows the remap works. The bulk and archive paths are covered by tests. I triggered `archiveDebt` only as far as its confirm modal.
- **Category budgets.** `setCategoryBudget(app,'Transportation','fixed','250')` survived a reload.
- **Recurring.**
  - `markRecurringPaid(rent, '2026-11', false, 1875)` wrote the cleared key `recurring|<id>|<acct>|2026-11-01` and an override of −1875 with its memo.
  - After a reload, `paidMonths` was `["2026-11"]`, with one cleared key and one override.
- **Savings.** All three sub-tabs render without errors, and every seeded field round-tripped.
- **Plan.**
  - Overview, Debt Summary and Schedule (6 charts) render. The refinance `<details>` lists the 3 active debts.
  - The plan CSV download has 44 lines.
  - Computing a plan created a `planHistory` row.
- **Reports.** All 8 sub-tabs render with no errors. Charts come with their `.sr-only` tables. Net Worth showed "No net worth snapshots yet" despite a full dataset (F-12). Income vs Expenses and Summary show **Income $7,879.73** and a perpetual **Bills $0.00** row (F-04, F-10, F-11).
- **Ledger.**
  - The ledger CSV download (`ledger-export-2026-11-08.csv`, 14 lines) has an English header row, as intended.
  - A debt row's *Category* column shows the debt's name ("Visa Card Debt"), not its category. This is minor and not filed.
- **Reconcile.** `applyReconciliation(acct, 4321.09, …, {statementStartDate:'2026-10-01', statementEndDate:'2026-10-31'})` survived a reload.
- **People.** Adding "Jordan" through `#personName` survived a reload.
- **Import/export.**
  - The JSON export (version `7.0.0`, 29 keys) re-imported in replace mode without errors.
  - **#520 confirmed:** after the replace, `ledgerClearedTransactions` still held the *old* template id's key, alongside a new key that `reconcileRecurringPaidState` re-derived. The $1,900 override stayed on the orphaned old key.
  - The merge re-import of the same file duplicated records (F-05).
  - The settings-only export returns `{type, app, version, exportedAt, preferences, settings}`.
- **Settings.** The tabs are appearance, data, notifications, advanced and security. Each renders its controls.
- **Security.** `POST /auth/change-password` with a wrong current password returns `400 INVALID_CURRENT_PASSWORD`. I did not change the real password.
- **Calendar.**
  - `generateIcs(app)` produced 224 VEVENTs.
  - `GET /api/calendar/token` → 200; `POST` rotates the token; `GET /calendar.ics?token=…` → 200, `text/calendar`, 224 events with the same summaries; a bad token → 401.
- **Email.** `POST /api/notifications/test-email` → `503 EMAIL_NOT_CONFIGURED`, as designed when `SMTP_HOST` is unset.
- **PWA.** `manifest.json` 200, `sw.js` 200 with `CACHE_NAME = 'myfinances-v7.0.0'`. With every `/api/**` request aborted, `#serverUnreachableGate` shows "Can't reach your server … Try again".
- **Palette.** Ctrl+K opens it; typing "ledger" and pressing Enter navigates to `ledger`. The shortcuts modal has 7 rows.
- **i18n.**
  - `setLocale('es')` survives a reload on the same device ("Salud"), but `<html lang>` stays `en` (#497).
  - A second browser context, i.e. a second device, comes up in English ("Health"), and the theme isn't carried either (#510).
- **Legacy flow.** With `debtTrackerData` in `localStorage` and data already on the server, `#pgMigrationModal` shows "Old Browser Data Found … your server already has data, so it will not be imported".
- **Multi-tab.** Covered in F-01 to F-03.

---

## 3. Findings

| # | Issue | Area | Evidence | Severity | Recommendation |
|---|---|---|---|---|---|
| F-01 | A stale tab/device's full-record PATCH silently reverts edits made elsewhere | Sync (all record types) | **[verified]** Tab A renamed "Car Loan" (PATCH ok). Tab B, opened earlier, changed only the balance and sent its full stale object. Server afterwards: `name: "Car Loan"`, `accountBalance: 14000`, so A's rename was lost. **[code]** 30+ call sites send whole objects, e.g. `debts.js:338,388,933,1117`, `income.js:343`, `recurring.js:828`, `savings.js:541,741`. `crudRouter.js` PATCH merges `{...existing, ...body}`, so every field in the body wins, and there is no version column or check. | High | Send only changed fields: diff against a snapshot taken when the edit started. Add optimistic concurrency, an `updated_at timestamptz` row version plus `If-Unmodified-Since`/`version` → 409, with a "changed on another device — reload" prompt. See REC-04. |
| F-02 | Any save from a stale tab overwrites the whole plan-settings row | Budgets, Home purchase, Retirement target, Plan | **[verified]** Tab A added category budget "Utilities" (server: Food, Housing, Utilities). Stale tab B ran `saveToStorage()`. Server afterwards: Food, Housing; Utilities is gone. **[code]** `storage.js:154-172` always sends every plan-settings field, and reads `monthlyPayment`/`strategy` from the DOM. The server already supports partial PATCH (`planSettings.js:52-86` skips `undefined` fields). #521 makes every record mutation trigger this. | High | Have `saveToStorage(app, fields)` send only the fields that changed. With #521 fixed, stop calling it from record mutations. |
| F-03 | No tab or device ever refreshes; edits against a record deleted elsewhere show a misleading error | Sync | **[verified]** Tab B did not see a person created in tab A, even after a `visibilitychange`. Editing a template that tab A had deleted gave a 404, and B showed "Couldn't save your last change — check your connection" while still listing the record. **[code]** `src/` has no `visibilitychange`, `BroadcastChannel`, `storage` event or polling; data loads once, in `init()`. | Medium | Re-load on focus when the data is older than N minutes, and use `BroadcastChannel` between tabs. Map 404 on PATCH/DELETE to "This item was changed or deleted elsewhere — reload". See REC-01. |
| F-04 | Recurring transfer templates are counted as income and as spending in Reports | Reports (Summary, Income vs Expenses, Money Flow, Variance, Spending) | **[verified]** A $300 "Savings sweep" transfer template produced ledger rows `+300` and `−300`, both `type:'recurring'`. Reports income was **$7,879.73** against Health's $7,536; the Sankey showed "Savings sweep" as an income source; Spending listed "Savings $300". **[code]** The `tx.type === 'recurring'` and `amount >= 0` → income branches are in `reportsSummary.js:27-28`, `reportsCashFlow.js:37-41`, `reportsMoneyFlowSankey.js:13,40`, `reportsVariance.js:16-18` and `spending.js:25`. Health excludes transfers (`computeRecurringCashFlowForMonth`). One-off `type:'transfer'` rows are already excluded everywhere. | Medium | Mark recurring transfer legs (`isTransferLeg`, set in `ledgerTransactions.js` from `template.type === 'transfer'`) and skip them in every cash-flow aggregator. Add a shared `isCashFlowTx(tx)` helper. |
| F-05 | A merge import of a backup duplicates collections that have no name dedupe | Import | **[verified]** I merge-imported the export the app had just produced. Afterwards: expenses 2→4, emergency funds 1→2, transfers 1→2, retirement snapshots 2→4. Accounts, debts and recurring items were not duplicated. The UI reports only "skipped N debts". **[code]** `postgresImport.js:24-27` `MERGE_DEDUP_BY_NAME` covers debts, incomes, bonuses, bills, recurringTemplates and sinkingFunds. It leaves out expenses (which are named) and every unnamed collection. This is not #478, which is about repeats within one file. | Medium | Dedupe each collection by a natural key: expenses by name+date; EF by accountId; transfers by from+to+amount+date; snapshots by accountId+date; reconciliations by accountId+statementEndDate; plan history by createdAt. Report skips for every type. |
| F-06 | The server accepts invalid transfers and reconciliations that the client rejects | Accounts/Transfers, Reconcile | **[verified]** `POST /api/transfers` returned **201** for `from == to`, for `amount: -50`, and for no amount (stored `null`). `POST /api/reconciliations` without `statementBalance` → 201 with `null`. **[code]** The rejection lives only in `sanitizeParsedState`'s keepFn (`sanitizers.js`). `crudRouter` only checks `requiredFields`, and the `transfers` table has no CHECK. CLAUDE.md promises server-side validation through the shared sanitizers. | Medium | Export the keep predicates as `validateTransfer`/`validateReconciliation` and add a `validate` hook to `createCrudResource`. Add `CHECK (amount > 0 AND from_account_id <> to_account_id)` in a new idempotent migration. |
| F-07 | Other server validation gaps: arbitrary settings keys, $0 or targetless recurring templates | Settings, Recurring | **[verified]** `PUT /api/settings/totallyUnknownKey` with a 5,000-character value → 200. `POST /api/recurring-templates` with `type:'transfer'` and no `targetAccountId` → 201, and `amount:0` → 201, regardless of `zeroAmountPolicy`. | Low | Validate settings against the existing `SETTINGS_EXPORT_SCHEMA` (`settings.js`) on the server, and cap value size. Require `targetAccountId` for transfer templates. Leave `zeroAmountPolicy` as client-only UX, but document that. |
| F-08 | `sanitizeFiniteNumber(null, null)` returns 0, so nullable numbers become 0 | Retirement (pension) | **[verified]** Seeded snapshots with `annualSalary: null` came back as `0`. **[code]** `utils.js:54-60`: `Number(null) === 0`. `retirement.js:88,207` then uses `latest.annualSalary` (0) in place of the account's `pensionAnnualSalary` fallback. `creditLimit` avoids this only through a `!= null` guard. | Low | In `sanitizeFiniteNumber`, return `fallback` for `null`/`''`. Audit callers whose fallback is non-null (behaviour unchanged there). Add a Jest case. |
| F-09 | Ledger filters live in two places with different fields; the device copy wins | Ledger | **[code]** The server keeps `ledgerSettings` (account, date range, sort, cleared). `localStorage.debtTrackerLedgerFilters` keeps account, date range, cleared, **category and pageSize**. `ledger.js:180-189` lets localStorage override the server value on first render. A second device therefore gets the server's account/date, while category and pageSize never sync. | Low | Choose one: either sync everything through `ledgerSettings`, adding category and pageSize, or treat filters as device state and drop them from the server. |
| F-10 | "Monthly income" has no single definition across Health and Reports | Health, Reports | **[verified]** For the same month: Health cash-flow income $7,536 (net income + recurring inflows). Reports income $7,879.73 = $7,536 + $300 transfer leg (F-04) + **$43.73 accrued interest**. **[code]** Health uses `computeMonthlyIncomeForMonth` + `computeRecurringCashFlowForMonth`; Reports sums ledger rows. | Low | Once F-04 is fixed, label the Reports figure as including interest, or add `computeMonthlyCashFlow(app,y,m)` in `utils.js` and have both pages call it. |
| F-11 | Reports show a perpetual "Bills $0.00" line although bills can't be created | Reports | **[verified]** Income vs Expenses and Summary both render "BILLS $0.00". **[code]** The Bills UI was removed in favour of Recurring (CLAUDE.md). | Low | Hide the Bills row when `app.bills` is empty, keeping it for legacy data. |
| F-12 | The Net Worth report is empty for a fully populated account until the user captures a snapshot | Reports → Net Worth | **[verified]** With 4 accounts and 4 debts seeded, the panel shows "No net worth snapshots yet", with no trend and no projection. **[code]** `AUTO_NW_SNAPSHOT` defaults to `false` and runs only when the app is opened (`app.js:278`). `balanceHistory` already holds dated per-account and per-debt balances that could back-fill the trend. | Low | Default auto-snapshot to on, and show the projection from the live figure even with no history. Longer term, see REC-05 and REC-12. |

**Known issues confirmed live (not re-filed):**
- **#520.** Replace import kept the old template-id cleared/override keys.
- **#521.** Amplifies F-02.
- **#510 and #497.** Locale is device-only, and `<html lang>` stays `en`.
- **#463.** Override `updatedAt` truncation, seen in the code path.
- **#526.** Both ICS generators match today (224 = 224), but the logic is still duplicated.
- **#211.** Email has no trigger besides the test button.

---

## 4. Backing-code review

### 4.1 Data flow

1. **Write.** In-memory mutation → `pgPost` (awaited, to swap in the server id), or `pgPatch`/`pgDelete`/`pgPut` (fire-and-forget) → `crudRouter`/`keyedRouter` → the same `sanitize*` runs server-side → Postgres.
2. **Read.** `loadFromPostgres` reads about 20 endpoints once, at boot.

The pipeline is clean and generic: adding a resource means one entry in each of `ALL_RESOURCE_PATHS`, `POSTGRES_RESOURCE_ENDPOINTS` and `CRUD_RESOURCES`. `test/fieldParity.test.js` guards column↔sanitizer drift, and migration 031 closed the gaps it found. My seed round-trip compared every sanitized field and found no other drift beyond F-08 and `paidAmounts`. `paidAmounts` is intentionally not persisted (#434).

The weak point is the **write semantics**, not the plumbing:
- **Whole-object PATCH** with merge-then-overwrite and no version (F-01).
- **Whole-row plan-settings PATCH** (F-02), triggered by unrelated mutations (#521).
- **Fire-and-forget writes** with optimistic in-memory state and no rollback (#459, #460).
- **One read at boot**, with no invalidation (F-03).

Together these make "the server is the source of truth" true only for a single tab. The schema has `created_at` on a few tables, and `updated_at` only as a *calendar date* on debts and incomes. That date is a display field and cannot serve as a version.

### 4.2 Per-area notes

- **Accounts, transfers, retirement.**
  - Account FKs use `ON DELETE SET NULL` throughout. A transfer whose account is deleted keeps a `NULL` leg on the server. The client drops it only on *import*, not on load. Low risk: the UI hides it, but it stays in the DB forever.
  - Server-side validation gaps: F-06.
  - Retirement maths is pure and Stryker-scoped, which is good.
- **Debts and ownership.** `ownership_split jsonb` is re-sanitized against `personIds` on every write. The remap on import is correct (verified). `remapDebtPersonRefs` has no production caller (#471).
- **Income.** Gross is stored and net derived in one place (`computeMonthlyIncomeForMonth`). This is consistent.
- **Recurring ↔ Ledger.**
  - The keys `recurring|id|acct|date` tie paid state to template ids. Every id change — replace import (#520), and per CLAUDE.md a template date or account edit — orphans the keys.
  - Keys are stored as free text, with no FK. There is no server-side cleanup when a template is deleted, so orphaned keys accumulate in `ledger_cleared_transactions`/`ledger_amount_overrides`.
  - Recommendation: delete matching keys in the template DELETE handler (prefix match `recurring|<id>|`), and remap them on import (#520).
- **Reports, Health, Forecast.**
  - Five aggregators each re-implement "classify a ledger row into income/outflow/category" (`reportsSummary`, `reportsCashFlow`, `reportsMoneyFlowSankey`, `reportsVariance`, `spending`). Health uses a sixth, non-ledger path. F-04 is the predictable result.
  - A single `classifyCashFlow(tx)` in `ledgerTransactions.js` would remove this class of bug.
  - The two balance paths flagged in 2026-09 (`computeAccountBalance` vs `getAccountForecastSeries`) are still separate. #518 tracks their cost.
- **Import/export.**
  - Replace and merge go through about 20 per-record requests (#519, #529). Rollback is best-effort.
  - Merge dedupe is partial (F-05). Keyed resources are not remapped (#520).
  - A transactional bulk endpoint (#529) would fix all three at once and is the single most leveraged server change.
- **Settings.** There is a generic key/value table with no server-side schema (F-07). `SETTINGS_EXPORT_SCHEMA` already exists client-side and could be shared exactly like the sanitizers.
- **Device-only state** that arguably should follow the user:
  - Locale and currency (#510).
  - Theme.
  - Ledger category filter and page size (F-09).
  - Ledger column choice (`LEDGER_COLS_LS_KEY`).
  - In-progress reconciliation (`debtTrackerReconInProgress`). Losing a half-done reconciliation when you switch devices is the one with real user cost.

  What's-New-seen can stay device-local.
- **Calendar feed.** The token is stored per user and rotated by POST; bad tokens get 401. The logic is duplicated client and server (#526), English-only (#516).
- **Email.** The transport, templates and a test route exist, but there is no scheduler and no triggers (#211).
- **Single-user limit.** `/auth/register` 409s once a user exists. `persons` are labels, not principals, so a couple sharing one login is the supported household model (#97). With one shared login, F-01 to F-03 apply to two *people*, not just two tabs. That makes concurrency the more urgent prerequisite before any real multi-user work.

---

## 5. Status of findings from the 2026-09-02 features audit

| 2026-09-02 finding | Status 2026-11-04 |
|---|---|
| [High] `clearedAt` truncated by `sanitizeDateISO` | **Fixed** 2026-09-02 (`sanitizeTimestampISO`) |
| [Medium] `ledgerAmountOverrides.updatedAt` truncated (client and server) | **Partly open.** Still truncated on the server: tracked as #463 |
| [Low] Dead exports (`renderBillList`, `getLocalePreference`, …) | **Fixed** 2026-09-04 |
| [Low] Strategy calendar ignores expense/bonus helpers | **Fixed** 2026-09-04 (wired in) |
| [Low/Doc] CLAUDE.md silent on the removed Bills UI | **Fixed** 2026-09-03. The UI echo remains as F-11 |
| Watch item: two balance-computation paths | **Still open.** Not diverged, but costly (#518) |
| Responsive tables compliant | **Still compliant**, now guarded by `test_mobile_no_card_clipping.py` |

---

## 6. Recommendations (proposals)

Impact: H/M/L. Effort: S (≤1 day), M (a few days), L (a week or more, needs a spec). Fixes that belong to a finding are in §3 and are not repeated here.

### 6a. Quick wins

| ID | Recommendation | Problem → benefit | Approach | Impact / Effort / Risk | Depends on |
|---|---|---|---|---|---|
| REC-01 | **Refresh on focus and across tabs** | F-03: stale views and edits to deleted records → every tab converges without a manual reload | `BroadcastChannel('myfinances')` posts `{resource}` after each successful `pgFetch` write. Other tabs re-fetch that endpoint. On `visibilitychange` → visible, if more than 5 minutes have passed, re-run `loadFromPostgres` and `refreshCurrentPageData()`. Skip while a form is dirty (#459). | H / S–M / Low | none; pairs with REC-04 |
| REC-02 | **"Saving… / All changes saved" indicator** | Writes are fire-and-forget, so users can't tell whether an edit reached the server before closing the tab → trust | A counter of in-flight requests in `pgFetch` drives a small toolbar chip with `aria-live=polite`. Warn on `beforeunload` while the counter is above 0. | M / S / Low | none |
| REC-03 | **Undo for deletes** | Deleting a debt or template is permanent and cascades nothing back → recovery from mis-clicks | Keep the deleted record (and its ledger keys) for 10 s and show an "Undo" toast. Undo re-POSTs it and remaps keys to the new id. Use the same toast for archive. | M / S–M / Low | REC-07 makes it robust |
| REC-04 | **Optimistic concurrency** | F-01: silent lost updates → a conflict is shown, never swallowed | Migration: add `row_version integer NOT NULL DEFAULT 0` to the CRUD tables. `crudRouter` PATCH requires `version` and returns 409 with the current row on mismatch; the client prompts reload or overwrite. Start with diff-only PATCH bodies, which already remove most conflicts. | H / M / Medium (touches every edit path) | Refines #98 for the online case |

### 6b. Strategic (enabled by the server)

| ID | Recommendation | Problem → benefit | Approach | Impact / Effort / Risk | Depends on |
|---|---|---|---|---|---|
| REC-05 | **Server job runner** | Nothing happens unless the app is open: no net-worth snapshots (F-12), no reminders → a foundation for #211 | One in-process scheduler (`node-cron`, or `setInterval` with a `job_runs` table as a lock), wired in `server/src/index.js`, opt-in through an env var. First jobs: a monthly net-worth snapshot (needs a server-side balance calculation; start with account starting balance + `balanceHistory` latest) and session pruning (#536). Notification triggers (#211) then plug in, calling the existing `sendTemplatedEmail()`. | H / M / Medium | Shared calc module (#526) for anything forecast-based |
| REC-06 | **Bulk transactional import** | #519/#520/F-05: slow, non-atomic, orphaning imports → one request, all or nothing | Already tracked as **#529**; listed for ordering only. Do F-05's natural-key dedupe and the #520 key remap inside the same transaction. | H / M / Medium | — |
| REC-07 | **Change log (audit trail)** | No history of who changed what or when, no undo across sessions, and conflicts are hard to diagnose → "what changed" and restore | An `audit_log(user_id, table, row_id, op, before jsonb, after jsonb, at)` row written by `crudRouter`/`keyedRouter` in the same statement (CTE). Prune after 90 days through REC-05. Later: a "Recently deleted" view in Settings → Data. | M / M / Low | REC-05 for pruning |
| REC-08 | **Personal API tokens (read-only first)** | Webcal is the only non-browser access. Scripts and home dashboards scrape or can't integrate → safe automation | Generalise the calendar token: `api_tokens(user_id, hash, scope, last_used_at)`, `Authorization: Bearer`, read-only GET scope, managed in Settings → Security. YAGNI: build it only when someone asks. | L / M / Medium (auth surface) | — |
| REC-09 | **Off-host backups and a restore drill** | `docker-compose.yml`'s `backup` service writes nightly `pg_dump`s to a volume on the same host, with 7-day retention → survive disk or host loss | Document copying `backup-data` off-host (rclone/restic hook in `docker-backup.sh`), add a monthly restore test script, and show "last backup" (from the file's mtime) in Settings → Data. | M / S / Low | — |
| REC-10 | **Encryption at rest: document, don't build** | Self-hosters ask, and app-level column encryption would break server-side calculations and search | A `server/README.md` section: use LUKS/BitLocker or provider volume encryption for the Postgres and backup volumes; encrypt off-host backups (restic does). No code. | L / S / Low | REC-09 |

Tracked elsewhere, not re-proposed:
- **#97**: multi-user and household support.
- **#269 / #260**: bank CSV import.
- **#510**: locale and currency sync.
- **#526**: shared calendar and calculation module.
- **#211**: notifications.

### 6c. UX and product gaps

| ID | Recommendation | Problem → benefit | Approach | Impact / Effort / Risk | Depends on |
|---|---|---|---|---|---|
| REC-11 | **Manual one-off transactions in the Ledger** | The Ledger only *projects*. An unplanned purchase or refund can only be recorded by overriding a projected row or creating a dated "expense budget" → actuals tracking, the core expectation of a finance app | A `transactions` collection (`accountId, date, amount, name, category, memo`), with the CRUD recipe and migration. `buildProjectedAccountTransactions` emits `type:'manual'`. Cleared by default. Bank import (#269) later writes into the same table. | H / M / Low | — |
| REC-12 | **Back-fill the Net Worth trend from balance history** | F-12: an empty Net Worth report until snapshots accumulate | Derive monthly points from `balanceHistory` (dated balances for accounts and debts) when no snapshot exists for that month. Draw them dashed or labelled "estimated". | M / S–M / Low | — |
| REC-13 | **Ledger free-text search** | Finding "that Amazon refund" means paging through filters | A search box that filters `getFilteredSortedLedgerTransactions` on name, category and memo. Store it with the other filters (resolve F-09 first). | M / S / Low | F-09 |
| REC-14 | **Sync in-progress reconciliation and ledger column choices** | Starting a reconciliation on a laptop and finishing on a phone loses the work | Move `debtTrackerReconInProgress` and the ledger column choice into generic `settings` keys. Keep theme and What's-New-seen device-local. | L–M / S / Low | — |

Already tracked, so not re-proposed: #290 (recurring annual bonus), #165 (weekend bill shift), #307 (emergency-fund history chart), #312 (plan comparison), #318 (reconciliation export), #362 (dashboard layout).

---

## 7. Suggested roadmap order

1. **F-02 and #521**, then **F-01** using diff-only PATCH bodies (S each). These stop the silent data loss now that the server is shared.
2. **REC-01** refresh on focus and across tabs, plus F-03's 404 wording (S–M).
3. **F-04** with a shared `classifyCashFlow`, plus F-10 and F-11 (S). Reports become trustworthy.
4. **F-06/F-07** server validation parity, plus the CHECK migration (S). Number it above the newest migration at merge time.
5. **REC-06/#529** bulk import, folding in **F-05** and **#520** (M).
6. **REC-04** row-version concurrency (M). It is the prerequisite for any multi-user work (#97).
7. **REC-05** job runner, then #211 notifications and the monthly net-worth snapshot (M). Include **REC-12** in the same release.
8. **REC-11** manual transactions (M). Then #269 bank import on top of it.
9. Polish: REC-02, REC-03, REC-13, REC-14, F-08, F-09, REC-09/10. REC-07 and REC-08 only on demand.
