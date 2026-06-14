# Quick Wins Integration — Design Spec

**Date**: 2026-06-14
**Status**: Approved (pending user sign-off on this doc)
**Roadmap item**: 📋 Quick Wins #1 (Debt Payoff Timeline Display) and #4 (Bill Payment Status — retargeted to Recurring Templates, see Revision below)

**Revision (2026-06-14)**: While gathering implementation details, discovered
that the standalone "Bills" UI was removed from `index.html` in commit
`c614caf` (May 29, 2026) in favor of Recurring Templates. Feature 2 below has
been rewritten accordingly — see Non-goals and Feature 2.

## Goal

Integrate the two remaining low-effort, high-clarity "Quick Wins" from
`ROADMAP.md`, and clean up `ROADMAP.md` / `README.md` / `guide.html` so the
status of every roadmap item (delivered / proposed / deferred) is easy to
scan at a glance.

## Non-goals

- **Quick Win #2 (Month-to-Date Spending Summary)** and **#5 (Budget
  Overspend Badges)** are explicitly **out of scope** for this round. They
  require a new "per-category monthly budget limit" concept that doesn't
  exist in the data model today (`app.expenses` entries are individual dated
  transactions, not category limits). These are folded into the existing
  Tier 1 "🛑 Budget Alerts & Overspend Warnings" roadmap item (still
  PROPOSED) as a single future effort, rather than being tracked separately.
- **Bills UI no longer exists.** The standalone "Bills" feature
  (`#billForm`/`#billList` and the bill CRUD/render functions in
  `src/bills.js`) was removed from `index.html` in commit `c614caf`
  (May 29, 2026) in favor of Recurring Templates (`src/recurring.js`).
  `app.bills` data and `sanitizeBill` still exist for legacy/imported
  records (consumed by `accounts.js`, `health.js`, `ledger.js`,
  `strategy.js`), but there is no UI to add/edit/view bills directly, and
  **no "paid" tracking will be added to bills**. Quick Win #4 is therefore
  retargeted at Recurring Templates (Subscription / Reimbursement / Transfer
  entries) — see Feature 2 below.
- "Mark as paid this month" status on a recurring template is a
  tracking/visual feature only. It does **not** affect Cash Flow Summary
  totals, Ledger transactions, account projections, or Reports — those all
  continue to compute occurrences via `getRecurringOccurrencesInMonth()`
  regardless of paid status. This is distinct from the existing "Skip month"
  (`skippedMonths`), which suppresses an occurrence entirely — "paid" only
  confirms that an occurrence which already happened has been handled.
- No new top-level app-state collections — both features extend existing
  records (`app.debts` via transient summary data already in memory,
  `app.recurringTemplates` via a new array field mirroring
  `skippedMonths`).

## Feature 1 — Debt Payoff Timeline Display

**Where**: `src/debts.js`, `renderDebtsList()` — every debt card (Credit Card
and Fixed Amount types alike).

**Data source**: `app._debtSummaryRows`, already populated by
`displayDebtSummary()` in `src/strategy.js` whenever the user clicks
"Calculate Payment Plan". Each row has `{ name, payoffDate, ... }`. This is
**transient, in-memory only** — not persisted to localStorage, and not
exported/imported. No `storage.js` changes.

**Behavior**:
- For each debt, find `app._debtSummaryRows?.find(r => r.name === debt.name)`.
- If found and `row.payoffDate` is truthy, render a new detail row:
  `<div class="debt-detail debt-payoff-detail"><strong>📅 Payoff Date:</strong> ${row.payoffDate}</div>`
  (placed after the existing "Due Date" / "Opened" / "Est. interest paid to
  date" rows, before "Priority").
- If `app._debtSummaryRows` is null/empty or has no matching row, render a
  muted fallback:
  `<div class="debt-detail debt-payoff-detail debt-payoff-detail--muted"><strong>📅 Payoff Date:</strong> <span class="text-muted">Run a plan to see</span></div>`
  — mirrors the existing "Total Interest (projected) → Run a plan to see"
  fallback already used in the Debt Overview card (`debts.js` ~line 277-280).
- `payoffDate` is an app-generated formatted string (`DebtCalculator.formatDate`),
  not user input — no `escapeHtml()` needed, consistent with how
  `debt.fixedStartDate`/`fixedEndDate` are already rendered unescaped nearby.

**No new CSS classes strictly required** beyond `.debt-payoff-detail--muted`
(reuse existing `.text-muted` for the muted text, add one wrapper class for
any spacing tweaks if needed).

## Feature 2 — Recurring Template "Mark as Paid This Month"

### Data model

Add `paidMonths: []` to each recurring template record — an array of
`'YYYY-MM'` strings, mirroring the exact existing pattern of
`recurringTemplates[].skippedMonths` (see `src/recurring.js`
`skipRecurringOccurrence` and the monthKey computation
`${year}-${String(month + 1).padStart(2, '0')}` used throughout
`recurring.js`).

"Paid" is distinct from "Skipped": skipping means the occurrence won't
happen this month (excluded from totals); marking paid means an occurrence
that *did* happen has been confirmed/handled by the user. Marking paid has
**no effect** on `getRecurringOccurrencesInMonth()` or any totals derived
from it.

### Storage wiring (`src/storage.js`)

- `sanitizeRecurringTemplate(record, idFallback)` (storage.js:110-129): add
  `paidMonths: Array.isArray(record?.paidMonths) ? record.paidMonths.filter(m => /^\d{4}-\d{2}$/.test(m)) : []`
  — same filter regex as the existing `skippedMonths` line.
- No changes needed to `saveToStorage`/`loadFromStorage`/export/import beyond
  this, since `recurringTemplates` already round-trip through
  `sanitizeRecurringTemplate` on load/import (storage.js:210).

### Core logic (`src/recurring.js`)

- `addRecurringTemplate` (recurring.js:307-343): add `paidMonths: []` to the
  new-template object literal, alongside the existing `skippedMonths: []`
  (line 337).
- New exported function `markRecurringPaid(app, id, monthKey, unmark = false)`,
  placed immediately after `skipRecurringOccurrence` (recurring.js:360-371),
  structurally identical to it:
  ```js
  export function markRecurringPaid(app, id, monthKey, unmark = false) {
      const t = app.recurringTemplates?.find(x => x.id === id);
      if (!t || !monthKey) return;
      if (!t.paidMonths) t.paidMonths = [];
      if (unmark) {
          t.paidMonths = t.paidMonths.filter(m => m !== monthKey);
      } else if (!t.paidMonths.includes(monthKey)) {
          t.paidMonths.push(monthKey);
      }
      app.saveToStorage();
      app.renderRecurringPage();
  }
  ```

### UI (`_buildReadCard`, recurring.js:157-232)

- After the existing `isSkippedThisMonth` computation (line 168), add:
  `const isPaidThisMonth = Array.isArray(t.paidMonths) && t.paidMonths.includes(monthKey);`
- Status badge (lines 170-179): insert a new branch between the
  `isSkippedThisMonth` and `occurrences.length > 0` checks so a paid template
  shows a distinct badge instead of "Active":
  ```js
  let statusBadge;
  if (t.paused) {
      statusBadge = `<span class="recurring-badge recurring-badge--paused">⏸ Paused</span>`;
  } else if (isSkippedThisMonth) {
      statusBadge = `<span class="recurring-badge recurring-badge--skipped">⏭ Skipped this month</span>`;
  } else if (occurrences.length > 0 && isPaidThisMonth) {
      statusBadge = `<span class="recurring-badge recurring-badge--paid">✅ Paid this month</span>`;
  } else if (occurrences.length > 0) {
      statusBadge = `<span class="recurring-badge recurring-badge--active">✅ Active</span>`;
  } else {
      statusBadge = `<span class="recurring-badge recurring-badge--pending">⏳ No hits this month</span>`;
  }
  ```
- Card actions (lines 219-230): add a "Mark as paid" / "Unmark paid" toggle
  button between the pause/resume button and the skip/unskip button. Shown
  only when the template is active, not skipped, and has at least one
  occurrence this month:
  ```js
  ${(!t.paused && !isSkippedThisMonth && occurrences.length > 0)
      ? (isPaidThisMonth
          ? `<button class="btn btn-secondary btn-small" data-recurring-action="unmark-paid" data-recurring-id="${t.id}" data-recurring-monthkey="${monthKey}">↩ Unmark paid</button>`
          : `<button class="btn btn-secondary btn-small" data-recurring-action="mark-paid" data-recurring-id="${t.id}" data-recurring-monthkey="${monthKey}">✅ Mark as paid</button>`)
      : ''}
  ```

### Click handler (`renderRecurringPage`, recurring.js:135-154)

Add two new dispatches alongside the existing `skip`/`unskip` ones:
```js
else if (action === 'mark-paid') app.markRecurringPaid(id, mk, false);
else if (action === 'unmark-paid') app.markRecurringPaid(id, mk, true);
```

### App wiring (`src/app.js`)

- Add `markRecurringPaid as markRecurringPaidFeature` to the `./recurring.js`
  import block (app.js:71-80).
- Add a thin delegating method immediately after `skipRecurringOccurrence`
  (app.js:764):
  `markRecurringPaid(id, monthKey, unmark) { return markRecurringPaidFeature(this, id, monthKey, unmark); }`

### CSS (`styles.css`)

- New `.recurring-badge--paid` rule alongside the existing badge variants
  (styles.css:4794-4801) — a blue tone, visually distinct from the green
  `--active` badge:
  ```css
  .recurring-badge--paid { background: #dbeafe; color: #1e40af; }
  body.dark-mode .recurring-badge--paid { background: #1e3a5f; color: #93c5fd; }
  ```

## Documentation Updates

### `ROADMAP.md`

1. Add a short **Status Legend** near the top (after Strategic Vision):
   `✅ Implemented` / `📋 Proposed` / `⏭️ Deferred (folded into another item)`.
2. Add an **"At a Glance" status table** summarizing every Tier 1–4 feature
   and all 5 Quick Wins in one place (Feature | Tier | Status | Notes) —
   directly addresses "easier to understand what's complete vs. proposed"
   without requiring readers to scan every tier section.
3. Update the **Quick Wins** section (lines ~468-489):
   - #1 Debt Payoff Timeline Display → ✅ Delivered (June 14, 2026), with a
     one-line implementation note (reuses `app._debtSummaryRows`).
   - #3 Dashboard Page → unchanged (already marked delivered).
   - #4 Bill Payment Status → ✅ Delivered (June 14, 2026), retitled/reworded
     to reflect the actual scope: "Mark as paid this month" for Recurring
     Templates (subscriptions/reimbursements/transfers), with a one-line
     implementation note (`paidMonths` per template, mirrors
     `skippedMonths`). Note that the standalone Bills feature this item
     originally targeted was removed in favor of Recurring Templates
     (May 29, 2026).
   - #2 and #5 → replace with a single cross-reference note pointing to the
     Tier 1 "🛑 Budget Alerts & Overspend Warnings" item, marked
     ⏭️ Deferred — folded into that larger effort.
4. Update the Tier 3 "📅 Bill Payment Tracker" entry (lines ~284-293) to
   reflect reality: the standalone Bills feature it was written against no
   longer has a UI (removed May 29, 2026; superseded by Recurring
   Templates). Note that the "mark as paid" piece of this item has been
   delivered for Recurring Templates via Quick Win #4. The remainder (late-
   payment warnings, payment history, monthly checklist) stays PROPOSED, but
   would need to be redefined against Recurring Templates rather than the
   old Bills model if pursued.
5. Fix stale version references (`v3.2.0` → current `v3.4.0`, see
   `src/utils.js APP_VERSION`) and bump `Last Updated` date.

### `README.md`

- Add the two new features under "🎯 Key Product Updates":
  - Debt cards show a calculated payoff date (or a "run a plan" hint).
  - Recurring Templates support a "Mark as paid this month" toggle
    (distinct from "Skip month") with monthly auto-reset.
- Fix stale `v3.2.0` references in the footer/header to match
  `APP_VERSION` (3.5.0 after this work — see Version Bump below).

### `guide.html`

- Debts section: brief note that each debt card shows its projected payoff
  date once a plan has been calculated on the Plan page.
- Recurring Templates section: brief note about the "Mark as paid this
  month" button/badge on template cards, that it resets automatically each
  calendar month, and how it differs from "Skip month" (paid = occurred and
  confirmed; skipped = won't occur).

## Version Bump

Bump `APP_VERSION` in `src/utils.js`: `3.4.0` → `3.5.0` (new user-facing
features, following the existing minor-version convention seen in
3.1→3.2→3.4).

## Test Plan

- **`tests/features/test_debts.py`**:
  - After calculating a payment plan, each debt card shows "📅 Payoff Date"
    with a non-empty date string matching the debt summary table.
  - Before any plan is calculated, debt cards show the "Run a plan to see"
    fallback instead.
- **`tests/ui/test_recurring_actions.py`** (mirrors the existing
  `test_recurring_skip_and_unskip_month`, which seeds a template via
  `app.recurringTemplates` and clicks `[data-recurring-action=...]`
  buttons):
  - New `test_recurring_mark_and_unmark_paid`: seed a monthly subscription
    template with `paidMonths: []`, click
    `[data-recurring-action="mark-paid"]`, assert the card badge contains
    "Paid this month" and an `[data-recurring-action="unmark-paid"]` button
    is now present; click it and assert the badge returns to "Active" and
    the `mark-paid` button reappears.
- **`tests/features/test_recurring_occurrences.py`** (pure-function tests
  via `page.evaluate` + dynamic `import('/src/recurring.js')`, following the
  existing `_occurrences()` helper pattern):
  - New test for `markRecurringPaid`: calling it with `unmark=false` adds
    the current month-key to `paidMonths`; calling it again with
    `unmark=true` removes it. Marking paid does not change the result of
    `getRecurringOccurrencesInMonth()` for the same template/month.
- **`tests/security/test_input_validation.py`**:
  - New test mirroring `test_recurring_day_of_month_bounds`: seed a
    recurring template with a malformed `paidMonths` array (non-string
    entries, wrong-format strings like `'2026-13'` or `'paid'`) via JSON
    import and assert `sanitizeRecurringTemplate` strips them, leaving only
    valid `'YYYY-MM'` entries.
- **`tests/integration/test_smoke.py`**: no new steps required — existing
  Debts and Recurring page smoke coverage will exercise the new markup
  without errors.
