# Effective-Dated Amounts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Income and recurring-template amount edits apply from a date onward, leaving earlier months unchanged (#678).

**Architecture:** A pure leaf module `src/amountSchedule.js` holds the one "amount on a date" rule plus the edit operation and sanitizer. Records keep their base `amount` and gain an `amountChanges` jsonb list. Every per-occurrence read uses the occurrence date; card displays use today.

**Tech Stack:** Vanilla ES modules, Node/Express + PostgreSQL (node-pg-migrate), Jest + Stryker, node:test, Playwright/pytest.

**Spec:** `docs/superpowers/specs/2026-11-22-effective-dated-amounts-design.md`

## Global Constraints

- Branch `feat/effective-dated-amounts-678`. Never push to `main`; open a draft PR.
- `src/amountSchedule.js` imports nothing; all exports are hoisted `function` declarations.
- Dates are local `YYYY-MM-DD` strings; convert a `Date` with `dateToISO` (`src/utils.js`), never `toISOString()`.
- `amountChanges` is `[]` when empty, sorted ascending by `from`, unique `from`, at most 120 entries.
- Change amounts: finite, `>= 0`, `<= 1e9`. A recurring `transfer` template needs every change amount `> 0`.
- New migration number above `1755600000043` (check `main` at merge time), idempotent, with a `MIGRATION SAFETY NOTE`.
- Every new UI string goes in `src/locales/en.js`, `es.js` and `pl.js` with real translations; no inline styles (CSP); `escapeHtml` on rendered values.
- A new `tests/features/` or `tests/ui/` file must be added to a shard in `.github/workflows/ci.yml`.
- Jest runs locally in Docker per the memory recipe: `npm run test:unit -- <path>`.

## Review Focus

- An occurrence dated exactly on a change's `from` date uses the **new** amount (the day before uses the old one). Task 1 pins it.
- A weekly template whose month straddles a change sums each occurrence at its own amount, not `count × one amount`. Task 3 pins it.
- Income with withholding applies the percent to the **dated** gross amount. Task 3 pins it.
- Recurring Mark-as-paid: entering the amount in effect on that occurrence removes the override, while entering the base amount on a post-change occurrence keeps one. Task 3 pins it.
- A transfer template PATCH adding a $0 change gets a 400, while an unrelated PATCH of the same record passes. Task 2 pins it.

---

### Task 1: Pure `amountSchedule.js` module

**Files:**
- Create: `src/amountSchedule.js`
- Create: `tests/unit/amountSchedule.test.js`
- Modify: `tools/strykerScope.mjs` (`MUTATE_SCOPE`), `tools/mutationFloors.json` (placeholder floor; re-derive from the CI report later)

**Interfaces:**
- Produces:
  - `getAmountOn(record, isoDate: string): number`, the amount of the latest change with `from <= isoDate`, else `Number(record.amount) || 0`. Tolerates a missing or unsorted `amountChanges`.
  - `sanitizeAmountChanges(raw, { min = 0, max = 1e9 } = {}): Array<{from: string, amount: number}>`
  - `applyAmountChange(record, newAmount: number, from: string | 'all', firstOccurrenceIso: string | null): { amount: number, amountChanges: Array }`
  - `getCurrentAmount(record, todayIso: string): number`, an alias for `getAmountOn`.
  - `getAmountChangeSummary(record, todayIso: string): { current: number, previous: number | null, previousUntil: string | null, upcoming: {from, amount} | null, changes: Array<{from, amount, isFuture: boolean}> }`. Here `changes` is newest first, and `previousUntil` is the day before the latest change on or before today.

- [ ] **Step 1: Write failing tests** in `tests/unit/amountSchedule.test.js`:
  - `getAmountOn({amount: 15, amountChanges: [{from:'2027-01-01', amount: 18}]}, '2026-12-31') === 15`, `'2027-01-01'` gives `18`, `'2027-06-01'` gives `18`.
  - Several changes: `[{from:'2027-01-01',amount:18},{from:'2027-07-01',amount:20}]` gives `15`, `18`, `20` at `'2026-06-01'`, `'2027-03-01'`, `'2027-07-01'`.
  - Unsorted input gives the same results; a missing `amountChanges` returns `amount`.
  - `sanitizeAmountChanges`: drops `{from:'bad'}`, a `NaN` amount, a negative amount and `amount > 1e9`; duplicate `from` keeps the last one; output is sorted; 130 valid entries are capped to 120 (keep the 120 latest); a non-array gives `[]`; `{min: 0.01}` drops a 0 amount.
  - `applyAmountChange(rec, 20, 'all', null)` gives `{ amount: 20, amountChanges: [] }`, even when `rec` had changes.
  - `applyAmountChange(rec, 20, '2026-01-01', '2026-03-01')` (from before the first occurrence) behaves like `'all'`.
  - Adding `'2027-01-01'`→18 to `{amount:15, amountChanges:[]}` gives `[{from:'2027-01-01',amount:18}]`; repeating with 19 replaces it with `[{…,amount:19}]`.
  - No-op collapse: from `{amount:15, amountChanges:[{from:'2027-01-01',amount:18}]}`, applying `'2027-06-01'`→18 leaves `amountChanges` unchanged; applying `'2027-01-01'`→15 removes the entry.
  - `getAmountChangeSummary` with one past and one future change, today `'2027-03-01'`: `current: 18`, `previous: 15`, `previousUntil: '2026-12-31'`, `upcoming.from: '2027-07-01'`, and `changes[0].isFuture === true`.
- [ ] **Step 2: Run** `npm run test:unit -- tests/unit/amountSchedule.test.js`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement** the five exports. `previousUntil` is computed with local `Date` arithmetic (day before `from`) and formatted `YYYY-MM-DD` inline, since the module can't import `utils.js`.
- [ ] **Step 4: Run** the test. Expected: PASS. Then add `'src/amountSchedule.js': ['getAmountOn','sanitizeAmountChanges','applyAmountChange','getCurrentAmount','getAmountChangeSummary']` to `MUTATE_SCOPE`, and run `npm run test:unit -- tests/unit/strykerScope.test.js tests/unit/mutationFloors.test.js`. Expected: PASS. Give the file a floor of 0 in `tools/mutationFloors.json` with a note to re-derive it from CI.
- [ ] **Step 5: Commit** `feat(amounts): pure amount schedule helper (#678)`.

### Task 2: Persist `amountChanges` (sanitizers, validity, migration, routes)

**Files:**
- Modify: `src/sanitizers.js` (`sanitizeIncome`, `sanitizeRecurringTemplate`, `isValidRecurringTemplate`)
- Create: `server/migrations/1755600000044_add-amount-changes.js`
- Modify: `server/src/routes/incomes.js`, `server/src/routes/recurringTemplates.js` (`columns`; add `'amountChanges'` to the `validatedSanitizer` field list)
- Test: `tests/unit/sanitizers.test.js`, `tests/unit/serverValidity.test.js`, new `server/test/amountChanges.test.js`

**Interfaces:**
- Consumes: `sanitizeAmountChanges` (Task 1).
- Produces: income and recurring records always carry `amountChanges: Array<{from, amount}>`. The DB columns `incomes.amount_changes` and `recurring_templates.amount_changes` are `jsonb NOT NULL DEFAULT '[]'`.

- [ ] **Step 1: Write failing tests.**
  - Jest: `sanitizeIncome({…, amountChanges:[{from:'2027-01-01',amount:-1}]}).amountChanges` deep-equals `[]`. A valid entry survives. A legacy record with no field gets `[]`. The same three cases for `sanitizeRecurringTemplate`.
  - Jest: `isValidRecurringTemplate` is false for a transfer whose `amountChanges` includes `amount: 0`, and true for a subscription with a 0 change.
  - Server (`node:test`, pattern of `server/test/weekendRule.test.js`):
    - POST then GET an income and a recurring template with `amountChanges` round-trips it.
    - A transfer template PATCH `{ amountChanges:[{from:'2027-01-01',amount:0}] }` gets 400, while a PATCH `{ name:'x' }` on the same record gets 200.
    - The migration `up` is idempotent (run twice) and `down` removes the columns, inside a rolled-back transaction as in the 036 test.
- [ ] **Step 2: Run** `npm run test:unit -- tests/unit/sanitizers.test.js tests/unit/serverValidity.test.js` and the server test (memory Docker recipe). Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Income: `amountChanges: sanitizeAmountChanges(record?.amountChanges, { min: 0.01 })`.
  - Recurring: `sanitizeAmountChanges(record?.amountChanges)`.
  - Transfer validity: also require `(r.amountChanges || []).every(c => c.amount > 0)`.
  - Migration: `ALTER TABLE … ADD COLUMN IF NOT EXISTS amount_changes jsonb NOT NULL DEFAULT '[]'` on both tables. The safety note says rollback discards the amount history, and past months then project at the base amount.
  - Routes: `amountChanges: 'amount_changes'`.
- [ ] **Step 4: Run** the same tests plus `server/test/fieldParity.test.js` and `server/test/rowVersion.test.js`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(amounts): persist amountChanges on incomes and recurring templates (#678)`.

### Task 3: Per-occurrence amounts in projections and paid sync

**Files:**
- Modify: `src/utils.js` (`computeNetIncomeAmount`, `computeMonthlyIncomeForMonth`, the payday event list around line 719)
- Modify: `src/projectionCore.js` (income legs and the four recurring legs)
- Modify: `src/recurringPaid.js` (`getRecurringMonthPaidStatus`, `_applyOccurrence`)
- Modify: `src/recurring.js` (monthly totals around lines 139, 384 and 849)
- Modify: `src/income.js` (YoY totals around lines 711-714), `src/reportsCalendar.js` (around 171 and 182), `src/strategyCalendar.js` (around 157-159)
- Test: new `tests/unit/amountScheduleProjection.test.js`

**Interfaces:**
- Consumes: `getAmountOn` (Task 1), `dateToISO`.
- Produces: `computeNetIncomeAmount(income, date?: Date | string)`, which applies withholding to `getAmountOn(income, iso)`, where `iso` is today when `date` is omitted.

- [ ] **Step 1: Write failing tests** (build a minimal `app` the way `tests/unit/forecastTransfers.test.js` does):
  - A monthly recurring subscription of $15 with a change to $18 from `2027-01-01`. The `buildProjectedAccountTransactions` legs for Dec 2026 have `-15`, and Jan 2027 has `-18`.
  - A weekly $10 template with a change to $12 on a mid-month date. The month's occurrences sum to `10 × (before count) + 12 × (on-or-after count)`, and `computeRecurringCashFlowForMonth` agrees.
  - Income $1000 biweekly, 20% withholding, change to $1200 from `2027-01-01`. The Jan 2027 income legs are `960` each, and Dec 2026 legs are `800`. `computeMonthlyIncomeForMonth` matches the sum of the legs for both months.
  - Recurring paid: on a post-change occurrence, `getRecurringMonthPaidStatus(...).occurrences[0].actualAmount === 18` with no override. Marking it paid with `actualAmount: 18` stores no override, while `actualAmount: 15` stores one.
- [ ] **Step 2: Run** `npm run test:unit -- tests/unit/amountScheduleProjection.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement.** Each per-occurrence read switches to `getAmountOn(record, dateToISO(occDate))`, or `computeNetIncomeAmount(inc, payDate)` for income. A `count × amount` total becomes a sum over occurrences. In `projectionCore.js`, the income `if (!inc.amount) continue;` skip becomes a per-payday check of the dated amount.
- [ ] **Step 4: Run** the new test and the whole Jest suite (`npm run test:unit`). Expected: PASS.
- [ ] **Step 5: Commit** `feat(amounts): project income and recurring at the amount in effect on each date (#678)`.

### Task 4: Calendar feeds (client and server)

**Files:**
- Modify: `src/calendarFeed.js` (around lines 135 and 147)
- Modify: `server/src/calendarGenerator.js` (select `amount_changes` in both queries, around lines 75 and 77; descriptions around 152 and 165)
- Test: `server/test/amountChanges.test.js` (extend), `tests/unit/` calendar test if one covers `generateIcs`, otherwise add a case to `amountScheduleProjection.test.js`

**Interfaces:**
- Consumes: `getAmountOn` (Task 1), imported in the server as `../../src/amountSchedule.js`.

- [ ] **Step 1: Write failing tests.** Server: a recurring template of $15 with a change to $18 from `2027-01-01` produces `/calendar.ics` events with `Amount Due: $15.00` before and `$18.00` on or after that date. Client: `generateIcs` gives the same.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.** Pass `getAmountOn({ amount: row.amount, amountChanges: row.amount_changes }, dateStr)` to `buildDesc`, and the same per event on the client.
- [ ] **Step 4: Run** them, plus `server/test/calendarShared.test.js`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(amounts): calendar feeds use the dated amount (#678)`.

### Task 5: Current-amount displays and a static guard

**Files:**
- Modify: `src/income.js` (card around 163-166 and 212), `src/recurring.js` (card around 443), `src/people.js` (around 57 and 155), `src/health.js` (around 1087)
- Create: `tests/unit/amountReadGuard.test.js`

**Interfaces:**
- Consumes: `getCurrentAmount`, `computeNetIncomeAmount(income)` (today).

- [ ] **Step 1: Write the failing guard.** A Jest test that reads every `src/**/*.js` and `server/src/**/*.js` and fails on a match of `/\b(inc|income|i|tmpl|template|tpl|t|r|rec|row)\.amount\b/`. It allows only an explicit list of files: `src/amountSchedule.js`, `src/sanitizers.js`, and, with a reason each, lines that don't read income or template records (for example `health.js` surplus recommendations `r.amount`, bills, `sanitizers` validity). Allowed lines carry an inline `// amount-read-ok: <reason>` comment that the guard accepts.
- [ ] **Step 2: Run** `npm run test:unit -- tests/unit/amountReadGuard.test.js`. Expected: FAIL, listing the display sites.
- [ ] **Step 3: Implement.** Switch the display sites to `getCurrentAmount(rec, dateToISO(new Date()))` or `computeNetIncomeAmount(inc)`. Mark the unrelated `.amount` lines with `// amount-read-ok:`. The inline editor `value=` attributes use the current amount, which is required by Task 6.
- [ ] **Step 4: Run** the guard and the full Jest suite. Expected: PASS.
- [ ] **Step 5: Commit** `feat(amounts): show the current amount on cards; guard direct amount reads (#678)`.

### Task 6: Edit UI ("Applies from") and change list

**Files:**
- Modify: `src/income.js` (inline editor markup around line 96; `saveEditIncome` at 315; card)
- Modify: `src/recurring.js` (inline editor around 511; `saveEditRecurring` at 738; card)
- Create: `src/amountChangeUi.js` (`renderAppliesFromRow(prefix, id, record, nextOccurrenceIso)`, `renderAmountChangeSummary(record, kind, id)`, `readAppliesFrom(prefix, id) → string | 'all'`, `nextOccurrenceIso(record, kind, today) → string | null`, plus a delegated listener installed from `initializeEventListeners` that shows the row when the amount input differs from its `data-current-amount`, and handles `[data-amount-change-delete]`)
- Modify: `src/ui.js` (install the listener), `styles.css` (a small block for the row and list; no nesting), the three locale files
- Create: `tests/features/test_effective_dated_amounts.py`; modify `.github/workflows/ci.yml` (add it to a shard under the time budget)

**Interfaces:**
- Consumes: `applyAmountChange`, `getAmountChangeSummary` (Task 1), `getRecurringOccurrencesInMonth`, `getIncomePaydaysInMonth`, `pgPatch` through the existing save paths.
- DOM ids: `#ie-applies-from-<id>`, `#ie-applies-all-<id>`, `#re-applies-from-<id>`, `#re-applies-all-<id>`. Each card's change list is a `<details class="amount-changes">`.
- Locale keys: `amounts.appliesFrom`, `amounts.allOccurrences`, `amounts.allWipesScheduled`, `amounts.wasUntil` (`{amount}`, `{date}`), `amounts.changeCount.one`/`.other` (`{count}`), `amounts.changeItem` (`{amount}`, `{date}`), `amounts.deleteScheduledAria` (`{amount}`, `{date}`), `amounts.scheduled`.

- [ ] **Step 1: Write failing Playwright tests** (`app_page` fixture; seed through the UI or `seed_state`):
  - `test_recurring_future_change_keeps_past_months`: a $15 monthly subscription. Edit it to 18 with Applies from = the first of next month, save, then `wait_for_api('/api/recurring-templates', …)` and reload. The Ledger shows -15.00 for this month's occurrence and -18.00 for next month's, and the card shows the "was … until" line.
  - `test_income_change_from_date`: the same for an income.
  - `test_all_occurrences_resets`: tick "All occurrences". After reload, `amountChanges` from the API is `[]`, and this month shows the new amount.
  - `test_delete_scheduled_change`: delete the future change from the list. The API shows `[]`.
  - `test_applies_from_hidden_until_amount_changes`: the row is hidden on opening the editor and visible after typing a new amount.
- [ ] **Step 2: Run** `pytest tests/features/test_effective_dated_amounts.py -v` against a local stack. Expected: FAIL.
- [ ] **Step 3: Implement** the module and wire both editors. The save paths compute `{amount, amountChanges}` with `applyAmountChange(record, newAmount, readAppliesFrom(...), firstOccurrenceIso)`, where `firstOccurrenceIso` is `firstPayDate` or `startDate`. The $0 policy check runs on the new amount as today. Card summary text is built with `t()` and `escapeHtml`, and the delete button's `aria-label` starts with the visible word.
- [ ] **Step 4: Run** the new file, `tests/features/test_i18n_coverage.py`, `tests/ui/test_aria_labels.py`, `tests/ui/test_css_integrity.py`, `tests/features/test_ci_shard_coverage.py`, and the existing income and recurring feature tests (`pytest tests/features/test_income*.py tests/features/test_recurring*.py -v`). Expected: PASS.
- [ ] **Step 5: Commit** `feat(amounts): Applies-from editing and change list for income and recurring (#678)`.

### Task 7: Release and docs

**Files:**
- Modify: `src/utils.js` (`APP_VERSION` to the next minor), `CHANGELOG.md`, `sw.js` (`CACHE_NAME`), `src/ui.js` (`WHATS_NEW_ENTRIES` plus its locale keys), `CLAUDE.md` (a short Cross-cutting bullet: the helper, the base+changes model, the guard), `CONTRIBUTING.md` if it lists the amount conventions

- [ ] **Step 1: Bump** the version, changelog, cache name and What's New entry (en/es/pl).
- [ ] **Step 2: Run** `pytest tests/features/test_versioning.py tests/features/test_pwa.py tests/features/test_whats_new.py tests/features/test_i18n_coverage.py tests/features/test_community_files.py -v` and the full Jest suite. Expected: PASS.
- [ ] **Step 3: Commit** `chore(release): x.y.0 effective-dated amounts (#678)`. Push the branch, open a draft PR (closes #678), and wait for CI. Then derive the `src/amountSchedule.js` mutation floor from the PR's `mutation-report-pr` artifact, commit it, and mark the PR ready once CI is green.
