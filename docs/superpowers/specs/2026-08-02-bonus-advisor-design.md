# Bonus Advisor — Design (Issue #64)

**Date:** 2026-08-02
**Issue:** [#64 Bonus - What To Do](https://github.com/jasonkryst/MyFinances/issues/64)

## Summary

When entering a one-time bonus/deposit, let the user tag it with an intended
**Purpose** — *Cash Flow* (pay down debt) or *Long-term Savings* — and, on
request, show the actual computed outcome of each option so the choice is
informed rather than a guess. Cash-flow impact is computed by running the
existing `DebtCalculator.calculatePaymentPlan` payoff engine once with the
bonus applied as a one-time stimulus and once without, and diffing the
results. Savings growth is computed with the existing
`dailyCompoundInterest` helper against the linked account's APY (or the best
available APY among the user's accounts if the bonus isn't linked to one).

No new calculation engine is built — both metrics reuse engines that already
exist for other features (debt payoff stimulus, account interest).

## Decisions

| Question | Decision |
|---|---|
| Scope | Real computed advice (not just a label) — see AskUserQuestion: user chose "Recommendation calculator" + "Bonus form + shown elsewhere". |
| Trigger | Button-triggered ("💡 What should I do with this?"), not live-on-input — matches the existing convention (`calculateRequiredPayment` et al.), avoids recalculating a full payoff plan on every keystroke. |
| Auto "winner" label | **No.** Interest-saved-over-debt-lifetime and 1yr/5yr savings growth are different timeframes/units; forcing a single verdict would mislead. Show both computed outcomes; the user picks the Purpose themselves. |
| "Shown elsewhere" | Bonus list cards only (`renderBonusList`) — the only place bonuses currently render individually with a badge. Ledger/Reports only aggregate bonus totals today; no existing per-bonus render to attach a badge to, so that's out of scope. |
| Persistence | `purpose` is a new optional field on the bonus record: `'cashFlow' \| 'savings' \| null`. Purely descriptive — does not change how the bonus flows through ledger/reports/forecast. |

## Calculation (`src/bonusAdvisor.js`, new module)

Pure function, no DOM/app access — mirrors the calc/DOM split already used by
`strategyPlanCalculation.js`:

```js
calculateBonusAdvice({ bonusAmount, debts, monthlyPayment, strategy, accountRate })
```

**Cash Flow branch:**
- Not applicable if there are no debts, or none are interest-bearing
  (`debtType !== 'fixedAmount'`), or `bonusAmount <= 0`.
- `baseline = DebtCalculator.calculatePaymentPlan(debts, monthlyPayment, strategy, 0)`
- `withBonus = DebtCalculator.calculatePaymentPlan(debts, monthlyPayment, strategy, [bonusAmount])`
  (an array stimulus applies `bonusAmount` in month 1 only — `monthlyStimulus[month-1] || 0`
  naturally falls back to 0 for every later month since the array has length 1).
- `interestSaved = baseline.summary.totalInterest - withBonus.summary.totalInterest`
- `monthsSaved = baseline.paymentPlan.length - withBonus.paymentPlan.length`
- `freedMonthly` = sum of `minimumPayment` for every debt whose `paidOffMonth`
  is earlier in `withBonus.workingDebts` than in `baseline.workingDebts`
  (matched by debt `id`) — the monthly cash freed up sooner because that
  debt's minimum payment goes away earlier than it otherwise would have.
- `monthlyPayment` comes from the Plan page's configured value
  (`#monthlyPayment`) if it's already ≥ the sum of minimum payments;
  otherwise falls back to the sum of minimum payments (a "just pay minimums"
  baseline), so the advisor works even before the user has set up a Plan.

**Savings branch:**
- Always applicable (defaults to 0% if no rate is available).
- `rate` = the linked account's `interestRate` if the bonus is linked to an
  account with `interestRate > 0`; otherwise the highest `interestRate`
  among the user's accounts; otherwise `0`.
- `growth1yr = dailyCompoundInterest(bonusAmount, rate, 365)`
- `growth5yr = dailyCompoundInterest(bonusAmount, rate, 365 * 5)`
- When `rate === 0`, the panel says so explicitly rather than showing a
  misleading "$0.00 growth" with no context.

**DOM-input-driven entry point** (same file): `showBonusAdvice(app)` reads
the live bonus-form values (amount, selected account), reads
`app.debts`/`app.accounts`/the Plan page's strategy+payment inputs, calls
`calculateBonusAdvice`, and renders a result panel (`#bonusAdviceResult`)
styled like `strategy.js`'s existing `.target-result` panel — two side-by-side
cards, one per option, each showing its computed numbers or an "N/A: reason"
message when not applicable.

## UI (`index.html`, `income.js`)

- New `<select id="bonusPurpose">` in the bonus form grid, next to Category:
  `— Not decided —` (default/`null`) / `Cash Flow` / `Long-term Savings`.
- New `<button id="bonusAdviceBtn" type="button">💡 What should I do with this?</button>`
  next to the submit button, calling `app.showBonusAdvice()`. Disabled/no-op
  with an inline message if amount is missing or invalid (mirrors the
  existing `alert()`-based validation style used by `addBonus`).
- `#bonusAdviceResult` panel, hidden until first computed, matching the
  `target-result` visual pattern from the Plan page.
- `addBonus` / `saveEditBonus` read and persist `purpose`.
- `renderBonusList`: when `b.purpose` is set, render a small badge next to
  the existing category badge (`💰 Cash Flow` / `🐷 Savings`), same DOM
  pattern as the existing `catBadgeClass` lookup.
- Matching inline-edit field (`be-purpose-${id}`) in the edit card, following
  the existing `be-*` field-id convention.

## Persistence (`sanitizers.js`)

`sanitizeBonus` gains:
```js
purpose: (record?.purpose === 'cashFlow' || record?.purpose === 'savings') ? record.purpose : null
```
Additive optional field — no export format version bump needed (mirrors the
precedent set by `interestRate` in `2026-07-13-interest-income-design.md`).
Legacy files without the field sanitize to `null`.

## Styling (`styles-csp-classes.css`)

CSP forbids inline styles, so purpose badges (`.bonus-purpose--cashflow`,
`.bonus-purpose--savings`) and the advice panel (`.bonus-advice`,
`.bonus-advice-card`) are added as CSS classes toggled via `classList`,
following the existing badge-class pattern (`bonus-cat--*`).

## Documentation

- `CLAUDE.md` — add `bonusAdvisor.js` to the feature-module list.
- `CHANGELOG.md` (repo root) — new `## [x.y.z] — YYYY-MM-DD` entry for the
  feature, paired with an `APP_VERSION` bump in `src/utils.js` per
  `tests/features/test_versioning.py`'s sync requirement.

## Testing

Playwright/pytest, served at `http://localhost:5500/`.

**Features — positive** (new or extended `tests/features/test_income.py`):
- Set Purpose to Cash Flow on a bonus → persisted, badge shown in the bonus
  list.
- Set Purpose to Savings → persisted, badge shown.
- With at least one interest-bearing debt and a configured Plan payment:
  click "What should I do with this?" → advice panel shows non-zero
  `interestSaved`/`monthsSaved` for Cash Flow.
- With a bonus linked to an account that has a non-zero APY: advice panel
  shows non-zero 1yr/5yr savings growth using that account's rate.
- Editing an existing bonus preserves/updates its `purpose`.

**Features — negative:**
- No debts at all → Cash Flow panel shows "not applicable" (no crash, no
  `calculatePaymentPlan` exception surfaced to the user).
- Only fixed-amount debts (rent/subscriptions) → Cash Flow panel shows "not
  applicable" (fixed debts never receive stimulus, per
  `debtCalculator.js`).
- Bonus not linked to any account and no account has a rate → Savings panel
  shows the "no rate available" message, not a bare $0.00.
- Clicking the advice button with an empty/invalid amount → validation
  message, no computation attempted.

**Security / storage** (`tests/security/test_input_validation.py`,
`tests/features/test_storage_import.py`):
- Import a bonus with `purpose: "<script>alert(1)</script>"` or any value
  outside the allow-list → sanitizes to `null`.
- Export → import round-trip preserves a valid `purpose`.

## Alternatives considered

- **Auto-pick a "winner" and just show one recommended label** — rejected
  per the scope decision above: the two metrics aren't on comparable scales,
  and presenting a false single verdict would be worse than showing both.
- **Live recalculation on every keystroke** — rejected: no precedent
  elsewhere in the codebase, and re-running `calculatePaymentPlan` (which can
  iterate up to 600 months) on every keystroke is wasteful for a value the
  user only wants right before deciding.
- **Surface the Purpose badge in Ledger/Reports too** — rejected for this
  pass: those views only aggregate bonus totals today with no per-item
  render to attach a badge to; adding one would be a larger, separate UI
  change beyond what issue #64 asks for.
