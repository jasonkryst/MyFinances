# App Routing Phase 1 (Router and Addresses) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every page, sub-tab and the Settings modal gets a real path address, so Back, Forward, refresh and bookmarks work.

**Architecture:** One new module, `src/router.js`, holds a pure route table (`parseLocation`/`buildPath`, unit-tested in Jest) plus thin History API glue. The view still changes only through the existing `switchPage`/sub-tab/Settings functions; each of them records its new view in the URL through the router, and `popstate`/boot parse the URL and drive those same functions with recording suppressed. The URL and the visible view therefore cannot disagree.

**Tech Stack:** Vanilla ES modules, no build step; Jest (`tests/unit`), Playwright pytest (`tests/ui`), nginx, service worker.

**Spec:** `docs/superpowers/specs/2026-11-25-app-routing-design.md` (phase 1 only; the tab bar and audit are later plans).

## Global Constraints

- Path addresses; `<base href="/">`; no nginx or CSP change (`nginx.conf:104` already falls back to `index.html`).
- The Ledger search term and all filters never reach the URL.
- Every export in `ui.js` stays a hoisted `function` declaration; `router.js` imports nothing from `ui.js`, `postgresSync.js`, `settingsNav.js` or any lazy module (it calls through `app.*` methods).
- `router.js` is statically imported (via `ui.js`), so it joins `sw.js` `PRECACHE_URLS` and must keep `tests/unit/firstPaintModules.test.js` green (`MAX_MODULES = 52`, `MAX_RAW_KB = 800`). If the budget fails, stop and report; do not raise it.
- Version: `APP_VERSION` 8.6.0 → **8.7.0** (minor): `CHANGELOG.md` entry, `sw.js` `CACHE_NAME` `myfinances-v8.7.0`, a `WHATS_NEW_ENTRIES` entry, with strings in `en.js`/`es.js`/`pl.js`.
- New Playwright file goes in a `ci.yml` shard (`test_ci_shard_coverage.py`).
- Local test recipes: Jest runs in Docker (memory `local-test-env-quirks`); Playwright needs the full stack, rebuilt after `src/` edits; one pytest process at a time.

## Review Focus

1. **Clicking the page or sub-tab you are already on** must not add a history entry (else Back appears to do nothing). Test in Task 3.
2. **Deep link to a lazy page before `appFeatures.js` has loaded**: the deferred render must not reset `/liabilities/expenses` to Debts. Test in Task 4.
3. **Closing Settings that was opened from a refreshed or bookmarked `?settings=` address** must not `history.back()` out of the app. Test in Task 5.
4. **Back/Forward never pushes**: applying a popped address records nothing, so Forward still works afterwards. Test in Task 3.
5. **Signed-out deep link**: the address survives the sign-in gate, and a `?reset_token=` link still reaches the reset form. Test in Task 3.

---

### Task 1: Pure route table

**Files:**
- Create: `src/router.js` (pure part only in this task)
- Test: `tests/unit/router.test.js`

**Interfaces:**
- Produces:
  - `ROUTE_SUB_TABS`: `{ liabilities: ['debts','expenses'], savings: ['emergency','sinking','home'], reports: ['calendar','forecast','incomeexp','moneyflow','networth','spending','summary','variance','yearreview'] }`
  - `DEFAULT_SUB_TAB`: `{ liabilities: 'debts', savings: 'emergency', reports: 'calendar' }`
  - `ROUTE_PAGES`: the 13 page names of `PAGE_SECTION_IDS` (`ui.js:790`).
  - `buildPath(view: { page: string, subTab?: string|null, settings?: string|null }) -> string` (path plus optional `?settings=`).
  - `parseLocation(pathname: string, search: string) -> { page, subTab: string|null, settings: string|null, canonical: boolean }`. `settings` is `null` (closed), `''` (open, no page) or a page name matching `/^[a-z]+$/` (the modal's own `showSettingsPage` falls back for unknown names). `canonical` is false whenever `buildPath(result)` differs from the input, so the caller replaces the address.

- [ ] **Step 1: Write the failing tests** in `tests/unit/router.test.js`:

```js
import { buildPath, parseLocation, ROUTE_PAGES, ROUTE_SUB_TABS } from '../../src/router.js';

test('health is the root', () => {
    expect(buildPath({ page: 'health' })).toBe('/');
    expect(parseLocation('/', '')).toEqual({ page: 'health', subTab: null, settings: null, canonical: true });
});
test('strategy lives at /plan', () => {
    expect(buildPath({ page: 'strategy' })).toBe('/plan');
    expect(parseLocation('/plan', '').page).toBe('strategy');
});
test.each(ROUTE_PAGES)('%s round-trips', (page) => {
    const subTab = ROUTE_SUB_TABS[page]?.[0] ?? null;
    const path = buildPath({ page, subTab });
    expect(parseLocation(path, '')).toEqual({ page, subTab, settings: null, canonical: true });
});
test.each(Object.entries(ROUTE_SUB_TABS).flatMap(([p, tabs]) => tabs.map(t => [p, t])))('%s/%s round-trips', (page, subTab) => {
    expect(parseLocation(buildPath({ page, subTab }), '')).toMatchObject({ page, subTab, canonical: true });
});
test('a page with sub-tabs but none given gets the default, not canonical', () => {
    expect(parseLocation('/liabilities', '')).toEqual({ page: 'liabilities', subTab: 'debts', settings: null, canonical: false });
    expect(parseLocation('/reports', '')).toMatchObject({ subTab: 'calendar', canonical: false });
});
test('unknown page or sub-tab falls back, not canonical', () => {
    expect(parseLocation('/nope', '')).toMatchObject({ page: 'health', canonical: false });
    expect(parseLocation('/savings/nope', '')).toMatchObject({ page: 'savings', subTab: 'emergency', canonical: false });
    expect(parseLocation('/ledger/extra', '')).toMatchObject({ page: 'ledger', canonical: false });
    expect(parseLocation('/strategy', '')).toMatchObject({ page: 'health', canonical: false });
});
test('trailing slash is not canonical', () => {
    expect(parseLocation('/ledger/', '')).toMatchObject({ page: 'ledger', canonical: false });
});
test('settings query', () => {
    expect(buildPath({ page: 'ledger', settings: 'security' })).toBe('/ledger?settings=security');
    expect(buildPath({ page: 'health', settings: '' })).toBe('/?settings');
    expect(parseLocation('/ledger', '?settings=security')).toMatchObject({ page: 'ledger', settings: 'security', canonical: true });
    expect(parseLocation('/', '?settings')).toMatchObject({ settings: '', canonical: true });
    expect(parseLocation('/', '?settings=Bad!')).toMatchObject({ settings: '', canonical: false });
});
test('legacy ?page= maps to the path address', () => {
    expect(parseLocation('/', '?page=strategy')).toEqual({ page: 'strategy', subTab: null, settings: null, canonical: false });
    expect(parseLocation('/', '?page=reports')).toMatchObject({ page: 'reports', subTab: 'calendar', canonical: false });
    expect(parseLocation('/', '?page=bogus')).toMatchObject({ page: 'health', canonical: false });
});
test('unrelated query params are ignored and kept canonical', () => {
    expect(parseLocation('/', '?reset_token=abc')).toMatchObject({ page: 'health', canonical: true });
});
```

- [ ] **Step 2: Run to verify it fails** (Docker Jest one-liner from memory, `npx jest tests/unit/router.test.js`). Expected: FAIL, cannot find module `src/router.js`.

- [ ] **Step 3: Implement** the exports above in `src/router.js`. One table maps page name ↔ first path segment (`health` ↔ `''`, `strategy` ↔ `plan`, otherwise identical); everything else derives from it. No DOM access at module scope.

- [ ] **Step 4: Run to verify it passes.** Expected: PASS, and `tests/unit/firstPaintModules.test.js` still passes (router.js is not yet imported).

- [ ] **Step 5: Commit** `feat: pure route table for path addresses (#<issue>)`.

---

### Task 2: Deep-link plumbing (`<base>`, service worker)

**Files:**
- Modify: `index.html` (`<head>`, before the first relative URL), `sw.js` (`networkFirst` or the fetch handler)
- Test: `tests/ui/test_app_routing.py` (new; add to the `test-ui-c` job list in `.github/workflows/ci.yml`)

**Interfaces:** none produced; later tasks rely on nested paths loading the app.

- [ ] **Step 1: Write the failing tests** in `tests/ui/test_app_routing.py`, using `app_page` and `wait_for_app_ready`:
  - `test_nested_path_boots_without_errors`: collect `console` errors and failed responses, `goto(BASE + 'liabilities/expenses')`, `wait_for_app_ready`; assert `window.app` exists, no console error, and every `src/*.js` response has a JavaScript content type.
  - `test_offline_deep_link_serves_shell`: in a context with service workers allowed, load `/`, wait for `navigator.serviceWorker.ready`, `context.set_offline(True)`, `goto(BASE + 'reports/forecast')`; assert the document contains `id="healthSection"` (the shell), not a browser error page.
- [ ] **Step 2: Run them** against a rebuilt stack. Expected: the first FAILS (module MIME / console errors), the second FAILS (offline error page).
- [ ] **Step 3: Implement.** Add `<base href="/">` to `index.html`. In `sw.js`, when a `request.mode === 'navigate'` fetch fails and there is no exact cache match, return the cached `/index.html`. Grep `src/` for relative URLs built at runtime (`import(`, `fetch(`, `href=`, `src=`, `new URL(`) and confirm each still resolves from `/` (a relative URL now resolves against the base; record the list checked in the commit message). Bump nothing yet (Task 6 does the version).
- [ ] **Step 4: Run both tests** plus `tests/features/test_pwa.py`, `tests/integration/test_pwa_offline.py`, `tests/ui/test_pwa_update_banner.py` and the `tests/security` CSP tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat: deep links load from any path (#<issue>)`.

---

### Task 3: Page addresses, Back/Forward, boot

**Files:**
- Modify: `src/router.js` (glue), `src/ui.js` (`switchPage` at 806, `initializeEventListeners`), `src/app.js` (330, 554, 1363-1364), `manifest.json` (shortcuts), `sw.js` (`PRECACHE_URLS`)
- Test: `tests/ui/test_app_routing.py`

**Interfaces:**
- Consumes: Task 1 `buildPath`, `parseLocation`, `DEFAULT_SUB_TAB`.
- Produces (in `src/router.js`):
  - `recordView(app, view: { page, subTab?: string|null }, mode: 'push'|'replace' = 'push') -> void`: builds the path (dropping `settings`), does nothing if it equals the current `location.pathname + location.search` or while an apply is running, else `pushState`/`replaceState`.
  - `currentSubTab(app, page, requested?: string|null) -> string|null`: `requested` if given; else liabilities `'debts'`, savings `app.savingsSubTab || 'emergency'`, reports the active `.rpt-tab-btn--active` `data-rptab` or `'calendar'`; else `null`.
  - `applyLocation(app) -> void`: parses `location`, sets an internal `applying` flag, calls `app.switchPage(page, { subTab })` when the page or sub-tab differs from the current view, clears the flag, then `replaceState`s the canonical path if `canonical` is false. Settings handling is added in Task 5.
  - `initRouter(app) -> void`: registers one `popstate` listener calling `applyLocation(app)`; idempotent.
  - `ui.js`: `switchPage(app, pageName, { subTab = null } = {})` records `{ page, subTab: currentSubTab(app, pageName, subTab) }` after switching. `app.switchPage(pageName, opts)` forwards `opts`.

- [ ] **Step 1: Write the failing tests:**
  - `test_nav_click_sets_address`: click `[data-page="strategy"]`; assert `page.url` ends with `/plan`.
  - `test_back_and_forward_between_pages`: click Ledger then Reports; `go_back()` → URL `/ledger` and `#ledgerSection` active; `go_forward()` → `/reports/calendar` and `#reportsSection` active.
  - `test_refresh_keeps_page`: click Ledger, reload, `wait_for_app_ready`; `#ledgerSection` active.
  - `test_same_page_click_adds_no_history` (Review Focus 1): click Ledger, record `history.length`, click Ledger again; length unchanged.
  - `test_forward_survives_back` (Review Focus 4): click Ledger, Reports; back; assert `history.length` unchanged by the back; forward works.
  - `test_legacy_page_param_redirects`: `goto(BASE + '?page=strategy')`; URL ends with `/plan`, Plan section active, `history.length` did not grow (replace).
  - `test_unknown_path_goes_home`: `goto(BASE + 'nope')`; URL is `/`, Health active.
  - `test_back_from_ledger_clears_breadcrumb`: trigger the Spending → "View in Ledger" cross-nav (#315, seed data as `tests/features` cross-nav tests do), go back; `app._ledgerCrossNavLabel` is null.
  - `test_signed_out_deep_link_lands_after_sign_in` (Review Focus 5): fresh context, `goto(BASE + 'ledger')`, sign in through `#loginGate`; `#ledgerSection` active and URL `/ledger`. Also `goto(BASE + '?reset_token=x')` shows the reset form.
  - `test_command_palette_navigation_pushes`: open the palette, go to Accounts; URL `/accounts`; Back returns to the previous address.
- [ ] **Step 2: Run.** Expected: FAIL (URL never changes).
- [ ] **Step 3: Implement** per the Interfaces block. Boot: replace `this.switchPage('health')` (`app.js:330`) with `initRouter(this); applyLocation(this);` and delete the `?page=` block at `app.js:1363-1364` (`parseLocation` handles it). Move the six `manifest.json` shortcut URLs to path addresses (`/`, `/plan`, `/reports/calendar`, `/ledger`, `/reconcile`, `/retirement`). Add `'/src/router.js'` to `PRECACHE_URLS`.
- [ ] **Step 4: Run** the new tests plus `tests/ui/test_main_nav.py`, `tests/ui/test_reports_nav.py`, `tests/unit` (incl. `firstPaintModules.test.js`). Expected: PASS.
- [ ] **Step 5: Commit** `feat: page addresses with Back, Forward and refresh (#<issue>)`.

---

### Task 4: Sub-tab addresses

**Files:**
- Modify: `src/ui.js` (`renderPageData`/`renderPageDataUncached` 862-930, Reports tab click 397-410, `navigateToReportsCalendar` 578, Liabilities sub-tab click 783), `src/savings.js` (click at 487)
- Test: `tests/ui/test_app_routing.py`

**Interfaces:**
- Consumes: Task 3 `recordView`, `currentSubTab`, `switchPage(app, page, { subTab })`.
- Produces: `ui.js` `selectReportsTab(target: string) -> void` (the button/panel toggling now inlined in the click handler and `navigateToReportsCalendar`, extracted once). `renderPageData(app, pageName, { resetToDefaults, subTab })`.

- [ ] **Step 1: Write the failing tests:**
  - `test_sub_tab_click_sets_address`: on Liabilities click Expenses → `/liabilities/expenses`; on Savings click the Sinking sub-tab → `/savings/sinking`; on Reports click Net worth → `/reports/networth`.
  - `test_deep_link_opens_sub_tab`: `goto` each of `/liabilities/expenses`, `/savings/home`, `/reports/variance`; the matching panel is visible.
  - `test_deep_link_sub_tab_survives_lazy_render` (Review Focus 2): delay `**/src/appFeatures.js` by 1.5 s with `page.route` (use `app_page_no_sw`), `goto('/liabilities/expenses')`; after `appFeatures` resolves and the page renders, `#expensesPanel` is visible and the URL is unchanged.
  - `test_back_between_sub_tabs`: Reports Calendar → Spending → Back shows Calendar.
  - `test_nav_button_keeps_remembered_sub_tab`: open Reports, pick Spending, go to Ledger, click Reports nav → `/reports/spending`; Liabilities Expenses → Ledger → Liabilities nav → `/liabilities/debts` (reset kept).
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Thread `subTab` from `switchPage` into `renderPageData` (including the deferred `loadAppFeatures().then` path) and apply it inside the render: Liabilities `switchLiabilitiesSubTab(subTab || 'debts')` where it now resets; Savings sets `app.savingsSubTab = subTab` before `renderSavingsPage`; Reports `selectReportsTab(subTab)` before `renderReportsPage`. Each sub-tab click handler calls `recordView(app, { page, subTab }, 'push')` after switching.
- [ ] **Step 4: Run** the new tests, `tests/ui/test_reports_nav.py`, and the Liabilities/Savings/Reports feature files in `tests/features`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: sub-tab addresses (#<issue>)`.

---

### Task 5: Settings address

**Files:**
- Modify: `src/router.js`, `src/setupWizard.js` (`open`/`close` in `initSettingsModal`, export `closeSettings`), `src/settingsNav.js` (`showSettingsPage`, `showSettingsList`, `showSettingsListQuiet`), `src/appFeatures.js` (re-export), `src/app.js` (lazy `closeSettings` wrapper, call after `_finishBoot`)
- Test: `tests/ui/test_app_routing.py`

**Interfaces:**
- Consumes: Task 3 `applyLocation`, the `applying` flag.
- Produces (in `src/router.js`):
  - `recordSettings(settingsPage: string, mode: 'push'|'replace') -> void`: keeps the current path and sets `?settings=<page>` (`''` → bare `?settings`); a push sets an internal `settingsPushed` flag. No-op while applying.
  - `leaveSettings() -> void`: if `settingsPushed`, clear it and `history.back()`; else `replaceState` the path without `?settings`.
  - `applyLocation` gains: `settings !== null` and the modal closed → `app.openSettings({ page: settings || undefined })`; `settings === null` and the modal open → `app.closeSettings({ fromHistory: true })` and clear `settingsPushed`.
  - `applySettingsFromLocation(app) -> void`: the settings half alone, called once after `_finishBoot` (Settings code is lazy).
  - `setupWizard.js`: `closeSettings(app, { fromHistory = false } = {})`; `close()` calls `leaveSettings()` unless `fromHistory`.

- [ ] **Step 1: Write the failing tests:**
  - `test_open_settings_pushes_and_back_closes`: on `/ledger`, open Settings from the account menu; URL `/ledger?settings=<page shown>`; `go_back()` → modal hidden, URL `/ledger`.
  - `test_settings_row_replaces`: open Settings, click the Security row; URL `?settings=security`; `history.length` unchanged since opening; one `go_back()` closes the modal.
  - `test_close_button_restores_address`: open, close with the close button; URL `/ledger`; `go_forward()` reopens is acceptable either way, but `go_back()` from there must not leave the app.
  - `test_settings_deep_link_opens_modal`: `goto('/reports/spending?settings=backup')`; Reports Spending visible behind an open Settings on Backup.
  - `test_close_bookmarked_settings_stays_in_app` (Review Focus 3): `goto('/ledger?settings=security')`, press Escape; modal closed, URL `/ledger`, `page.url` still on the app origin.
  - `test_narrow_settings_list_address`: at 390 px open Settings; URL ends `?settings`; tap a row → `?settings=<row>`; the in-modal Back → `?settings`; browser Back closes the modal.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** In `open(page)`, call `recordSettings(page || '', 'push')` before showing a page; `showSettingsPage` calls `recordSettings(activePage, 'replace')`, the list functions `recordSettings('', 'replace')`. Keep Escape's existing narrow-list behaviour.
- [ ] **Step 4: Run** the new tests, `tests/features/test_settings*.py` and `tests/ui/test_settings_redesign.py`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: Settings address, Back closes Settings (#<issue>)`.

---

### Task 6: Release and docs

**Files:**
- Modify: `src/utils.js` (`APP_VERSION`), `sw.js` (`CACHE_NAME`), `CHANGELOG.md`, `src/ui.js` (`WHATS_NEW_ENTRIES`), `src/locales/en.js`, `es.js`, `pl.js`, `docs/architecture/features.md`, `CLAUDE.md` (Page navigation), `AGENTS.md` if it restates that rule, `.github/workflows/ci.yml` (confirm the shard; move to a lighter `test-ui-*` job if `test-ui-c` exceeds ~360 s)

- [ ] **Step 1: Bump** to 8.7.0 in `APP_VERSION` and `CACHE_NAME`; add `## [8.7.0] — <merge date>` at the top of `CHANGELOG.md` (addresses, Back/Forward, refresh, Settings address, legacy `?page=` redirect, offline deep links); add a What's New entry with real es/pl translations.
- [ ] **Step 2: Docs.** `features.md`: an "App routing (path addresses)" entry describing the route table, record/apply flow, Settings replace rule and remembered sub-tabs. `CLAUDE.md` Page navigation: "a new page or sub-tab joins the route table in `src/router.js`; view changes go through `switchPage`/the sub-tab functions, which record the address; never call `history.pushState` elsewhere."
- [ ] **Step 3: Run** `tests/features/test_versioning.py`, `tests/features/test_pwa.py`, `tests/features/test_whats_new.py`, `tests/features/test_community_files.py`, `tests/features/test_ci_shard_coverage.py`, and `tests/unit`. Expected: PASS.
- [ ] **Step 4: Commit** `chore: release 8.7.0 app routing (#<issue>)`.
