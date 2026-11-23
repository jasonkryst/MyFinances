# Effective-dated amounts for income and recurring templates (#678)

## Intent

When a subscription price goes up or a salary rises, the user enters the new
amount once and it applies **from a date onward**. Earlier months' Ledger,
account balances, Reports and derived budgets stay exactly as they were.

Today income and recurring templates have a single `amount`, and the
projection (`src/projectionCore.js`) reads it for every occurrence, past ones
included, so any amount edit rewrites history. The workarounds (a Ledger
override per past occurrence, or ending the template and creating a new one)
are tedious or split the paid history (#434) across two records.

## Goals

- An amount edit on an income or recurring template asks "Applies from" and
  only changes occurrences on or after that date.
- A change can be scheduled in the future (a known price increase); Forecast
  and every projection pick it up.
- A plain correction of a mistake ("all occurrences") is still one choice away.
- The card shows the current amount, what it was, and a short list of changes;
  a scheduled future change can be deleted.

## Non-goals

- Dating anything other than the amount. Income `withholdingPercent` stays one
  value. Name, day, account, frequency and weekend-rule edits behave as today.
- Bonuses (a per-year Ledger override already covers them), debts and their
  payments, savings funds.
- Storing posted transactions (#690). This design must not get in its way:
  `getAmountOn` is the one place #690 can later make a posted row win.

## Anti-goals

- Any edit path that still silently rewrites past months by default.
- Past occurrences the user already marked paid at a different amount
  changing value. They hold a Ledger override (`ledgerAmountOverrides`),
  which keeps winning over the projected amount; nothing here touches
  overrides or Cleared keys.
- A second definition of "amount on a date" anywhere in the code.

## Constraints

- The pure projection modules are shared with the server (`projectionCore.js`,
  `recurringOccurrences.js`, ...) and must stay DOM- and network-free.
- A new persisted field needs a sanitizer entry, a migration and a route
  `columns` entry (`server/test/fieldParity.test.js`). Next migration number
  is above `1755600000043` at merge time.
- Strict CSP, `escapeHtml` for rendered values, every new string in
  en/es/pl, `TRANSLATED_PAGES` already covers Income and Recurring.
- Saves go through `pgPatch` (diff-only, `rowVersion`); `diffFields`
  compares nested values with `deepEqual`, so a changed array is sent whole.

## Approaches considered

- **A. A change list inside each record (chosen).** `amountChanges` jsonb
  column on `incomes` and `recurring_templates`, same pattern as
  `debts.ownershipSplit`. Rides the normal record PATCH, row versions,
  conflict handling, audit log, export/import with no id remapping.
- **B. A separate amount-change table.** A new CRUD resource needs
  `RESOURCE_TABLES`/`RESOURCE_PARENTS`, `KEY_FNS`, audit tables, FK remap,
  Undo cascades and a load fan-out, all for a small list that always belongs
  to one record. Rejected as too much machinery.
- **C. End the record and start a linked copy.** Splits the paid history and
  Cleared keys across two ids, which is what #678 exists to avoid. Rejected.

The user picked A.

## Design

### Data

On both incomes and recurring templates:

```js
amount: 15.49,                                   // amount before the first change
amountChanges: [ { from: '2027-01-01', amount: 18 } ]   // ascending by `from`
```

- `amount` keeps its meaning for records with no changes, so every existing
  record, export file and client is unaffected. *(Builder's call recorded: base
  amount + changes, rather than "current amount + history", because a
  scheduled future change has no clean place in a "current" model.)*
- `amountChanges` is `[]` when empty. Each entry: `from` an ISO date,
  `amount` a finite number within the same bounds the record's `amount`
  already has (income > 0; recurring >= 0 under the $0 policy rules, transfers
  > 0).

### The one helper

`getAmountOn(record, isoDate)` in a new pure, import-free leaf module
`src/amountSchedule.js` (Stryker-scoped, Jest-tested, hoisted function
exports). Returns the `amount` of the latest change with `from <= isoDate`,
else `record.amount`. Also exported from the same module:

- `sanitizeAmountChanges(raw, { min, max })`: drops entries with a bad date or
  amount, collapses duplicate `from` dates (last wins), sorts ascending, caps
  at 120 entries. Called from `sanitizeIncome` and `sanitizeRecurringTemplate`.
- `applyAmountChange(record, newAmount, from | 'all')`: the pure edit
  operation, returning the new `{ amount, amountChanges }`.
  - `'all'` sets `amount` and clears `amountChanges` (today's behavior).
    *(Call: a correction wipes scheduled changes too; the edit UI says so when
    any exist.)*
  - A date on or before the record's first occurrence (`firstPayDate` /
    `startDate`) replaces the base amount but keeps the changes dated after it
    (revised after the branch review: treating it as `'all'` silently deleted
    a scheduled raise when the starting amount was corrected).
  - Otherwise it inserts or replaces the entry for `from` and drops any later
    entries whose amount equals the one before them (no-op changes).
- `getCurrentAmount(record, today)` and `getAmountChangeSummary(record, today)`
  for display: current amount, previous amount and the date it ended, upcoming
  scheduled change if any.

Dates are compared as local `YYYY-MM-DD` strings; callers holding a `Date`
convert it with `dateToISO` (local time, never `toISOString()`, which can
shift the day near midnight).

`computeNetIncomeAmount(income)` gains an optional date argument and applies
withholding to `getAmountOn(income, date)`; with no date it uses today.

### Where amounts are read today (all must use the helper)

Per-occurrence (use the occurrence date):

- `projectionCore.js` income legs (~95-105) and the four recurring legs
  (~236-269).
- `recurringPaid.js` (~68, ~114): the template amount a paid row compares
  against, so "entering the template amount removes the override" uses the
  amount in effect on that occurrence.
- `recurring.js` monthly totals (~139, ~384, ~849): per occurrence, so a month
  that straddles a change sums correctly.
- `utils.js` `computeMonthlyIncomeForMonth` (~607) and the payday event list
  (~719): per payday.
- `income.js` year-over-year totals (~711-714), `reportsCalendar.js` (~171,
  ~182), `strategyCalendar.js` (~157-159): per payday or occurrence.
- `calendarFeed.js` (~135, ~147) and `server/src/calendarGenerator.js`
  (~165 plus its recurring branch): the event description uses the amount
  on that event's date. The server reads `amount_changes` from the row.

Current-amount displays (use today):

- `income.js` card (~163-166, ~212), `recurring.js` card (~443), `people.js`
  (~57, ~155), `health.js` (~1087, annualized income).

The builder should re-grep (`\.amount\b` on income/template variables) since
line numbers drift, and add a static guard test listing the files allowed to
read `.amount` directly on these two record types (the helper module and
sanitizers), so a new read site can't bypass it.

### Edit UI

Income inline editor (`#ie-amount-<id>`, `saveEditIncome`) and recurring
inline editor (`#re-amount-<id>`, `saveEditRecurring`):

- When the amount input differs from the **current** amount, an "Applies
  from" row appears under it: a date input defaulting to the next occurrence
  after today, plus a checkbox "All occurrences (correct a mistake)". The
  inputs show and hide via classes (CSP), labels are real `<label for>`.
- The amount input is pre-filled with the current amount (not the base).
- Save calls `applyAmountChange`, then the existing `pgPatch` path.
- If scheduled future changes exist and "All occurrences" is ticked, a line of
  helper text says they will be removed.
- Add forms are unchanged (a new record has no history).

Card (both types):

```
Netflix                         $18.00 / mo
  was $15.49 until Dec 31, 2026 · 2 changes ▸
```

- The summary line appears only when `amountChanges` is non-empty.
- "▸" is a native `<details>` listing each change ("$18.00 from Jan 1, 2027"),
  newest first; a change dated after today has a Delete button
  (`aria-label` "Delete scheduled change to $X on <date>"). Past changes are
  not deletable from here (use "All occurrences" to reset).
- Dates through `formatShortDate`/`formatLongDate`, amounts through
  `formatCurrency`.

### Server and storage

- Migration: `amount_changes jsonb NOT NULL DEFAULT '[]'` on `incomes` and
  `recurring_templates`, idempotent (`IF NOT EXISTS`). `down()` drops the
  columns; `MIGRATION SAFETY NOTE`: rollback discards amount history, and
  past months then project at the base amount.
- Route `columns`: `amountChanges: 'amount_changes'` in `incomes.js` and
  `recurringTemplates.js`. The server already re-runs the frontend sanitizer.
- `isValidRecurringTemplate` (transfers > 0) applies to every change amount
  too, so a transfer can't get a $0 change.
- Export/import: the field rides the records; `sanitizeParsedState` warnings
  record coerced or dropped entries like any field. Merge keys unchanged.
- Change log: a schedule change is a field update of `amountChanges`, no new
  audit wiring.
- Live refresh and conflicts: no special handling; a same-field conflict on
  `amountChanges` uses the existing conflict modal.

### Interaction notes

- Ledger overrides and Cleared keys are untouched; an override still wins.
- The Ledger override modal's "original amount" comes from the projection, so
  it shows the dated amount automatically.
- `$0` policy (`confirmZeroAmountAllowed`) runs on the new amount as today.
- Notifications core uses projected transactions, so it inherits.

## Testing

- Jest: `amountSchedule.test.js` covering the helper boundaries (day before,
  on, after a change; multiple changes; unsorted/duplicate input),
  `applyAmountChange` cases ('all', before first occurrence, replace same
  date, no-op collapse), sanitizer bounds. Add the module to `MUTATE_SCOPE`
  and give it a floor from the CI report.
- Jest: a projection test where a template changes mid-year and only later
  months move.
- Server: field round-trip through both routes, migration up/down, transfer
  $0 change rejected, calendar feed description uses the dated amount.
- Playwright (new file, added to a CI shard): edit a recurring amount with a
  future "Applies from", confirm earlier Ledger months unchanged and later
  ones changed after reload (`wait_for_api`); same for an income; "All
  occurrences" restores single-amount behavior; delete a scheduled change.
- Static guard for direct `.amount` reads (above).

## Release

Minor version bump (new feature): `APP_VERSION`, `CHANGELOG.md`,
`sw.js` `CACHE_NAME`, and a What's New entry in en/es/pl.

## Left to the builder

- Exact markup and CSS of the "Applies from" row and the change list, within
  the existing inline-editor styles and the mobile-density rules.
- How "next occurrence" is computed for the default date (reuse
  `getRecurringOccurrencesInMonth` / payday helpers, looking ahead up to 13
  months).
- Whether the static guard is a pytest scan or a Jest test.
