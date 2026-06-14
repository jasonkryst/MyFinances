# Quick Wins Integration — Design Spec

**Date**: 2026-06-14
**Status**: Approved (pending user sign-off on this doc)
**Roadmap item**: 📋 Quick Wins #1 (Debt Payoff Timeline Display) and #4 (Bill Payment Status)

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
- Bill "Paid this month" status is a tracking/visual feature only. It does
  **not** affect Cash Flow Summary totals, Ledger transactions, account
  projections, or Reports — those all continue to treat bills as
  always-occurring monthly obligations regardless of paid status. Wiring
  "paid" status into those calculations would be part of the larger "📅 Bill
  Payment Tracker" Tier 3 item (still PROPOSED), which this Quick Win
  partially seeds but does not complete.
- No new top-level app-state collections — both features extend existing
  records (`app.debts` via transient summary data already in memory,
  `app.bills` via a new array field).

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

## Feature 2 — Bill Payment Status ("Paid this month")

### Data model

Add `paidMonths: []` to each bill record — an array of `'YYYY-MM'` strings,
following the exact existing pattern of `recurringTemplates[].skippedMonths`
(see `src/recurring.js` `skipRecurringOccurrence` and the monthKey
computation `${year}-${String(month + 1).padStart(2, '0')}`).

### Storage wiring (`src/storage.js`)

- `sanitizeBill(record, idFallback)`: add
  `paidMonths: Array.isArray(record?.paidMonths) ? record.paidMonths.filter(m => /^\d{4}-\d{2}$/.test(m)) : []`
  — same filter regex as `sanitizeRecurringTemplate`'s `skippedMonths`.
- No changes needed to `saveToStorage`/`loadFromStorage`/export/import beyond
  what `sanitizeBill` already covers, since bills already round-trip through
  `sanitizeBill` on load/import.

### UI (`src/bills.js`)

- `renderBillList()`:
  - Compute `currentMonthKey` via the same `${year}-${String(month + 1).padStart(2, '0')}` pattern, using `new Date()`.
  - For each non-editing bill card, add a checkbox/label:
    `<label class="bill-paid-toggle"><input type="checkbox" data-bill-action="toggle-paid" data-bill-id="${bill.id}" ${isPaid ? 'checked' : ''}> Paid this month</label>`
    where `isPaid = Array.isArray(bill.paidMonths) && bill.paidMonths.includes(currentMonthKey)`.
  - When `isPaid`, add a `budget-card--paid` class to the card's root `<div>`
    for a visual indicator (e.g. green left border / muted background).
- New exported function `toggleBillPaid(app, id)`:
  - Find the bill by id; ensure `bill.paidMonths` is an array.
  - If `currentMonthKey` is in `paidMonths`, remove it; else push it.
  - `app.saveToStorage()`, then `renderBudgetPage(app)`.
- Wire the checkbox via a `change` listener on the bill list container
  (existing `container.onclick` handles button clicks; add a sibling
  `container.addEventListener('change', ...)` for `[data-bill-action="toggle-paid"]`,
  since checkbox state changes fire `change`, not a click action we'd want to
  re-derive from `event.target`).

### App wiring (`src/app.js`)

- Add thin delegating method: `toggleBillPaid(id) { toggleBillPaid(this, id); }`
  (alongside the existing `deleteBill`/`startEditBill`/etc. delegations),
  importing `toggleBillPaid` from `./bills.js`.

### CSS (`styles.css`)

- New `.budget-card--paid` rule (and `body.dark-mode .budget-card--paid`
  variant) — subtle visual treatment (e.g. left border accent + slightly
  reduced opacity on the amount), consistent with existing `.budget-card`
  variants like `.budget-card--editing`.
- New `.bill-paid-toggle` rule for checkbox/label spacing — small,
  inline-flex with the existing budget-card-actions area.

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
   - #4 Bill Payment Status → ✅ Delivered (June 14, 2026), with a one-line
     implementation note (`paidMonths` per bill).
   - #2 and #5 → replace with a single cross-reference note pointing to the
     Tier 1 "🛑 Budget Alerts & Overspend Warnings" item, marked
     ⏭️ Deferred — folded into that larger effort.
4. Update the Tier 3 "📅 Bill Payment Tracker" entry to note that "Paid this
   month" tracking has been seeded by Quick Win #4, with the remainder
   (late-payment warnings, payment history, monthly checklist) still
   PROPOSED.
5. Fix stale version references (`v3.2.0` → current `v3.4.0`, see
   `src/utils.js APP_VERSION`) and bump `Last Updated` date.

### `README.md`

- Add the two new features under "🎯 Key Product Updates":
  - Debt cards show a calculated payoff date (or a "run a plan" hint).
  - Bills support a "Paid this month" checkbox with monthly auto-reset.
- Fix stale `v3.2.0` references in the footer/header to match
  `APP_VERSION` (3.5.0 after this work — see Version Bump below).

### `guide.html`

- Debts section: brief note that each debt card shows its projected payoff
  date once a plan has been calculated on the Plan page.
- Budget section: brief note about the "Paid this month" checkbox on bill
  cards and that it resets automatically each calendar month.

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
- **`tests/features/test_expenses.py`** (covers both bills and expenses):
  - Toggling "Paid this month" persists through `saveToStorage`/reload
    (localStorage) and through JSON export/import round-trip.
  - `paidMonths` contains the current month-key after toggling on, and is
    empty/doesn't contain it after toggling off.
- **`tests/security/test_input_validation.py`**:
  - `sanitizeBill` strips malformed `paidMonths` entries (non-string,
    wrong format, oversized arrays) on import.
- **`tests/integration/test_smoke.py`**: no new steps required — existing
  Debts and Budget page smoke coverage will exercise the new markup without
  errors.
