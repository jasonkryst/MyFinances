# App routing and phone navigation: design

Status: owner-approved approach and scope, 2026-11-25. Modeled on BookWheel's
routing epic (jasonkryst/BookWheel#576).

## Intent

MyFinances is a single-page app whose `switchPage` (`src/ui.js`) never touches
the URL. The browser Back button leaves the app, a refresh always lands on
Health, and no page can be bookmarked or shared. The owner wants Back,
refresh and bookmarks to behave the way they do on any website, and wants the
phone experience improved more broadly.

## Goals

1. Every top-level page, and every sub-tab that changes what the page shows,
   has its own address.
2. Back and Forward move between pages, sub-tabs and the Settings modal.
3. Refresh and a pasted or bookmarked address open the same view, including
   after signing in.
4. On phones, a bottom tab bar replaces the hamburger menu.
5. A phone-width audit turns up the remaining phone problems as issues.

## Non-goals

- Turning Settings into a full page (a later issue, like BookWheel phase 3).
- Putting filters, search terms, month offsets or modal state other than
  Settings into the URL.
- Server-rendered or public pages.
- Fixing what the phone audit finds (each finding is its own issue).
- Any change to the desktop navigation.

## Anti-goals (a failure even if it works)

- The Ledger search term reaching the URL, history or any persisted place
  (CLAUDE.md: never persisted).
- A deep link that boots to a blank page or a module MIME error.
- An extra round trip or a slower first paint on `/` (the
  `firstPaintModules.test.js` budget holds).
- Two sources of truth for the current page: the URL is it.

## Constraints found in the code

- `nginx.conf:104` already falls back to `index.html` for unknown paths.
- `index.html` loads assets with relative paths (`src/app.js`, `styles.css`,
  `manifest.json`, modulepreload hints). At a nested path like
  `/liabilities/debts` they would resolve under `/liabilities/` and get
  `index.html` back. Fix: `<base href="/">` in `index.html`. Every relative
  URL built in JS (dynamic `import()`, `fetch`, `guide.html` links, icons)
  must be checked against it.
- `sw.js` serves navigations network-first and falls back to a cache match on
  the exact URL. Offline, `/reports` has no cache entry; navigations must fall
  back to the cached `/index.html`.
- `PAGE_SECTION_IDS` (`ui.js:790`) holds 13 pages, including `notifications`,
  which has no nav button and is opened from the notification centre.
- Sub-tabs: Liabilities `debts|expenses` (`switchLiabilitiesSubTab`), Savings
  `emergency|sinking|home` (`switchSavingsSubTab`), Reports `calendar,
  forecast, incomeexp, moneyflow, networth, spending, summary, variance,
  yearreview` (`data-rptab`, some lazy). The Plan page's
  `tabular|calendar|chart` schedule tabs are view toggles, not addresses.
- Settings is a modal (`openSettings`, `setupWizard.js`) with 8 pages
  (`SETTINGS_PAGES`, `settingsNav.js`).
- `switchPage` clears the #315 Ledger cross-nav breadcrumb when leaving the
  Ledger; that must also happen when leaving by Back.
- `renderPageData` already waits for `appFeatures.js` before non-Health pages,
  so a deep link to a lazy page renders once the module arrives.
- Boot gates (`#loginGate`, `#serverUnreachableGate`) sit in front of every
  address; `loginGate.js:215` already calls `replaceState` keeping the path.
- `switchPage`, `ui.js`, `postgresSync.js` sit in import cycles: new exports
  there are `function` declarations, and a new router module must not import
  a lazy module statically.
- The hamburger (`#navToggle`) shows at `max-width: 768px`
  (`styles.css` 3254, 8660).

## Approaches considered

- **A. Path addresses (`/reports`, `/liabilities/debts`). Chosen by the
  owner.** Cleanest addresses, same model as BookWheel, no later migration if
  public pages ever appear. Costs a `<base>` tag and a service-worker
  fallback.
- **B. Hash addresses (`/#/reports`).** No server, worker or asset-path
  changes, but uglier addresses and a bookmark-breaking migration if the app
  ever needs path addresses.
- **C. Query parameter (`/?page=reports`).** Cheap, but it is the hand-kept
  URL state BookWheel is moving away from (BookWheel #575).

## Design

### Address table (owner-approved)

| Address | View |
|---|---|
| `/` | Health |
| `/accounts`, `/income`, `/people`, `/recurring`, `/ledger`, `/reconcile`, `/retirement`, `/notifications` | that page |
| `/plan` | the `strategy` page (address follows the nav label) |
| `/liabilities` → `/liabilities/debts`, `/liabilities/expenses` | Liabilities on that sub-tab |
| `/savings` → `/savings/emergency`, `/savings/sinking`, `/savings/home` | Savings on that sub-tab |
| `/reports` → `/reports/<rptab>` | Reports on that tab |
| `<any page address>?settings=<page>` | that page with Settings open on `<page>` (owner: chosen over `/settings/<page>` for the better experience and upkeep) |

A page address without a sub-tab opens the page's default sub-tab and
replaces (not pushes) the address with the full one. An unknown address or
sub-tab goes to `/` (replace, no error page). Settings is a modal over the
current page, so its address is a query on top of the page address rather
than a path of its own (builder's call how the parameter is spelled, as long
as Back closes the modal).

### Router module

A small pure module (`src/router.js`, name is the builder's call) with:
- a route table mapping page names and sub-tabs to paths and back, the single
  place `strategy` ↔ `plan` lives;
- `parseLocation(pathname, search)` → `{ page, subTab, settingsPage }` and
  `buildPath(view)`, pure and unit-tested in Jest;
- a navigate function that pushes history and calls the existing
  `switchPage`/sub-tab functions, and a `popstate` handler that applies the
  parsed view without pushing.

`switchPage` and the sub-tab switchers stay the only code that changes the
view; the router calls them and every nav button goes through the router, so
the URL and the visible page cannot disagree. Boot reads the address after
the gates clear and opens that view instead of always Health.
`refreshCurrentPageData` and live refresh never touch history.

### History behaviour

- Page change: push. Sub-tab change: push. Default-sub-tab fill-in and
  unknown-address fallback: replace.
- Opening Settings: push; closing it by its button or Escape: `history.back()`
  when the open was a push in this session, otherwise replace. Back with
  Settings open closes it.
- Moving around inside Settings (a row click, the narrow-screen list ↔ page
  switch in `settingsNav.js`) **replaces** the address, never pushes: Back
  always closes the whole modal, and a refresh reopens the Settings page last
  shown. The narrow-screen list with no page chosen is a bare `?settings`.
  The in-modal Back on narrow screens keeps working as it does today.
  *(Designer's call, from the builder check.)*
- A nav button for a page with sub-tabs keeps today's behaviour, so routing
  changes no remembered state: Liabilities opens Debts on every visit (as
  `resetToDefaults` does now); Savings and Reports open the sub-tab last used
  this session (`app.savingsSubTab`, the active `data-rptab`). The button
  pushes the full address of whatever it opens. A typed or bookmarked address
  without a sub-tab opens the default: Liabilities `debts`, Savings
  `emergency`, Reports `calendar` (the existing fallback in `reports.js`).
  *(Designer's call, from the builder check.)*
- Back while another modal or the "More" sheet is open closes that overlay
  first is **not** in scope; those overlays do not push history.
- Leaving the Ledger by any route, Back included, clears the #315 breadcrumb
  (the existing `switchPage` code already does, as long as popstate goes
  through `switchPage`).

### Plumbing

- `<base href="/">` in `index.html`; audit relative URLs in JS.
- `sw.js`: a navigation request that fails offline falls back to the cached
  `/index.html`; bump `CACHE_NAME` with the version.
- No nginx change. No CSP change.
- The command palette, notification centre and any other `switchPage` caller
  go through the router so they push history too.
- Legacy `?page=<name>` addresses (read at boot in `app.js:1363`, used by the
  five `manifest.json` shortcuts, e.g. `/?page=strategy`) redirect with
  **replace** to their path address, through the same route table, so old
  installed-PWA shortcuts and bookmarks keep working and the URL stays the
  single source of truth. The manifest shortcuts move to path addresses in
  phase 1. *(Designer's call, from the builder check.)*

### Phone tab bar

Shown at `max-width: 768px`, replacing the hamburger; desktop unchanged.

```
┌───────────────────────────────────────┐
│ MyFinances            (header as today)│
│              (page content)           │
├───────────────────────────────────────┤
│ Health  Ledger  Plan  Reports  More   │
└───────────────────────────────────────┘
More → bottom sheet:
  Overview  Accounts · Income · People
  Manage    Liabilities · Recurring · Savings
  Analyze   Reconcile · Retirement
```

- The header is unchanged on phones: Help (❓ to `guide.html`), the
  notifications bell and the account menu (Settings, Backup, What's New,
  Calendar Feed, Shortcuts, Sign out) stay as they are; the sketch above only
  shows where the bar goes. Phase 2 is the bar and the More sheet only.
  *(Designer's call, from the builder check.)*
- Tabs (owner's choice): Health, Ledger, Plan, Reports, More.
- The More sheet reuses the existing `nav-group` structure minus the four tab
  pages: one source of nav items, not a second list.
- The bar is a `<nav>` landmark with its own accessible name; the active tab
  carries `aria-current="page"`; More is current on any sheet page.
- The sheet is a real overlay: `makeBackgroundInert`, focus moves in and is
  trapped, Escape and a backdrop tap close it, focus returns to More.
- Page content gets bottom padding of the bar height plus
  `env(safe-area-inset-bottom)`.
- The bar hides while an on-screen keyboard is up (a focused text field at
  phone width is a sufficient signal).
- All labels go through `t()` with keys in `en.js`, `es.js`, `pl.js`; the
  page joins `TRANSLATED_PAGES` as needed. Contrast measured with
  `tests/ui/contrast_utils.py`; no CSS nesting; tab icons inline SVG, no
  inline styles (CSP).

### Phone-width audit

Every page and modal at 390 px in the real app; one issue per finding,
labelled for the epic. Start with quick-add for transactions, dialogs as
full-screen sheets and wide tables. Fixes are out of scope here.

### Back closes the innermost thing first (phase 2 addition, owner-approved 2026-11-25)

Added to phase 2 (#731) from the phase 1 follow-ups (#734), because the More
sheet needs it and Android's hardware Back makes it matter most on phones.

- **Mechanism:** overlays never add history entries. When a `popstate`
  arrives while an overlay is open, the router restores the address it just
  left (`pushState` of the previous address, so the page does not change) and
  closes the top overlay by sending it Escape. "Overlay" means any visible
  `[role="dialog"]`/`.modal` (the test live refresh already uses) plus the
  More sheet. The sign-in gate and the server-unreachable gate are excluded:
  Back never closes them.
- **Every overlay closes on Escape.** Any that does not today is fixed
  (an accessibility requirement regardless).
- **Settings stacking:** a dialog on top of Settings (About → Keyboard
  Shortcuts / What's New) closes first; the next Back closes Settings through
  its address, as in phase 1.
- **Inline edits (owner's choice):** Back while an inline edit is open
  (`editingAccountId`, `editingBillId`, `editingBonusId`, `editingDebtId`,
  `editingExpenseId`, `editingIncomeId`, `editingPersonId`,
  `editingRecurringId`) cancels that edit exactly as its Cancel button does
  and stays on the page; nothing is saved.
- **Palette over Settings:** choosing a page in the command palette while
  Settings is open closes Settings first, so the address and the screen agree.
- Not included: the remaining #734 items (render errors, canonical bare
  `?settings`, test tidying).

## Phases (one issue and PR each, merged in order)

1. **Router and addresses**: router module, address table, history
   behaviour, `<base>`, service-worker fallback. Minor version.
2. **Phone tab bar and More sheet**. Minor version with a What's New entry.
3. **Phone-width audit**: issues only.

## Testing

- Jest: `parseLocation`/`buildPath` round-trips for every row of the table,
  unknown paths, `plan`↔`strategy`, Settings parameter.
- Playwright (new files added to a CI shard): deep link to each page and a
  nested sub-tab boots with no console errors; Back/Forward across pages,
  sub-tabs and Settings; refresh keeps the view; signed-out deep link lands
  on the address after sign-in; offline deep link serves the shell; the
  Ledger breadcrumb clears on Back; tab bar at 390 px (active state, More
  sheet focus and Escape, no clipping, last Ledger row reachable); desktop nav
  unchanged at 1280 px.
- Existing `test_main_nav.py`, `test_mobile*.py`, `test_reports_nav.py` keep
  passing; the hamburger tests change with phase 2.

## Left to the builder

- Router module name and internal API shape.
- Spelling of the Settings query parameter.
- Tab icons.
- Whether `/` is also reachable as `/health` (replace to `/` if so).
- How the keyboard-up signal is detected.
