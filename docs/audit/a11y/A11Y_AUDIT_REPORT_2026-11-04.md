# MyFinances Accessibility (A11y) Audit Report — 2026-11-04

**Standard:** WCAG 2.1 AA
**Date:** 2026-11-04
**App version:** 7.0.0 (`main` @ `3d156a1`, PR #458 "PostgreSQL-only storage")
**Prior report:** [`A11Y_AUDIT_REPORT_2026-10-06.md`](./A11Y_AUDIT_REPORT_2026-10-06.md)

**Scope:** The UI surfaces added or changed by v7.0.0 (`git diff 13c72cd..3d156a1`), audited in the live app:

1. `#serverUnreachableGate` ("Can't reach your server", Try again, status line), `src/serverUnreachableGate.js`
2. `#syncErrorBanner` + `#syncErrorBannerDismiss`, `src/ui.js` `showSyncErrorBanner`
3. `#pgMigrationModal`: the import variant (empty server), the cleanup variant (server has data), and the failed-import error, `src/pgMigrationModal.js`
4. `#loginGate`: sign-in mode, setup mode, and mid-session re-login after a 401 (shared `requestLogin`), `src/loginGate.js`
5. Settings: `#settingStorageInfo` on Data & Storage, and the always-shown change-password form on Security
6. The account-menu logout item (`#accountMenuLogoutBtn`), now always visible
7. A regression sweep of the 11 main pages on the real stack, in light and dark themes

**Method.** All checks ran against the local Docker stack at `http://localhost:32901/` (nginx + Node + Postgres), signed in as the test user. Each surface was triggered the same way the feature tests trigger it: `/api/plan-settings` aborted, a 500 or abort on a POST, a 401 on a POST, and `localStorage.debtTrackerData` seeded.

| Tool | Ran? | What it covered |
|---|---|---|
| **axe-core 4.14.0** (`npm pack axe-core`, injected into a Playwright context with `bypass_csp=True`, tags `wcag2a/wcag2aa/wcag21a/wcag21aa`) | Yes | Each v7 surface with it open, the whole document behind each gate, and all 11 pages in light and dark |
| **`tests/a11y/run_a11y_audit.py`** (built-in DOM audit) | Yes | 11 pages, light and dark, mobile nav, 3 modals, `guide.html` |
| **pytest** `tests/a11y/test_a11y_audit.py`, `tests/ui/test_accessibility.py`, `tests/ui/test_aria_labels.py` | Yes | **79 passed**, 0 failed (209 s) |
| **Custom Playwright driver** (throwaway, scratchpad only) | Yes | Contrast from computed styles, with alpha and gradient stops resolved. Also: Tab and Shift+Tab walks, Enter/Space/Escape, focus on open and close, outline styles, Chrome AX tree through CDP (names, descriptions), target sizes at 390 px, reflow at 320 px and 640 px (≈200% of 1280), `prefers-reduced-motion: reduce` emulation, and the es/pl locales |
| Screen reader (NVDA/VoiceOver) | **No** | The "announced as" column is **inferred** from role, name, description and live-region attributes in the AX tree, not heard |
| Lighthouse | No | Not run this cycle |

Raw output from every automated run: [`raw_findings_2026-11-04.json`](./raw_findings_2026-11-04.json). It holds the DOM audit, the per-surface driver results, the axe results for every page, and the spot checks.

**Labels used below:** **Measured** means the value came from the live DOM. **Code** means it was read from source. **Inferred** means it is reasoned from attributes and was not observed.

**No application code or tests were changed as part of this audit.**

---

## Summary

**21 issues: 🔴 Critical 0 · 🟡 Major 7 · 🟢 Minor 14.**

- **16 issues are in the v7 surfaces:** 4 Major and 12 Minor.
- **5 issues are pre-existing**, found by the first axe sweep of the main pages: 3 Major and 2 Minor. None of them comes from v7 (`git diff 13c72cd..3d156a1 -- styles.css` does not touch those rules).

| Surface | Result |
|---|---|
| `#serverUnreachableGate` | Good role/name/description: `alertdialog`, named by its title, described by its body. Focus moves to Try again, and the status line is `role=status`. **No focus containment (#464 confirmed).** Missing `lang` in es/pl. |
| `#syncErrorBanner` | `role=alert`, contrast 4.83:1, and it does not steal focus. After dismiss, focus stays on the hidden button. The dismiss target is 19×19 px on desktop, and a repeat failure is not re-announced (inferred). |
| `#pgMigrationModal` (import and cleanup) | Focus moves to the primary button, and Escape closes the modal. **No focus containment (#464 confirmed).** **A failed import drops focus to `<body>`.** **The error text fails contrast in dark mode (3.03:1).** The description is not linked with `aria-describedby`. |
| `#loginGate` (sign-in, setup, mid-session) | Labels are good, focus goes to Email, the strength meter is linked by `aria-describedby`, and errors use `role=alert`. **No focus containment (#464 confirmed).** **In dark mode, error text (3.03:1) and the "Forgot password?" link (2.83:1) fail contrast.** After a mid-session sign-in, focus goes to `<body>`. |
| Settings → Data & Storage / Security | `#settingStorageInfo` is plain text at 14.6:1, and no orphan label is left over from the removed `<select>`. All three password fields are labelled and have `autocomplete`. **The dark-mode error fails contrast (3.03:1).** The Settings modal still has no Tab trap (N5 is still open). |
| Account menu → Sign Out | Visible, 4.83:1 in light and 5.29:1 in dark, and 40 px tall on mobile. The `role=menu` widget has no arrow-key support, and Escape leaves focus on the hidden item. The text is untranslated in es/pl. |
| Whole app, es/pl | **`<html lang>` stays `"en"` in Spanish and Polish** (3.1.1, Level A). |
| Main-page regression (axe, light and dark) | No v7 regressions. axe found 4 pre-existing issue groups (P4–P6, O8). The DOM audit and the 79 pytest checks are clean. |
| Reflow (320 px, 640 px), reduced motion | Pass on every v7 surface: no horizontal scroll, no clipped text, and transitions collapse to 1e-05 s. |

---

## Findings

### Perceivable

| # | Issue | Surface | WCAG criterion | Severity | Evidence | Recommendation |
|---|---|---|---|---|---|---|
| P1 | Error text is `#dc2626` on the dark card `#1e293b`. Dark mode never overrides `--danger-color`. | Login gate, migration modal (failed import), Settings → Security | 1.4.3 Contrast (Minimum) | 🟡 Major | **Measured** 3.03:1 for `#loginGateError`, `#pgMigrationError` and `#settingsChangePasswordError` (14 px, normal weight). `styles.css:8383` `.login-gate-error` and `styles.css:8482` `.pg-migration-error` use `var(--danger-color)`. The `body.dark-mode` block (`styles.css:855`) sets no `--danger-color`. | Add `--danger-color: #f87171` to `body.dark-mode`, or add dark overrides for these two classes. Logout already uses `#f87171` at 5.29:1. |
| P2 | The "Forgot password?" link is `#2563eb` on `#1e293b`. Dark mode never overrides `--primary-color`. | Login gate | 1.4.3 | 🟡 Major | **Measured** 2.83:1 (14 px, weight 500). `.link-btn` is at `styles.css:8418`. | Set `color: #60a5fa` (5.75:1) for `body.dark-mode .link-btn`, or define a dark `--primary-color` for text use. |
| P3 | The focus indicator on login inputs in dark mode is a 1 px border change to `#2563eb` plus an 18%-alpha halo. | Login gate | 1.4.11 Non-text Contrast (focus state) | 🟢 Minor | **Measured** focused border `#2563eb` against card `#1e293b` is 2.83:1. The halo blends to `#1f335b`, 1.17:1. Light mode passes, with the border at 5.17:1 against white. Rule: `styles.css:8374`. | Use a dark-mode focus colour of at least 3:1 (for example `#60a5fa`), or a 2 px solid outline. |
| P4 | *(pre-existing)* Inactive Reports tab-group labels ("Trends", "Planning", "Print") have `opacity: 0.55` on 10 px text. | Reports page | 1.4.3 | 🟡 Major | **Measured** (axe, confirmed by computed opacity): 2.33:1 in light (`#87a9f4` effective on `#fff`) and 3.0:1 in dark. Rule: `styles.css:5368–5380`. | Drop the opacity dimming and show the active group another way, such as weight, background or border. |
| P5 | *(pre-existing)* Positive amounts in light mode are `#059669` on white or `#f8fafc`. | Accounts (`.acct-balance--pos`), Income (`.income-card-amount`, `.bonus-card-amount`), Recurring (`.recurring-amount--pos`) | 1.4.3 | 🟡 Major | **Measured** (axe): 3.77:1 on `#fff` and 3.6:1 on `#f8fafc` (16–17.6 px bold, which is not large text). Rules: `styles.css:6525`, `6817`, `4217`. Dark mode passes. | Use `#047857` (≈5.5:1 on white). |
| P6 | *(pre-existing)* `.strategy-net-breakdown` has `opacity: 0.8`. | Plan page | 1.4.3 | 🟢 Minor | **Measured** (axe): 4.3:1 (`#2f7e66` on `#d1fae5`, 12.5 px). Rule: `styles.css:4841`. | Remove the opacity, or darken the text. |

### Operable

| # | Issue | Surface | WCAG criterion | Severity | Evidence | Recommendation |
|---|---|---|---|---|---|---|
| O1 | **No focus containment (#464 confirmed).** Tab leaves the overlay and walks the app behind it. The app shell is neither `inert` nor `aria-hidden`, so focus lands on controls the full-page overlay hides. | `#serverUnreachableGate`, `#loginGate` (all three modes), `#pgMigrationModal` (both variants) | 2.4.3 Focus Order; 2.4.7 Focus Visible (focus goes to hidden controls) | 🟡 Major | **Measured** Tab sequences. Gate: Try again → `<body>` → skip link → `#commandPaletteBtn` → … Login: Email → Password → Sign In → Forgot → `<body>` → skip link → … Migration: Transfer → Skip → `<body>` → skip link → … Shift+Tab from Try again reaches `#incomeTrendYoYToggle`. `.container.inert === false` and `aria-hidden` is unset in every case. The CDP AX tree still exposes 20 buttons while the gate is up. | Fix under #464: set `inert` on `.container` (and on other overlays) while a gate or this modal is open, or add the Tab-cycling handler already used by `showDeleteConfirmModal()`. `inert` also hides the background from screen readers, which `aria-modal` alone does not do reliably. |
| O2 | When a legacy import fails, focus is lost. The focused Transfer button is disabled while loading. After the failure it is re-enabled but not focused again, so focus falls to `<body>`, and the next Tab leaves the modal (see O1). | `#pgMigrationModal`, import failure | 2.4.3 | 🟡 Major | **Measured** `document.activeElement` is `BODY` after the error appears. Code: `src/pgMigrationModal.js:125` (`setLoading` disables the button), and the catch block re-enables it without calling `focus()`. | After `setLoading(false)` in the catch, call `els.transferBtn.focus()`, or focus the error message with `tabindex="-1"`. Keeping the button enabled with `aria-disabled` also works. |
| O3 | After a mid-session re-login, focus goes to `<body>` instead of returning to where the user was (the debt form submit that hit the 401). | `#loginGate`, mid-session | 2.4.3 | 🟢 Minor | **Measured** `activeElement` is `BODY` after a successful sign-in. Code: `src/loginGate.js:249–252` hides the gate and saves no prior focus. | In `requestLogin`, save `document.activeElement` before showing the gate and restore it when the promise resolves. |
| O4 | After Dismiss, focus stays on the now-hidden dismiss button. | `#syncErrorBanner` | 2.4.3 | 🟢 Minor | **Measured** `activeElement` is still `#syncErrorBannerDismiss` inside the `display:none` banner. Code: `src/ui.js:34`. | Before hiding the banner, move focus to `#main` (`tabindex="-1"`) or to the previously focused element. |
| O5 | The dismiss "×" is 19.2 × 19.2 px on desktop and 19.2 × 40 px on mobile, where the global `min-height: 40px` rule applies. | `#syncErrorBanner` | 2.5.5 Target Size (AAA; WCAG 2.2 2.5.8 is 24 px). **Not a 2.1 AA failure.** | 🟢 Minor | **Measured** rect. Rule: `styles-csp-classes.css:518` (`padding: 0 4px`, `font-size: 1.2rem`). | Use `min-width`/`min-height: 24px` (44 px on coarse pointers). |
| O6 | The account menu uses `role="menu"` and `role="menuitem"` but not the menu keyboard model. Opening it does not move focus in, ArrowDown does nothing, and Tab runs through the items and on into the page. Escape closes the menu but leaves focus on the hidden item. The menu now always includes Sign Out. | Account menu | 2.1.1 Keyboard (expected arrow keys); 4.1.2 Name, Role, Value; 2.4.3 | 🟢 Minor | **Measured** focus stays on `#accountMenuBtn` after Enter and after ArrowDown. After Escape: dropdown hidden, `activeElement = #accountMenuLogoutBtn`. Markup: `index.html:70`. Code: `src/ui.js:639`. | Either implement the APG menu-button pattern (focus the first item, Arrow/Home/End, Escape returns focus to `#accountMenuBtn`), or drop `role=menu/menuitem` and keep plain buttons in a disclosure. In both cases, Escape should focus `#accountMenuBtn`. |
| O7 | *(carried over, N5)* The Settings modal has no Tab trap. Tab goes from Done to `<body>`, the skip link and the toolbar, and Escape then does nothing because the key handler is on the modal. This now covers the always-shown Security form. | Settings → Data & Storage / Security | 2.4.3 | 🟢 Minor | **Measured**: Done → `BODY` → skip link → `#commandPaletteBtn`. Code: `src/setupWizard.js:105–110` (`onkeydown` handles Escape only). | Add the shared Tab-cycling block, or use `inert` (see O1). |
| O8 | *(pre-existing)* The accessible name does not contain the visible label. | Accounts "See breakdown" (name "See balance breakdown for X"), Liabilities "Accelerate this debt →" (name "Accelerate debt X"), Recurring Overdue filter, Reports calendar day cells | 2.5.3 Label in Name (A) | 🟢 Minor | **Measured** (axe `label-content-name-mismatch`): 4 + 1 + 1 + 6 nodes. Code: `src/accounts.js:361`, `src/debtBreakEven.js:84`, `src/recurring.js:225`, `src/reportsCalendar.js:129`. | Start each `aria-label` with the visible text, for example "See breakdown: X balance" or "Accelerate this debt: X". That matches the #331 convention. |

### Understandable

| # | Issue | Surface | WCAG criterion | Severity | Evidence | Recommendation |
|---|---|---|---|---|---|---|
| U1 | **`<html lang>` is never updated.** It stays `"en"` while the whole UI is Spanish or Polish, so screen readers read Spanish and Polish text with English pronunciation rules. | Whole app, including every v7 surface | 3.1.1 Language of Page (A) | 🟡 Major | **Measured** `document.documentElement.lang === "en"` with locale `es` and with locale `pl`, on the gate, the banner, the migration modal, the login gate and the app. Code: `index.html:3` hard-codes `lang="en"`, and no `src/` file sets `documentElement.lang`. | In `setLocale()` and at startup, set `document.documentElement.lang = getCurrentLocale()`. Add an assertion to `tests/features/test_i18n_coverage.py`. |
| U2 | The account-menu items, including the now always-visible **Sign Out**, and the `aria-label="Account menu"` on `#accountMenuBtn` are hard-coded English. | Account menu (es/pl) | 3.1.2 Language of Parts (it becomes a failure once U1 is fixed); i18n | 🟢 Minor | **Measured** in es and pl: "Sign Out", "Settings", "Account menu". Markup: `index.html:70–98` has no `data-i18n`. | Add `data-i18n` / `data-i18n-attr` keys in all three locales, and add the account menu to `TRANSLATED_PAGES`. |
| U3 | Login and change-password errors are not linked to their fields: no `aria-invalid` and no `aria-describedby`. The `role=alert` text is announced, so 3.3.1 is met. A user who goes back to the field does not hear the error again. | Login gate, Settings → Security | 3.3.1 Error Identification (advisory); 1.3.1 | 🟢 Minor | **Measured** `aria-invalid` and `aria-describedby` are `null` on `#loginGatePassword` after "Invalid email or password." and on `#settingsConfirmPassword` after "Passwords do not match." | Set `aria-invalid="true"` on the field at fault and add the error's id to its `aria-describedby`. |

### Robust

| # | Issue | Surface | WCAG criterion | Severity | Evidence | Recommendation |
|---|---|---|---|---|---|---|
| R1 | The modal has `aria-labelledby` but no `aria-describedby`. Focus lands on the first button, so the description (which explains that declining downloads a backup and then **removes** the browser copy) is likely not read on open. | `#pgMigrationModal` | 4.1.2; 1.3.1 | 🟢 Minor | **Measured** `aria-describedby = null` (`index.html:1644–1645`). The "not read" part is **inferred** (no screen-reader run). | Add `aria-describedby="pgMigrationDescription pgMigrationCounts"`. |
| R2 | The login dialog's accessible name is "MyFinances", taken from the brand `<h1>`, and it has no description. Its purpose (sign in or create an account) is not part of the dialog announcement, especially mid-session, when it appears over the app. | `#loginGate` | 2.4.6 Headings and Labels; 4.1.2 | 🟢 Minor | **Measured** CDP AX: `dialog`, name "MyFinances", `describedby` none. **Inferred** announcement: "MyFinances, dialog". | Add `aria-describedby="loginGateSubtitle"`. The subtitle already switches between "Sign in to your account" and "Create your account". |
| R3 | The error regions combine `role="alert"` (implicitly assertive) with `aria-live="polite"`. The politeness conflicts, and screen readers resolve it differently. | `#loginGateError`, `#loginGateForgotError`, `#loginGateResetError`, `#pgMigrationError`, `#settingsChangePasswordError` | 4.1.3 Status Messages | 🟢 Minor | **Measured** attributes (`index.html:1593`, `1606`, `1624`, `1652`). The difference in behaviour is **inferred**. | Keep `role="alert"` and drop `aria-live="polite"`, or the reverse. |
| R4 | A second save failure while the banner is already shown makes no DOM change, so it is not announced. When a legacy import fails, two alerts (`#pgMigrationError` and `#syncErrorBanner`) fire together. | `#syncErrorBanner` | 4.1.3 | 🟢 Minor | **Code**: `src/ui.js:1323`, where `showSyncErrorBanner()` only removes `.hidden`. **Measured**: banner visible together with `#pgMigrationError` after a failed import. The announcement effect is **inferred**. | Re-insert or refresh the text node on each call, or clear it and set it again after a tick. Consider suppressing the banner while the migration modal shows its own error. |

---

## Colour contrast (measured, computed styles; gradients use the worst stop; alpha blended)

| Element | FG | BG | Ratio | Required | Pass | Theme |
|---|---|---|---|---|---|---|
| `#serverUnreachableTitle` (25.6 px bold) | #ffffff | #2563eb→#1d4ed8 | 5.17 | 3.0 | ✅ | light |
| `#serverUnreachableTitle` | #ffffff | #111827→#1e293b | 14.63 | 3.0 | ✅ | dark |
| `#serverUnreachableBody` | #1e293b | #ffffff | 14.63 | 4.5 | ✅ | light |
| `#serverUnreachableBody` | #f1f5f9 | #1e293b | 13.35 | 4.5 | ✅ | dark |
| `#serverUnreachableRetryBtn` | #ffffff | #2563eb | 5.17 | 4.5 | ✅ | light |
| `#serverUnreachableRetryBtn` | #f1f5f9 | #334155 | 9.45 | 4.5 | ✅ | dark |
| `#serverUnreachableStatus` (14.4 px) | #64748b | #ffffff | 4.76 | 4.5 | ✅ | light |
| `.sync-error-banner-text` / dismiss | #ffffff | #dc2626 | 4.83 | 4.5 | ✅ | light + dark (fixed colours) |
| `#syncErrorBannerDismiss` focus ring (`auto`) | #101010 | #dc2626 | 3.94 | 3.0 | ✅ | light + dark |
| `#pgMigrationTitle` | #1e293b / #f1f5f9 | #ffffff / #1e293b | 14.63 / 13.35 | 3.0 | ✅ | light / dark |
| `#pgMigrationDescription`, `#pgMigrationCounts` | #64748b / #94a3b8 | #ffffff / #1e293b | 4.76 / 5.71 | 4.5 | ✅ | light / dark |
| `#pgMigrationTransferBtn` | #ffffff / #f1f5f9 | #15803d / #334155 | 5.02 / 9.45 | 4.5 | ✅ | light / dark |
| `#pgMigrationSkipBtn`, `#pgLegacyRemoveBtn` | #1f2937 / #e2e8f0 | #e2e8f0 / #334155 | 11.91 / 8.40 | 4.5 | ✅ | light / dark |
| `#pgLegacyDownloadBtn` | #ffffff / #f1f5f9 | #2563eb / #334155 | 5.17 / 9.45 | 4.5 | ✅ | light / dark |
| `#pgMigrationError` | #dc2626 | #ffffff | 4.83 | 4.5 | ✅ | light |
| **`#pgMigrationError`** | #dc2626 | #1e293b | **3.03** | 4.5 | ❌ (P1) | dark |
| `#loginGateTitle` | #ffffff | #2563eb→#1d4ed8 / #111827→#1e293b | 5.17 / 14.63 | 3.0 | ✅ | light / dark |
| `#loginGateSubtitle` | #64748b / #94a3b8 | #ffffff / #1e293b | 4.76 / 5.71 | 4.5 | ✅ | light / dark |
| Login labels | #1e293b / #f1f5f9 | #ffffff / #1e293b | 14.63 / 13.35 | 4.5 | ✅ | light / dark |
| `#loginGateSubmit` | #ffffff / #f1f5f9 | #2563eb / #334155 | 5.17 / 9.45 | 4.5 | ✅ | light / dark |
| `#loginGateForgotBtn` | #2563eb | #ffffff | 5.17 | 4.5 | ✅ | light |
| **`#loginGateForgotBtn`** | #2563eb | #1e293b | **2.83** | 4.5 | ❌ (P2) | dark |
| `#loginGateError` | #dc2626 | #ffffff | 4.83 | 4.5 | ✅ | light |
| **`#loginGateError`** | #dc2626 | #1e293b | **3.03** | 4.5 | ❌ (P1) | dark |
| Login input focus border | #2563eb | #ffffff | 5.17 | 3.0 | ✅ | light |
| **Login input focus border** | #2563eb | #1e293b | **2.83** | 3.0 | ❌ (P3) | dark |
| `#settingStorageInfo` | #1e293b / #f1f5f9 | #ffffff / #1e293b | 14.63 / 13.35 | 4.5 | ✅ | light / dark |
| **`#settingsChangePasswordError`** | #dc2626 | #1e293b | **3.03** | 4.5 | ❌ (P1) | dark |
| `#settingsNewPasswordStrength` / hint | #f1f5f9 / #a8b3c7 | #1e293b | 13.35 / 6.92 | 4.5 | ✅ | dark |
| `#accountMenuLogoutBtn` | #dc2626 | #ffffff | 4.83 | 4.5 | ✅ | light |
| `#accountMenuLogoutBtn` | #f87171 | #1e293b | 5.29 | 4.5 | ✅ | dark |
| **`.rpt-tab-group-label` (inactive)** | #87a9f4 (effective) | #ffffff | **2.33** | 4.5 | ❌ (P4, pre-existing) | light |
| **`.rpt-tab-group-label` (inactive)** | #3c659c (effective) | #0f172a | **3.00** | 4.5 | ❌ (P4, pre-existing) | dark |
| **`.acct-balance--pos`, `.recurring-amount--pos`** | #059669 | #ffffff | **3.77** | 4.5 | ❌ (P5, pre-existing) | light |
| **`.income-card-amount`, `.bonus-card-amount`** | #059669 | #f8fafc | **3.60** | 4.5 | ❌ (P5, pre-existing) | light |
| **`.strategy-net-breakdown`** | #2f7e66 | #d1fae5 | **4.30** | 4.5 | ❌ (P6, pre-existing) | light |

---

## Keyboard navigation (measured)

| Element | Tab order | Enter / Space | Escape | Arrows |
|---|---|---|---|---|
| `#serverUnreachableGate` | Focus moves to Try again on open ✅. The next Tab leaves the gate for `<body>` and the hidden toolbar ❌ (O1, #464). | Both trigger Retry ✅. Focus returns to Try again after a failed retry ✅. | No effect (blocking gate; acceptable) | n/a |
| `#syncErrorBanner` | Not focused on show (correct for `role=alert`) ✅. Dismiss is in DOM order at the end of the page. | Enter dismisses ✅ | Does not dismiss (acceptable) | n/a |
| `#syncErrorBannerDismiss` after dismiss | Focus stays on the hidden button ❌ (O4) | — | — | — |
| `#pgMigrationModal` import | Focus moves to Transfer on open ✅. Then Skip, then out to `<body>` ❌ (O1). | Enter starts the transfer ✅. On failure focus falls to `<body>` ❌ (O2). | Closes and keeps the key ✅. No focus placement (no previous focus to return to at boot). | n/a |
| `#pgMigrationModal` cleanup | Focus moves to Download on open ✅. Then Remove, then out ❌ (O1). | ✅ | Closes ✅ | n/a |
| `#loginGate` sign-in | Focus moves to Email on open ✅. Then Password, Sign In, Forgot, and out ❌ (O1). | Enter in Password submits ✅, and the error keeps focus in the field ✅. | No effect (blocking; acceptable) | n/a |
| `#loginGate` setup | Email, Password, Confirm, Create Account, Forgot, then out ❌ (O1) | ✅ | — | n/a |
| `#loginGate` mid-session (401) | Focus moves to Email ✅. Then out ❌ (O1). After sign-in, focus goes to `<body>` ❌ (O3). | ✅ | — | n/a |
| Settings → Security form | Current, New, Confirm, Change password, Done, then out ❌ (O7) | Enter in Confirm submits, and the error is shown ✅ | Closes only while focus is inside the modal | n/a |
| Account menu | Enter opens but focus stays on the trigger. Tab goes through the six items, then into the page. | ✅ | Closes, but focus is left on the hidden item ❌ (O6) | Not supported ❌ (O6) |

**Visible focus:** every v7 button shows Chromium's `outline: auto` ring, which measures 19:1 on white cards and 3.94:1 on the red banner. Login inputs use a border plus halo, which fails in dark mode only (P3).

---

## Screen reader (inferred from the AX tree: role, name, description and live region; no AT was run)

| Element | Announced as | Issue |
|---|---|---|
| `#serverUnreachableGate` | "Can't reach your server, alert dialog. MyFinances keeps your data on your PostgreSQL server…" then "Try again, button" | None. The CDP AX tree confirms name and description. Background still exposed (O1). |
| `#serverUnreachableStatus` | Polite: "Still can't reach your server. Check your connection and try again." (`role=status`, text set after the click) | None |
| `#syncErrorBanner` | Alert: "Couldn't save your last change — check your connection. Reload to see what's saved." Dismiss: "Dismiss, button" (es "Descartar", pl "Zamknij") | Not re-announced on repeat failures (R4). Read in English voice under es/pl (U1). |
| `#pgMigrationModal` | "Transfer Your Local Data, dialog" (or "Old Browser Data Found, dialog"), then "Transfer Data, button" | Description not linked (R1) |
| `#pgMigrationError` | Alert: "Transfer failed. Check your connection and try again." | role/live conflict (R3). Fires alongside the sync banner (R4). |
| `#loginGate` | "MyFinances, dialog", then "Email, edit text" | Purpose missing from name and description (R2) |
| `#loginGateError` | Alert: "Invalid email or password." | Not linked to the field (U3). role/live conflict (R3). |
| Password strength (setup, Security) | Polite "Password strength: …" plus the hint, both linked by `aria-describedby` | None |
| `#settingStorageInfo` | Static text "Storage: PostgreSQL server" (es "Almacenamiento: servidor PostgreSQL") | None. Correctly no longer a form control. |
| `#accountMenuLogoutBtn` | "Sign Out, menu item" | English in es/pl (U2). Menu model not implemented (O6). |

---

## Automated tool results

**axe-core 4.14.0, v7 surfaces (scoped to the open surface):** **0 violations** on `#serverUnreachableGate`, `#syncErrorBanner`, `#pgMigrationModal` (both variants), `#loginGate` (sign-in and setup), `#settingsModal` (Data and Security tabs) and `#accountMenuWrap`. These were all light mode, so axe's pass does not cover P1–P3, which were found by the computed-style pass in dark mode. "Incomplete" results were all `color-contrast` checks axe could not resolve over gradient headers (checked by hand above) and `label-content-name-mismatch` on `×`/icon buttons.

**axe-core, main pages (light and dark):**

| Page | Light violations | Dark violations |
|---|---|---|
| Health, Savings, Ledger, Reconcile, Retirement | 0 | 0 |
| Accounts | color-contrast ×3 (P5), label-content-name-mismatch ×4 (O8) | label-content-name-mismatch ×4 |
| Income | color-contrast ×3 (P5) | 0 |
| Liabilities | label-content-name-mismatch ×1 (O8) | 0 (the accelerate button was not rendered in that run) |
| Recurring | color-contrast ×1 (P5), label-content-name-mismatch ×1 | label-content-name-mismatch ×1 |
| Plan (strategy) | color-contrast ×1 (P6) | 0 |
| Reports | color-contrast ×3 (P4), label-content-name-mismatch ×6 (O8) | color-contrast ×3 (P4), label-content-name-mismatch ×6 |
| `<header>` | 0 | 0 |

**`tests/a11y/run_a11y_audit.py`** (11 pages × light and dark, plus mobile, modals and guide):

| Check | Result |
|---|---|
| Orphaned inputs, unnamed interactive elements, images without alt, duplicate IDs | 0 on every page |
| Dangling ARIA references | 2 per page: `#spendingDrilldownModal` and `#acctBreakdownModal` → titles injected at open time. These are the known false positives (first noted June 2026). |
| Contrast | 3 per page in light mode, 1 per page in dark mode, all over the gradient header (ratio reported as 1.0 because the script reads the white fallback). These are the known false positives filtered by `test_site_wide_color_contrast`. |
| Mobile tap targets (< 44 px) | `#healthBudgetThresholdsBtn` 23×40, `#healthCardUtilToggle` 255×40, `#healthSurplusTxToggle` 183×40. AAA only. `#healthPrintBtn` (old F2) is no longer listed. |
| Mobile nav `aria-expanded` | false → true ✅ |
| Modal focus | Update Balance: focus moves to its input, Escape closes it. Amortization: focus moves to close, Escape closes it. The script's Reconcile probe did not open the modal on this stack (`modalHidden: true`), which is a script limitation since the lazy module did not load in time. The pytest focus-trap tests for Reconcile pass. |
| Landmarks | `index.html` and `guide.html`: `lang="en"`, one `<main>`, one `<nav>`, one `<h1>` |
| Console errors | 0 |

**pytest:** `tests/a11y/test_a11y_audit.py`, `tests/ui/test_accessibility.py`, `tests/ui/test_aria_labels.py` → **79 passed** against `:32901`.

---

## Passed checks

- **Gate role and name.** `#serverUnreachableGate` is `role="alertdialog"` with `aria-modal`, `aria-labelledby` and `aria-describedby`, and both targets exist and resolve in the AX tree.
- **Focus on open.** Every v7 overlay moves focus inside when it opens: Try again, Transfer or Download, and Email (or the reset password field).
- **Retry status.** The Retry status is `role=status` plus `aria-live=polite`. Its text is set after the click, so it is announced. Retry keeps focus on the button, and Enter and Space both work.
- **Sync banner.** It is `role=alert`, keeps its text in the DOM, and does not steal focus. Its dismiss button has a translated `aria-label` (en/es/pl), and contrast is 4.83:1.
- **Migration modal.** Counts and titles are translated (es/pl), with correct plurals. Escape works in both variants.
- **Login gate fields.** All fields have `<label for>`. `autocomplete` is `email`, `current-password` or `new-password` as appropriate. Setup mode links the strength meter and hint by `aria-describedby`, and the meter label is a polite live region. The meter is not attached in sign-in mode, as intended.
- **Errors announced.** Sign-in, forgot, reset, migration and change-password errors are in `role=alert` containers that exist before their text is set.
- **Settings → Data & Storage.** `#settingStorageInfo` is a static `<p>` with no leftover `label[for=settingStorageBackend]` and passes contrast at 14.63:1 and 13.35:1.
- **Settings → Security.** The three password fields are labelled, and the hidden `username` field supports password managers. The form is always shown on the Postgres-only build.
- **Logout item.** Visible, with contrast 4.83:1 in light and 5.29:1 in dark. It is 198 × 40 px at 390 px width, and the account-menu trigger is 44 × 44.
- **Light-mode contrast.** Every v7 surface passes AA in light mode, measured above.
- **Target sizes at 390 px.** Try again, Sign In, Transfer and Skip are all at least 48 px tall. Only the banner's × is under 24 px wide (O5).
- **Reflow.** At 320 px and at 640 px (≈200% zoom), `document.scrollWidth` equals the viewport for every gate, the modal and the banner, and no element sits outside it. The login gate scrolls vertically (`overflow-y: auto`), so Submit stays reachable. Settings → Security at 320 × 256 (≈400% zoom) shows no horizontal overflow.
- **Reduced motion.** With `prefers-reduced-motion: reduce` emulated, button transitions on the gates compute to 1e-05 s. The banner has no animation now, since the old toast's slide-in was removed in v7.
- **i18n.** All v7 strings render translated in es and pl. The account menu is the exception (U2), and `lang` is a separate failure (U1).
- **Main-page regression.** The DOM audit is clean (apart from known false positives), all 79 a11y pytest checks pass, and no axe violation is attributable to v7.

---

## Priority fixes

| Priority | Finding | WCAG | Effort |
|---|---|---|---|
| **P0** | O1 — focus containment for the gates and the migration modal (**#464**): set `inert` on `.container` | 2.4.3 / 2.4.7 | Low–Medium |
| **P0** | U1 — set `document.documentElement.lang` from the active locale | 3.1.1 (A) | Trivial |
| **P1** | P1 + P2 — dark-mode `--danger-color`, and a lighter link colour | 1.4.3 | Low (two or three CSS declarations) |
| **P1** | O2 — refocus Transfer, or the error, after a failed import | 2.4.3 | Trivial |
| **P1** | P4, P5 — pre-existing contrast (Reports group labels, positive-amount green) | 1.4.3 | Low |
| **P2** | O3, O4, O6, O7 — restore focus after re-login, after banner dismiss and after menu Escape; add a Settings Tab trap | 2.4.3 | Low |
| **P2** | R1, R2, U3 — `aria-describedby` on the migration modal and the login dialog; `aria-invalid` plus `aria-describedby` on fields with errors | 4.1.2 / 3.3.1 | Trivial |
| **P3** | P3, P6, O5, O8, U2, R3, R4 | various | Trivial–Low |

---

## Status of findings from the previous report (2026-10-06)

| Finding | Previous status | Status now | Evidence |
|---|---|---|---|
| N1 — 4 Reports canvases without sr-tables | Open | **Resolved** | `renderChartDataTable` is called for `rptIncomeChart` (`src/reportsCashFlow.js:229`), `rptOutflowChart` (`:262`), `rptMoneyFlowChart` (`:397`) and `rptNetWorthCompositionChart` (`src/reportsNetWorth.js:432`) |
| N2 — Ledger export, Mark-all-cleared, Calendar day and Spending drill-down modals without focus trap/restore | Open | **Resolved (code)** | `lastFocused` plus a Tab handler: `src/ledger.js:55/74` and `:100/122`, `src/reportsCalendar.js:197/209`, `src/spending.js:136–150` (trigger focus restore, Escape and Tab) |
| N3 — Reports panels missing `role="tabpanel"` | Open | **Resolved** | `index.html:1100+`: `role="tabpanel" aria-labelledby="rptTab-*"` |
| N4 — Strategy Schedule sub-tabs | Resolved (2026-10-27) | Resolved | `switchTab()` syncs `aria-selected` (`src/ui.js`) |
| N5 — Settings and Data Transfer modals without a Tab trap | Open | **Still open** (now O7) | **Measured** Tab escape from Settings. `src/setupWizard.js:105–110` and `src/dataTransferModal.js:34–39` handle Escape only. |
| N6 — month nav buttons named only by `title` | Resolved (2026-10-27) | Resolved | — |
| F1 — dark-mode nav-group-label contrast during page switch | Needs verification | **Not reproduced** | The DOM audit's dark-mode pass flagged only the gradient-header false positive, and axe found no nav-group-label violation on any page. A different label family, `.rpt-tab-group-label`, does fail (P4). |
| F2 — mobile Print button tap target (AAA) | Open | **Resolved** | `styles.css:794` sets `.page-print-btn { min-height: 44px; min-width: 44px }` at ≤768 px, and `#healthPrintBtn` is no longer in the DOM audit's undersized list |
| #464 — focus traps for the full-screen gates and the legacy-data modal | Filed | **Confirmed** (O1) | See O1 |

`docs/audit/a11y/A11Y_AUDIT_REPORT.md` still holds the 2026-09-02 text, and `tests/a11y/test_a11y_audit.py` refers to it for the F1 and gradient false-positive background. It was left unchanged.
