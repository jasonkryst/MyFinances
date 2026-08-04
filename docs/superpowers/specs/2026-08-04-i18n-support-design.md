# i18n Support — Infrastructure + Pilot (Issue #35)

**Date:** 2026-08-04
**Issue:** [#35 i18n](https://github.com/jasonkryst/MyFinances/issues/35) (milestone V5.0.0)

## Summary

Issue #35 asks for i18n support app-wide. The app has ~40 feature modules and
hundreds of user-facing strings, all currently hardcoded English embedded in
template-literal `innerHTML` blocks — translating all of it is multiple
sessions of work on its own. This change builds the i18n **framework** (locale
storage, string lookup with fallback, a language switcher, locale-aware
number/date formatting) and translates a **pilot slice** — navigation, the
toolbar, the Settings modal, and the full Health dashboard — into Spanish
(`es`) and Polish (`pl`). Remaining pages stay English and get translated
incrementally in follow-up issues; the pattern established here is what
they'll follow.

## Decisions

| Question | Decision |
|---|---|
| Scope | Infrastructure + pilot (nav/toolbar/Settings/Health → es, pl). Not a full-app translation. |
| Pilot languages | Spanish (`es`) and Polish (`pl`) — chosen by the user for accent/pluralization coverage (es) and layout-stressing compound words + non-Romance grammar (pl). |
| Locale detection | No browser-language auto-detection. Defaults to English; user picks explicitly via Settings. Keeps first-run behavior unchanged and avoids surprising an existing user with a language flip after this ships. |
| Where the locale *preference* lives | Directly in `localStorage` under its own key (`debtTrackerLocale`), independent of `app.storageAdapter` — same reasoning as the existing `debtTrackerTheme`/`debtTrackerStorageBackend` keys: it's a device display preference, not financial data, and must survive even if the user is on the session-storage backend. |
| Static markup translation | `data-i18n="key"` attributes on elements in `index.html`, applied via `textContent` (never `innerHTML`) — no CSP/escaping concerns since dictionaries are static bundled JS, not user input. |
| Dynamic content translation | Pilot page (`renderHealthDashboard`) calls `t()` directly when building its template literal, same as it already calls `formatCurrency`/`escapeHtml`. |
| Missing-translation fallback | `t()` falls back to the English string, and if even English is missing, falls back to the raw key — a typo or partial translation never crashes the UI or shows `undefined`. |
| Pluralization | Not implemented. Reviewing the actual pilot strings, none need a number to change which word form is used (e.g. "months remaining" always uses the same word regardless of count) — `t()` supports `{var}` interpolation so a number can be placed correctly per language word order, but each string is a single fixed form. Polish grammatically needs 3+ plural forms for count-sensitive nouns; using one fixed form is a known, documented limitation rather than solved here. |
| Number/date formatting | `formatCurrency`/`formatShortDate`/`formatMonthYear` in `utils.js` swap their hardcoded `'en-US'` `Intl` locale argument for `getCurrentLocale()`. No call-site changes anywhere in the app — this makes digit grouping/decimal separators/date order locale-correct app-wide immediately, beyond just the translated pilot pages. Currency stays USD (no multi-currency support); only formatting conventions change. |

## Architecture

### New locale dictionaries: `src/locales/{en,es,pl}.js`

Flat, dot-keyed string maps, e.g.:

```js
// src/locales/en.js
export default {
    'nav.health': 'Health',
    'nav.accounts': 'Accounts',
    // ...
    'settings.language': 'Language',
    'health.dtiTitle': 'Debt-to-Income Ratio',
    // ...
};
```

`en.js` is the canonical/fallback dictionary — every key that exists anywhere
must exist there. `es.js`/`pl.js` only need the pilot-scope keys; any key
absent from them falls back to English.

### New module: `src/i18n.js`

```js
export const LOCALES = [
    { code: 'en', name: 'English' },
    { code: 'es', name: 'Español' },
    { code: 'pl', name: 'Polski' },
];
export const LOCALE_PREF_KEY = 'debtTrackerLocale';

export function getLocalePreference() { /* reads localStorage directly, validates against LOCALES, defaults 'en' */ }
export function setLocalePreference(code) { /* writes localStorage directly */ }
export function getCurrentLocale() { /* cached current code, initialized from getLocalePreference() */ }

export function t(key, vars) { /* look up key in current dict -> en dict -> key itself; supports {var} interpolation */ }

export function applyStaticTranslations(root = document) { /* walks [data-i18n] under root, sets textContent = t(key) */ }

export function setLocale(app, code) {
    /* validate, persist, update cached current locale, applyStaticTranslations(),
       and re-render the Health page if it's currently the active section */
}
```

`utils.js` imports `getCurrentLocale` from `i18n.js` (one-directional
dependency — `i18n.js` itself imports nothing from `utils.js`).

### `index.html` / static markup

- Nav buttons and group labels (`Health`, `Accounts`, ... `Overview`,
  `Manage`, `Analyze`), toolbar labels, and the Settings modal's text/labels
  gain `data-i18n="..."` attributes.
- Settings modal gains a new control, following the existing Data Storage
  `form-group` pattern exactly:
  ```html
  <div class="form-group modal-form-group">
      <label for="settingLocale" data-i18n="settings.language">Language</label>
      <select id="settingLocale">
          <option value="en">English</option>
          <option value="es">Español</option>
          <option value="pl">Polski</option>
      </select>
      <p class="modal-helper-text" data-i18n="settings.languageHelp">
          Translation is still expanding — some pages may remain in English.
      </p>
  </div>
  ```

### `setupWizard.js` (`initSettingsModal`)

- `open()` initializes `localeSelect.value = getCurrentLocale()`, mirroring
  how `storageSelect.value` is initialized from `getStorageBackendPreference()`.
- `save()` calls `setLocale(app, localeSelect.value)` alongside the existing
  `switchStorageBackend` call.

### `app.js`

- On `DOMContentLoaded`, after `window.app` is constructed, call
  `applyStaticTranslations()` once so the initial page reflects any
  previously-saved locale preference before first paint of translated
  regions.

### `health.js`

- `renderHealthDashboard` imports `t` from `i18n.js` and replaces its
  hardcoded English strings (card titles, descriptions, badge labels, empty
  states, link text) with `t('health.xxx')` calls. Status-label helper
  functions (`dtiStatus`, `savingsStatus`, etc.) return a translation key
  instead of a literal label string; the caller does `t(key)`.

### `utils.js`

- `formatCurrency`, `formatShortDate`, `formatMonthYear`: replace the
  hardcoded `'en-US'` argument to `Intl.NumberFormat`/`toLocaleDateString`
  with `getCurrentLocale()`.

## Data flow

1. App boots → `getLocalePreference()` reads `debtTrackerLocale` from
   `localStorage` (default `'en'` if absent or invalid) → cached as the
   current locale.
2. `applyStaticTranslations()` runs once at startup, translating nav/toolbar/
   Settings-modal text already in the DOM.
3. `renderHealthDashboard()` (called on load if Health is the active page,
   and on every subsequent page switch to Health) calls `t()` for its
   strings, and `formatCurrency`/`formatShortDate`/`formatMonthYear` pick up
   the current locale automatically.
4. User changes the language selector in Settings → `setLocale(app, code)` →
   persists preference → re-applies static translations → re-renders Health
   if active. No reload required.

## Out of scope

- Translating any page besides Health (Accounts, Income, Liabilities,
  Recurring, Savings, Plan, Reports, Ledger, Reconcile stay English pilot
  strings — tracked as follow-up issues).
- Browser-language auto-detection on first run.
- Grammatical pluralization (Polish needs 3+ number-agreement forms for some
  nouns) — every translated string uses one fixed form regardless of count.
- Multi-currency support — only formatting conventions (grouping/decimal
  separator/symbol placement) change per locale; the currency itself stays
  USD.
- RTL layout support (not needed for es/pl).

## Testing

New `tests/features/test_i18n.py` (Playwright, following
`test_storage_backend.py`'s conventions):

**Positive**
- Settings modal exposes a language `<select>` with `en`/`es`/`pl` options.
- Switching to `es` translates nav labels and Health page card titles live
  (no reload).
- Switching to `pl` does the same.
- Locale preference persists across a page reload (`debtTrackerLocale` in
  `localStorage`, and the UI reflects it on next load).
- `formatCurrency`/date output changes with locale (e.g. decimal/group
  separator differs between `en` and `pl` output for the same value) —
  asserted structurally (separator character present/absent) rather than an
  exact string match, since exact ICU output can shift across environments.

**Negative**
- A tampered `debtTrackerLocale` value (e.g. `"xx-INVALID"`) in `localStorage`
  before load falls back to English rendering without throwing/crashing.
- A missing translation key falls back to the English string rather than
  showing a raw key or blank text.
- An untranslated page (e.g. Accounts) stays fully readable in English when
  the locale is `es`/`pl` — no broken/missing text.

## Documentation updates

- `CLAUDE.md`: new "Internationalization" note under Architecture describing
  `i18n.js`, `src/locales/`, the `data-i18n` pattern, and the pilot scope.
- `README.md`: short blurb under Features noting language support (en/es/pl)
  and pilot scope.
- `CHANGELOG.md`: new entry under a `## [4.10.0]` heading.
- `src/utils.js`: bump `APP_VERSION` `'4.9.0'` → `'4.10.0'` (minor — new
  feature, no breaking change), matching the changelog entry per
  `tests/features/test_versioning.py`.
