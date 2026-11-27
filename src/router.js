// Path-address routing (#730). Pure part: page/sub-tab <-> URL mapping.
// No imports and no DOM access at module scope (ui.js will import this).

// Must equal the keys of PAGE_SECTION_IDS in ui.js.
export const ROUTE_PAGES = [
    'health', 'accounts', 'liabilities', 'income', 'savings', 'strategy', 'reports',
    'ledger', 'recurring', 'reconcile', 'retirement', 'people', 'notifications'
];

export const ROUTE_SUB_TABS = {
    liabilities: ['debts', 'expenses'],
    savings: ['emergency', 'sinking', 'home'],
    reports: ['calendar', 'forecast', 'incomeexp', 'moneyflow', 'networth', 'spending', 'summary', 'variance', 'yearreview']
};

export const DEFAULT_SUB_TAB = { liabilities: 'debts', savings: 'emergency', reports: 'calendar' };

// page name -> first path segment (everything else is identical)
const SEGMENT_BY_PAGE = Object.fromEntries(ROUTE_PAGES.map(p => [p, p]));
SEGMENT_BY_PAGE.health = '';
SEGMENT_BY_PAGE.strategy = 'plan';
const PAGE_BY_SEGMENT = Object.fromEntries(Object.entries(SEGMENT_BY_PAGE).map(([p, s]) => [s, p]));

const SETTINGS_NAME = /^[a-z]+$/;

// An unknown sub-tab is dropped; a Settings name that is not a plain word
// falls back to the bare ?settings (the router does not know the pages).
export function buildPath(view) {
    const page = ROUTE_PAGES.includes(view.page) ? view.page : 'health';
    let path = '/' + SEGMENT_BY_PAGE[page];
    const tabs = ROUTE_SUB_TABS[page];
    if (view.subTab && tabs && tabs.includes(view.subTab)) path += '/' + view.subTab;
    if (view.settings === '' || (view.settings && !SETTINGS_NAME.test(view.settings))) path += '?settings';
    else if (view.settings) path += '?settings=' + view.settings;
    return path;
}

// True when the search holds a bare `settings` pair (no `=`): the canonical
// narrow-list address, as opposed to an empty `settings=`.
function hasBareSettings(search) {
    return String(search || '').replace(/^\?/, '').split('&').includes('settings');
}

export function parseLocation(pathname, search) {
    const params = new URLSearchParams(search || '');
    const parts = String(pathname || '/').replace(/^\//, '').split('/');
    let canonical = true;
    let page = 'health';
    let subTab = null;

    if (Object.prototype.hasOwnProperty.call(PAGE_BY_SEGMENT, parts[0])) {
        page = PAGE_BY_SEGMENT[parts[0]];
    } else {
        canonical = false;
    }

    // Legacy ?page=<name> on the root address.
    if (parts[0] === '' && params.has('page')) {
        canonical = false;
        const legacy = params.get('page');
        if (ROUTE_PAGES.includes(legacy)) page = legacy;
    }

    const tabs = ROUTE_SUB_TABS[page];
    if (tabs) {
        if (tabs.includes(parts[1])) {
            subTab = parts[1];
        } else {
            subTab = DEFAULT_SUB_TAB[page];
            canonical = false;
        }
    }

    // Extra segments (including a trailing slash) are not canonical.
    if (parts.length > (tabs ? 2 : 1)) canonical = false;

    let settings = null;
    if (params.has('settings')) {
        const raw = params.get('settings');
        if (SETTINGS_NAME.test(raw)) {
            settings = raw;
        } else {
            settings = '';
            if (raw !== '' || !hasBareSettings(search)) canonical = false;
        }
    }

    return { page, subTab, settings, canonical };
}

// ── Glue (#730): the address follows the view, Back/Forward move the view ────
// DOM/history access happens only inside these functions. No imports: pages
// are switched through app.switchPage, never a direct ui.js call.

let applying = false;
let listening = false;
// The settings half of applyLocation waits for the (lazy) Settings modal,
// initialised in _finishBoot; applySettingsFromLocation turns it on.
let settingsReady = false;
// Path + search of the view on screen, kept after every write or apply, so a
// Back that only closes an overlay can put the address back (#731).
let lastPath = null;
// #734: every entry the router writes carries history.state.mf, its position
// in the app's own history (a push is current + 1, a replace keeps it), and
// survives a reload with the entry. currentIndex is the mf of the entry on
// screen, null when unknown (an entry written by other code, such as the
// login gate's replaceState): then the Back guard falls back to pushing the
// address back. The entry Settings' opening pushed also carries
// `settings: true`, so closing Settings knows it can step back over it.
let currentIndex = null;
// The index of the entry this document loaded at (set by initRouter).
let bootIndex = null;
// A traversal the router started itself (history.go/back): { index, path,
// undo }. Its popstate is recognised by the index it lands on (by the address
// when indexes are unknown), so a user Back arriving meanwhile is not taken
// for it. `undo` marks the return over a dialog: the view did not change.
let expected = null;
// The last Settings page recorded while an address was being applied (null:
// none). Recording then is suppressed; once applied, flushPendingSettings
// makes the address name the page Settings actually shows.
let pendingSettings = null;

function syncLastPath() {
    lastPath = location.pathname + location.search;
}

// The index stored in a history state, or null for anything else.
function indexOf(state) {
    const mf = state && typeof state === 'object' ? state.mf : undefined;
    return Number.isInteger(mf) && mf >= 0 ? mf : null;
}

function hasSettingsMarker() {
    const state = history.state;
    return Boolean(state && typeof state === 'object' && state.settings === true);
}

function entryState(index, settings) {
    if (index === null && !settings) return null;
    const state = {};
    if (index !== null) state.mf = index;
    if (settings) state.settings = true;
    return state;
}

// The index of the entry actually on screen. While an undo is pending that is
// the popped entry, not currentIndex (which still names where the undo goes).
function onScreenIndex() {
    return indexOf(history.state) ?? currentIndex;
}

// A push or replace the router writes invalidates a pending traversal: a
// push may truncate its target (the browser can then ignore the go, with no
// popstate), and either way the expectation would only swallow a later
// genuine pop.
function pushEntry(path, settings = false) {
    expected = null;
    const base = onScreenIndex();
    const index = base === null ? null : base + 1;
    history.pushState(entryState(index, settings), '', path);
    currentIndex = index;
}

// Keeps the entry's index, and its Settings marker while the address still
// carries ?settings (a page taking over the Settings entry drops it).
function replaceEntry(path) {
    expected = null;
    const index = onScreenIndex();
    const url = new URL(path, 'http://x');
    const settings = hasSettingsMarker() && parseLocation(url.pathname, url.search).settings !== null;
    history.replaceState(entryState(index, settings), '', path);
    currentIndex = index;
}

// Settings' own entry can be stepped back over only when it is marked and the
// entry before it belongs to this document: after a reload, entries below
// bootIndex are the discarded document's, and history.back() would reload
// the whole app (no popstate) instead of closing Settings.
function canStepBackOverSettings() {
    const index = onScreenIndex();
    return hasSettingsMarker() && index !== null && bootIndex !== null && index - 1 >= bootIndex;
}

// Step back over the Settings entry on screen (it carries the marker, so
// this session pushed it from the same path without ?settings).
function stepBackOverSettings() {
    const path = location.pathname;
    expected = { index: onScreenIndex() - 1, path, undo: false };
    lastPath = path;
    history.back();
}

function isExpectedPop(newIndex) {
    if (!expected) return false;
    if (expected.index !== null && newIndex !== null) return newIndex === expected.index;
    return location.pathname + location.search === expected.path;
}

// Sub-tab `page` is showing now (or `requested`). switchPage records after
// rendering, so a nav click into Liabilities reads the Debts it reset to.
export function currentSubTab(app, page, requested = null) {
    if (requested) return requested;
    if (page === 'liabilities') return app.liabilitiesSubTab || DEFAULT_SUB_TAB.liabilities;
    if (page === 'savings') return app.savingsSubTab || DEFAULT_SUB_TAB.savings;
    if (page === 'reports') {
        const active = document.querySelector('.rpt-tab-btn--active');
        return (active && active.getAttribute('data-rptab')) || DEFAULT_SUB_TAB.reports;
    }
    return null;
}

// Write the view into the address bar. A no-op while an address is being
// applied (Back/Forward, boot) and when the address is already current, so
// re-clicking the page you are on adds no history entry.
export function recordView(app, view, mode = 'push') {
    if (applying) return;
    const path = buildPath({ page: view.page, subTab: view.subTab || null });
    if (path === location.pathname + location.search) return;
    // Leaving a ?settings address for a page (the palette does) never stacks
    // on the Settings entry. Its own entry (marked) is taken over for another
    // page and stepped back over for the page under it (when that entry is in
    // this document); otherwise ?settings is dropped in place first.
    const leavingSettings = parseLocation(location.pathname, location.search).settings !== null;
    if (leavingSettings && mode === 'push') {
        if (hasSettingsMarker() && path !== location.pathname) {
            mode = 'replace';
        } else if (path === location.pathname && canStepBackOverSettings()) {
            stepBackOverSettings();
            return;
        } else {
            replaceEntry(location.pathname);
            if (path === location.pathname + location.search) {
                syncLastPath();
                return;
            }
        }
    }
    if (mode === 'replace') replaceEntry(path);
    else pushEntry(path);
    syncLastPath();
}

// Settings in the address: keeps the path and sets ?settings=<page> (bare
// ?settings for the narrow list). Opening pushes; moving inside replaces.
export function recordSettings(settingsPage, mode = 'replace') {
    if (applying) {
        pendingSettings = settingsPage;
        return;
    }
    const path = location.pathname + (settingsPage ? '?settings=' + settingsPage : '?settings');
    if (mode === 'push') {
        pushEntry(path, true);
        syncLastPath();
        return;
    }
    if (path !== location.pathname + location.search) replaceEntry(path);
    syncLastPath();
}

// Settings closed by its button or Escape: step back over the entry opening
// pushed (marked, also when reached again by Forward), else drop ?settings in
// place: a bookmark (never back out of the app) or an entry from before a
// reload (stepping back would reboot the app).
export function leaveSettings() {
    if (applying) return;
    if (parseLocation(location.pathname, location.search).settings === null) return;
    if (canStepBackOverSettings()) {
        // Lands on the entry before ?settings (recordView never writes a search).
        stepBackOverSettings();
    } else {
        replaceEntry(location.pathname);
        syncLastPath();
    }
}

export function isSettingsOpen() {
    const modal = document.getElementById('settingsModal');
    return Boolean(modal && !modal.classList.contains('hidden'));
}

// Settings opened by an applied address (a bare ?settings on a wide screen,
// an unknown page name) shows a page the address does not name: once the
// address is applied, rewrite it in place to the page shown. A replace keeps
// the entry's index and Settings marker.
function flushPendingSettings() {
    const settingsPage = pendingSettings;
    pendingSettings = null;
    if (settingsPage === null || !isSettingsOpen()) return;
    if (parseLocation(location.pathname, location.search).settings === null) return;
    recordSettings(settingsPage, 'replace');
}

// The settings half of applyLocation: open or close Settings to match the address.
function applySettings(app, settings) {
    const open = isSettingsOpen();
    if (settings !== null && !open) {
        app.openSettings({ page: settings || undefined });
    } else if (settings === null && open) {
        app.closeSettings({ fromHistory: true });
    }
}

// Called once after _finishBoot: Settings is lazy, so a ?settings address
// opens it only once its modal is initialised.
export function applySettingsFromLocation(app) {
    settingsReady = true;
    const { settings } = parseLocation(location.pathname, location.search);
    applying = true;
    pendingSettings = null;
    try {
        applySettings(app, settings);
    } finally {
        applying = false;
    }
    flushPendingSettings();
}

// Show the view the address names (boot and popstate). Never pushes; a
// non-canonical address (legacy ?page=, unknown path) is rewritten in place.
export function applyLocation(app) {
    const parsed = parseLocation(location.pathname, location.search);
    const current = app._currentPage;
    const differs = parsed.page !== current
        || (parsed.subTab !== null && parsed.subTab !== currentSubTab(app, current));
    applying = true;
    pendingSettings = null;
    try {
        // Only the sub-tab changed: keep the page's view state, as a tab click does.
        if (differs) app.switchPage(parsed.page, { subTab: parsed.subTab, resetToDefaults: parsed.page !== current });
        if (settingsReady) applySettings(app, parsed.settings);
    } finally {
        applying = false;
    }
    if (!parsed.canonical) {
        replaceEntry(buildPath(parsed));
    }
    flushPendingSettings();
    syncLastPath();
}

// ── Back closes the innermost thing first (#731) ─────────────────────────────
// Overlays add no history entries. A Back (popstate) while one is open puts
// the address back and closes the overlay with Escape, or cancels the open
// inline edit; only with nothing open does it change the view.

// Never closed by Back: Back with a gate up applies the address as usual.
export const GATE_IDS = ['loginGate', 'serverUnreachableGate'];

// app field set while an inline edit is open -> the app method its Cancel
// button calls. editingDebtId is handled apart: it has two edit forms.
export const EDIT_CANCELLERS = {
    editingAccountId: 'cancelEditAccount',
    editingBillId: 'cancelEditBill',
    editingBonusId: 'cancelEditBonus',
    editingExpenseId: 'cancelEditExpense',
    editingIncomeId: 'cancelEditIncome',
    editingPersonId: 'cancelEditPerson',
    editingRecurringId: 'cancelEditRecurring'
};

// Each inline edit's name input is rendered with this id prefix + the record
// id. An edit counts only while that input is shown: switchPage and the
// sub-tabs leave editing*Id set, and a hidden edit must not swallow Back.
// Bills have no edit UI any more, so editingBillId never counts.
const EDIT_INPUT_PREFIX = {
    editingAccountId: 'ac-name-',
    editingBonusId: 'be-name-',
    editingDebtId: 'inline-name-',
    editingExpenseId: 'ee-name-',
    editingIncomeId: 'ie-name-',
    editingPersonId: 'pe-name-',
    editingRecurringId: 're-name-'
};

const OVERLAY_SELECTOR = '[role="dialog"], [role="alertdialog"], .modal, [data-overlay]';

// #734: the header popovers (not dialogs) Back closes too: popover id -> the
// wrapper holding it and its trigger button. They rank below any dialog.
const POPOVERS = { notificationsPanel: 'notificationsWrap', accountMenuDropdown: 'accountMenuWrap' };
// Popover id -> when it last opened (a counter), for two open at once.
const popoverOpened = new Map();
let popoverSeq = 0;
// Escape events a popover already closed for, so a second popover's handler
// on the same event leaves its own open.
const claimedEscapes = new WeakSet();

// Each popover calls this when it opens.
export function notePopoverOpened(id) {
    popoverOpened.set(id, ++popoverSeq);
}

function isShown(el) {
    return !el.classList.contains('hidden') && el.getClientRects().length > 0;
}

function isEditShown(app, field) {
    const el = app[field] != null && EDIT_INPUT_PREFIX[field]
        ? document.getElementById(EDIT_INPUT_PREFIX[field] + app[field]) : null;
    return Boolean(el && isShown(el));
}

function isGateUp() {
    return GATE_IDS.some(id => {
        const el = document.getElementById(id);
        return Boolean(el && isShown(el));
    });
}

// The open overlay Back should close: not a gate, not Settings (closed through
// its address), preferring the one holding focus, else the last in DOM order.
// With no dialog open, an open header popover: the one whose wrapper (popover
// plus trigger) holds focus, else the one opened last.
export function topOverlay() {
    const shown = Array.from(document.querySelectorAll(OVERLAY_SELECTOR))
        .filter(el => !GATE_IDS.includes(el.id) && el.id !== 'settingsModal' && isShown(el));
    const active = document.activeElement;
    if (shown.length) {
        const holding = active ? shown.filter(el => el.contains(active)) : [];
        return holding.length ? holding[holding.length - 1] : shown[shown.length - 1];
    }
    const popovers = Object.keys(POPOVERS)
        .map(id => document.getElementById(id))
        .filter(el => el && isShown(el));
    if (popovers.length === 0) return null;
    const focused = popovers.find(el => {
        const wrap = document.getElementById(POPOVERS[el.id]);
        return Boolean(active && wrap && wrap.contains(active));
    });
    if (focused) return focused;
    return popovers.reduce((a, b) => ((popoverOpened.get(b.id) || 0) > (popoverOpened.get(a.id) || 0) ? b : a));
}

// For a popover's document-level Escape handler, registered in the capture
// phase (so it runs before a dialog's own handler hides the dialog above):
// true when this Escape is the popover's to close, i.e. it is the top overlay
// and no other popover closed for this event already.
export function claimEscape(e, el) {
    if (e.key !== 'Escape' || claimedEscapes.has(e) || topOverlay() !== el) return false;
    claimedEscapes.add(e);
    return true;
}

// Close the innermost overlay or inline edit; true when something was open.
export function closeInnermost(app) {
    if (isGateUp()) return false;
    const overlay = topOverlay();
    if (overlay) {
        // Escape on the focused element reaches both handlers on the overlay
        // (modal.onkeydown) and document-level ones. An overlay that ignores
        // Escape stays open; the address is still restored.
        const active = document.activeElement;
        const target = active && overlay.contains(active) ? active : overlay;
        target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
        return true;
    }
    // Settings itself closes through its address (applyLocation).
    if (isSettingsOpen()) return false;
    for (const [field, method] of Object.entries(EDIT_CANCELLERS)) {
        if (isEditShown(app, field) && typeof app[method] === 'function') {
            app[method]();
            return true;
        }
    }
    if (app.editingDebtId != null && isEditShown(app, 'editingDebtId')) {
        app.cancelInlineEdit();
        return true;
    }
    return false;
}

export function onPopState(app) {
    const newIndex = indexOf(history.state);
    if (isExpectedPop(newIndex)) {
        const { undo } = expected;
        expected = null;
        currentIndex = newIndex;
        // An undo returned to the view on screen; a Settings step-back applies.
        if (!undo) applyLocation(app);
        return;
    }
    // A user pop landing first makes a pending undo's relative go() wrong:
    // drop the expectation and handle this pop as it comes.
    if (expected && expected.undo) expected = null;
    if (lastPath !== null && closeInnermost(app)) {
        if (currentIndex !== null && newIndex !== null) {
            // Undo the pop (Back, Forward or several entries) in one step:
            // no entry is added or dropped, so Forward history survives.
            if (newIndex !== currentIndex) {
                expected = { index: currentIndex, path: lastPath, undo: true };
                history.go(currentIndex - newIndex);
            }
            return;
        }
        // Unknown index: put the address back by pushing it (pre-#734).
        expected = null;
        history.pushState(null, '', lastPath);
        currentIndex = null;
        return;
    }
    currentIndex = newIndex;
    applyLocation(app);
}

export function initRouter(app) {
    if (listening) return;
    listening = true;
    // A reload keeps history.state with the entry, so a stored index stands.
    currentIndex = indexOf(history.state);
    if (currentIndex === null) {
        currentIndex = 0;
        history.replaceState({ mf: 0 }, '');
    }
    bootIndex = currentIndex;
    window.addEventListener('popstate', () => onPopState(app));
}
