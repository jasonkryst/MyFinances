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
test('buildPath drops an unknown sub-tab and an invalid Settings name (#734)', () => {
    expect(buildPath({ page: 'liabilities', subTab: 'bogus' })).toBe('/liabilities');
    expect(buildPath({ page: 'ledger', subTab: 'debts' })).toBe('/ledger');
    expect(buildPath({ page: 'reports', subTab: 'spending' })).toBe('/reports/spending');
    expect(buildPath({ page: 'health', settings: 'Bad!' })).toBe('/?settings');
    expect(buildPath({ page: 'health', settings: 'a&b=c' })).toBe('/?settings');
});
test('parseLocation reads settings as a parameter, not a substring (#734)', () => {
    expect(parseLocation('/', '?foo=a_settings=1&settings')).toMatchObject({ settings: '', canonical: true });
    expect(parseLocation('/', '?foo=settings')).toMatchObject({ settings: null, canonical: true });
    expect(parseLocation('/', '?settings=')).toMatchObject({ settings: '', canonical: false });
    expect(parseLocation('/', '?a=1&settings=&b=2')).toMatchObject({ settings: '', canonical: false });
    expect(parseLocation('/', '?a=1&settings&b=2')).toMatchObject({ settings: '', canonical: true });
});
test('legacy ?page= maps to the path address', () => {
    expect(parseLocation('/', '?page=strategy')).toEqual({ page: 'strategy', subTab: null, settings: null, canonical: false });
    expect(parseLocation('/', '?page=reports')).toMatchObject({ page: 'reports', subTab: 'calendar', canonical: false });
    expect(parseLocation('/', '?page=bogus')).toMatchObject({ page: 'health', canonical: false });
});
test('unrelated query params are ignored and kept canonical', () => {
    expect(parseLocation('/', '?reset_token=abc')).toMatchObject({ page: 'health', canonical: true });
});

// ── Task 3 glue: recordView / currentSubTab / applyLocation / initRouter ─────

const fs = require('fs');
const path = require('path');
// The glue keeps module state (the entry index, an expected pop), so every
// test gets a fresh copy of the module.
let recordView, currentSubTab, applyLocation, initRouter, recordSettings, leaveSettings,
    applySettingsFromLocation, closeInnermost, topOverlay, onPopState, EDIT_CANCELLERS, GATE_IDS;
beforeEach(() => {
    jest.resetModules();
    ({
        recordView, currentSubTab, applyLocation, initRouter, recordSettings, leaveSettings,
        applySettingsFromLocation, closeInnermost, topOverlay, onPopState, EDIT_CANCELLERS, GATE_IDS
    } = require('../../src/router.js'));
});

test('PAGE_SECTION_IDS in ui.js has exactly the ROUTE_PAGES keys', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../src/ui.js'), 'utf8');
    const block = source.match(/const PAGE_SECTION_IDS = \{([^}]*)\}/);
    expect(block).not.toBeNull();
    const keys = [...block[1].matchAll(/^\s*([a-z]+)\s*:/gm)].map(m => m[1]);
    expect(keys.sort()).toEqual([...ROUTE_PAGES].sort());
});

// A history stack. pushState/replaceState act at once; go/back only record
// the call (the browser traverses later): a test completes a traversal, or
// makes a user one, with env.traverse(delta) and then calls onPopState.
function fakeBrowser(pathname, search = '', state = null) {
    const calls = [];
    const listeners = {};
    globalThis.location = { pathname, search };
    const entries = [{ url: pathname + search, state }];
    let at = 0;
    const show = () => {
        const u = new URL(entries[at].url, 'http://x');
        globalThis.location.pathname = u.pathname;
        globalThis.location.search = u.search;
    };
    const here = () => globalThis.location.pathname + globalThis.location.search;
    globalThis.history = {
        get state() { return entries[at].state; },
        get length() { return entries.length; },
        pushState: (s, t, url) => {
            calls.push(['push', url]);
            entries.splice(at + 1, entries.length, { url: url ?? here(), state: s });
            at += 1;
            show();
        },
        replaceState: (s, t, url) => {
            calls.push(['replace', url]);
            entries[at] = { url: url ?? here(), state: s };
            show();
        },
        go: (delta) => calls.push(['go', delta]),
        back: () => calls.push(['back'])
    };
    globalThis.window = { addEventListener: (type, fn) => { (listeners[type] ||= []).push(fn); } };
    globalThis.document = { querySelector: () => null, querySelectorAll: () => [], getElementById: () => null };
    const traverse = (delta) => { at += delta; show(); };
    return { calls, listeners, entries, traverse, at: () => at };
}

function fakeApp(startPage) {
    const app = {
        _currentPage: startPage,
        switched: [],
        switchPage(page, opts) {
            app.switched.push([page, opts]);
            app._currentPage = page;
            recordView(app, { page, subTab: currentSubTab(app, page, opts?.subTab) });
        }
    };
    return app;
}

afterEach(() => {
    delete globalThis.location; delete globalThis.history; delete globalThis.window; delete globalThis.document;
});

test('recordView pushes a new address and skips the current one', () => {
    const { calls } = fakeBrowser('/');
    const app = fakeApp('health');
    recordView(app, { page: 'ledger' });
    recordView(app, { page: 'ledger' });
    expect(calls).toEqual([['push', '/ledger']]);
    recordView(app, { page: 'strategy' }, 'replace');
    expect(calls[1]).toEqual(['replace', '/plan']);
});

test('recordView drops the settings field', () => {
    const { calls } = fakeBrowser('/');
    recordView(fakeApp('health'), { page: 'ledger', settings: 'security' });
    expect(calls).toEqual([['push', '/ledger']]);
});

test('currentSubTab defaults per page', () => {
    fakeBrowser('/');
    const app = fakeApp('health');
    expect(currentSubTab(app, 'liabilities')).toBe('debts');
    expect(currentSubTab(app, 'savings')).toBe('emergency');
    app.savingsSubTab = 'home';
    expect(currentSubTab(app, 'savings')).toBe('home');
    expect(currentSubTab(app, 'reports')).toBe('calendar');
    globalThis.document = { querySelector: () => ({ getAttribute: () => 'spending' }) };
    expect(currentSubTab(app, 'reports')).toBe('spending');
    expect(currentSubTab(app, 'ledger')).toBeNull();
    expect(currentSubTab(app, 'liabilities', 'expenses')).toBe('expenses');
});

test('applyLocation switches without pushing and canonicalises with replace', () => {
    const { calls } = fakeBrowser('/', '?page=strategy');
    const app = fakeApp(undefined);
    applyLocation(app);
    expect(app.switched).toEqual([['strategy', { subTab: null, resetToDefaults: true }]]);
    expect(calls).toEqual([['replace', '/plan']]);
});

test('applyLocation leaves a canonical address alone and skips the current view', () => {
    const { calls } = fakeBrowser('/ledger');
    const app = fakeApp('ledger');
    applyLocation(app);
    expect(app.switched).toEqual([]);
    expect(calls).toEqual([]);
});

test('applyLocation keeps view state when only the sub-tab changes', () => {
    fakeBrowser('/liabilities/debts');
    const app = fakeApp('liabilities');
    app.liabilitiesSubTab = 'expenses';
    applyLocation(app);
    expect(app.switched).toEqual([['liabilities', { subTab: 'debts', resetToDefaults: false }]]);
});

test('initRouter registers one popstate listener that applies the address', () => {
    const { calls, listeners } = fakeBrowser('/');
    const app = fakeApp('health');
    initRouter(app);
    initRouter(app);
    expect(listeners.popstate).toHaveLength(1);
    globalThis.location.pathname = '/ledger';
    listeners.popstate[0]();
    expect(app.switched).toEqual([['ledger', { subTab: null, resetToDefaults: true }]]);
    // The only write: the first entry gets index 0 (#734).
    expect(calls).toEqual([['replace', undefined]]);
});

// ── Task 5 glue: recordSettings / leaveSettings / applySettingsFromLocation ──

function settingsBrowser(pathname, search = '', modalOpen = false, state = null) {
    const env = fakeBrowser(pathname, search, state);
    const modal = { classList: { contains: (c) => c === 'hidden' && !env.modalOpen } };
    env.modalOpen = modalOpen;
    globalThis.document = { querySelector: () => null, getElementById: (id) => (id === 'settingsModal' ? modal : null) };
    return env;
}

function settingsApp(env, page) {
    const app = fakeApp(page);
    app.settingsCalls = [];
    app.openSettings = (opts) => {
        app.settingsCalls.push(['open', opts]);
        env.modalOpen = true;
        recordSettings(opts.page || '', 'push'); // a no-op while applying
    };
    app.closeSettings = (opts) => { app.settingsCalls.push(['close', opts]); env.modalOpen = false; };
    return app;
}

test('recordSettings pushes on open, replaces inside, leaveSettings steps back', () => {
    const env = settingsBrowser('/ledger', '', false, { mf: 0 });
    initRouter(fakeApp('ledger'));
    recordSettings('', 'push');
    recordSettings('security', 'replace');
    recordSettings('security', 'replace');
    leaveSettings();
    expect(env.calls).toEqual([['push', '/ledger?settings'], ['replace', '/ledger?settings=security'], ['back']]);
});

test('leaveSettings replaces when the open was not pushed (bookmark)', () => {
    const env = settingsBrowser('/ledger', '?settings=security');
    leaveSettings();
    expect(env.calls).toEqual([['replace', '/ledger']]);
});

test('leaveSettings does nothing once a page change dropped ?settings', () => {
    const env = settingsBrowser('/ledger');
    recordSettings('backup', 'push');
    recordView(fakeApp('ledger'), { page: 'reports', subTab: 'calendar' });
    leaveSettings();
    // The page takes over the entry Settings pushed: no stray ?settings entry.
    expect(env.calls).toEqual([['push', '/ledger?settings=backup'], ['replace', '/reports/calendar']]);
});

test('a page change from a bookmarked ?settings address drops it before pushing', () => {
    const env = settingsBrowser('/ledger', '?settings=security');
    recordView(fakeApp('ledger'), { page: 'accounts' });
    expect(env.calls).toEqual([['replace', '/ledger'], ['push', '/accounts']]);
});

test('applySettingsFromLocation opens Settings without recording; popstate closes it', () => {
    const env = settingsBrowser('/reports/spending', '?settings=backup');
    const app = settingsApp(env, 'reports');
    applySettingsFromLocation(app);
    expect(app.settingsCalls).toEqual([['open', { page: 'backup' }]]);
    expect(env.calls).toEqual([]);
    globalThis.location.search = '';
    globalThis.document.querySelector = () => ({ getAttribute: () => 'spending' });
    applyLocation(app);
    expect(app.settingsCalls[1]).toEqual(['close', { fromHistory: true }]);
    expect(env.calls).toEqual([]);
});

// ── Phase 2 Task 1 (#731): Back closes the innermost overlay or inline edit ──

// Each module renders its inline edit's name input as <prefix><record id>.
const EDIT_INPUTS = {
    editingAccountId: 'ac-name-', editingBonusId: 'be-name-', editingExpenseId: 'ee-name-',
    editingIncomeId: 'ie-name-', editingPersonId: 'pe-name-', editingRecurringId: 're-name-'
};

// A minimal element: shown unless `hidden`; contains() walks `children`.
function fakeEl(id, { hidden = false, children = [] } = {}) {
    const el = {
        id,
        dispatched: [],
        classList: { contains: (c) => c === 'hidden' && el.hidden },
        hidden,
        getClientRects: () => (el.hidden ? [] : [{}]),
        contains: (other) => other === el || children.some(c => c.contains(other)),
        dispatchEvent: (ev) => { el.dispatched.push(ev); return true; }
    };
    return el;
}

function overlayDocument({ overlays = [], byId = {}, active = null } = {}) {
    globalThis.document = {
        querySelector: () => null,
        querySelectorAll: () => overlays,
        getElementById: (id) => byId[id] || null,
        activeElement: active
    };
}

function editApp(page) {
    const app = fakeApp(page);
    app.cancelled = [];
    for (const name of [...Object.values(EDIT_CANCELLERS), 'cancelEdit', 'cancelInlineEdit']) {
        app[name] = () => app.cancelled.push(name);
    }
    return app;
}

test('the gates and the edit cancellers are the agreed lists', () => {
    expect(GATE_IDS).toEqual(['loginGate', 'serverUnreachableGate']);
    expect(EDIT_CANCELLERS).toEqual({
        editingAccountId: 'cancelEditAccount', editingBillId: 'cancelEditBill', editingBonusId: 'cancelEditBonus',
        editingExpenseId: 'cancelEditExpense', editingIncomeId: 'cancelEditIncome', editingPersonId: 'cancelEditPerson',
        editingRecurringId: 'cancelEditRecurring'
    });
});

test('closeInnermost returns false with nothing open', () => {
    fakeBrowser('/ledger');
    overlayDocument();
    const app = editApp('ledger');
    expect(topOverlay()).toBeNull();
    expect(closeInnermost(app)).toBe(false);
    expect(app.cancelled).toEqual([]);
});

test.each(Object.entries(EDIT_INPUTS))('closeInnermost cancels a shown %s edit', (field, prefix) => {
    fakeBrowser('/');
    overlayDocument({ byId: { [prefix + 7]: fakeEl(prefix + 7) } });
    const app = editApp('health');
    app[field] = 7;
    expect(closeInnermost(app)).toBe(true);
    expect(app.cancelled).toEqual([EDIT_CANCELLERS[field]]);
});

test('an editing field whose edit UI is not shown does not swallow Back', () => {
    fakeBrowser('/liabilities/expenses');
    const hiddenRow = fakeEl('inline-name-3', { hidden: true });
    overlayDocument({ byId: { 'inline-name-3': hiddenRow } });
    const app = editApp('liabilities');
    app.editingDebtId = 3;        // rendered on the hidden Debts panel
    app.editingAccountId = 7;     // not rendered at all (another page)
    app.editingBillId = 2;        // bills have no edit UI
    expect(closeInnermost(app)).toBe(false);
    expect(app.cancelled).toEqual([]);
});

test('an inline debt edit is cancelled while its row is shown', () => {
    fakeBrowser('/liabilities/debts');
    overlayDocument({ byId: { 'inline-name-3': fakeEl('inline-name-3') } });
    const app = editApp('liabilities');
    app.editingDebtId = 3;
    expect(closeInnermost(app)).toBe(true);
    expect(app.cancelled).toEqual(['cancelInlineEdit']);
});

test('an overlay is closed with Escape before any inline edit', () => {
    fakeBrowser('/accounts');
    globalThis.KeyboardEvent = class { constructor(type, init) { Object.assign(this, { type }, init); } };
    const button = fakeEl('btn');
    const dialog = fakeEl('ledgerExportModal', { children: [button] });
    overlayDocument({ overlays: [dialog], active: button });
    const app = editApp('accounts');
    app.editingAccountId = 7;
    expect(topOverlay()).toBe(dialog);
    expect(closeInnermost(app)).toBe(true);
    expect(app.cancelled).toEqual([]);
    expect(button.dispatched).toEqual([expect.objectContaining({ type: 'keydown', key: 'Escape', bubbles: true, cancelable: true })]);
    delete globalThis.KeyboardEvent;
});

test('topOverlay skips gates, Settings and hidden overlays, and prefers the one holding focus', () => {
    fakeBrowser('/');
    const inner = fakeEl('inner');
    const a = fakeEl('a', { children: [inner] });
    const b = fakeEl('b');
    const settings = fakeEl('settingsModal');
    const gate = fakeEl('loginGate', { hidden: true });
    const hidden = fakeEl('c', { hidden: true });
    overlayDocument({ overlays: [a, b, settings, gate, hidden], active: inner });
    expect(topOverlay()).toBe(a);
    globalThis.document.activeElement = null;
    expect(topOverlay()).toBe(b);
});

test('with a gate up closeInnermost does nothing, so Back applies the address', () => {
    fakeBrowser('/accounts');
    const gate = fakeEl('loginGate');
    overlayDocument({ overlays: [gate, fakeEl('x')], byId: { loginGate: gate, 'ac-name-7': fakeEl('ac-name-7') } });
    const app = editApp('accounts');
    app.editingAccountId = 7;
    expect(closeInnermost(app)).toBe(false);
});

test('popstate over an open edit restores the address and keeps the page', () => {
    const { calls } = fakeBrowser('/accounts');
    overlayDocument({ byId: { 'ac-name-7': fakeEl('ac-name-7') } });
    const app = editApp('accounts');
    applyLocation(app); // the view on screen: /accounts
    app.editingAccountId = 7;
    globalThis.location.pathname = '/plan';
    onPopState(app);
    expect(app.cancelled).toEqual(['cancelEditAccount']);
    expect(app.switched).toEqual([]);
    expect(calls).toEqual([['push', '/accounts']]);
});

test('popstate with nothing open applies the address', () => {
    const { calls } = fakeBrowser('/accounts');
    overlayDocument();
    const app = editApp('accounts');
    applyLocation(app);
    globalThis.location.pathname = '/ledger';
    onPopState(app);
    expect(app.switched).toEqual([['ledger', { subTab: null, resetToDefaults: true }]]);
    expect(calls).toEqual([]);
});

test('the pop from leaveSettings stepping back is not treated as a user Back', () => {
    const env = settingsBrowser('/accounts', '', false, { mf: 0 });
    const app = settingsApp(env, 'accounts');
    initRouter(app);
    for (const name of Object.values(EDIT_CANCELLERS)) app[name] = () => { throw new Error('cancelled ' + name); };
    globalThis.document.querySelectorAll = () => [];
    const input = fakeEl('ac-name-7');
    globalThis.document.getElementById = (id) => (id === 'ac-name-7' ? input : null);
    app.editingAccountId = 7;
    recordSettings('', 'push');
    leaveSettings();
    env.traverse(-1);
    onPopState(app);
    expect(env.calls).toEqual([['push', '/accounts?settings'], ['back']]);
    expect(app.editingAccountId).toBe(7);
});

// ── #734: every entry carries an index; Back over a dialog undoes with go() ──

function openDialog() {
    globalThis.KeyboardEvent = class { constructor(type, init) { Object.assign(this, { type }, init); } };
    const dialog = fakeEl('ledgerExportModal');
    globalThis.document.querySelectorAll = () => (dialog.hidden ? [] : [dialog]);
    return dialog;
}

// Boots at '/' and visits the given pages: entries '/' (0), then 1, 2, ...
function visited(...pages) {
    const env = fakeBrowser('/');
    const app = editApp('health');
    initRouter(app);
    applyLocation(app);
    for (const page of pages) app.switchPage(page);
    env.calls.length = 0;
    app.switched.length = 0;
    return { env, app };
}

afterEach(() => { delete globalThis.KeyboardEvent; });

test('a push writes the next index and a replace keeps it', () => {
    const { env, app } = visited();
    expect(globalThis.history.state).toEqual({ mf: 0 });
    recordView(app, { page: 'ledger' });
    expect(globalThis.history.state).toEqual({ mf: 1 });
    recordView(app, { page: 'strategy' }, 'replace');
    expect(globalThis.history.state).toEqual({ mf: 1 });
    expect(env.entries.map(e => e.url)).toEqual(['/', '/plan']);
});

test('initRouter adopts a stored index and assigns 0 to an entry without one', () => {
    fakeBrowser('/ledger', '', { mf: 4 });
    const app = editApp('ledger');
    initRouter(app);
    expect(globalThis.history.state).toEqual({ mf: 4 });
    recordView(app, { page: 'accounts' });
    expect(globalThis.history.state).toEqual({ mf: 5 });
});

test.each([[null], [{}], ['mf'], [7], [{ mf: 'x' }], [{ mf: -1 }]])('initRouter treats state %p as no index', (state) => {
    const { calls } = fakeBrowser('/ledger', '', state);
    initRouter(editApp('ledger'));
    expect(calls).toEqual([['replace', undefined]]);
    expect(globalThis.history.state).toEqual({ mf: 0 });
});

test('Back over an open dialog undoes with go(+1) and never pushes', () => {
    const { env, app } = visited('ledger', 'accounts');
    const dialog = openDialog();
    env.traverse(-1);
    onPopState(app);
    expect(dialog.dispatched).toHaveLength(1);
    expect(env.calls).toEqual([['go', 1]]);
    expect(app.switched).toEqual([]);
});

test('Forward over an open dialog undoes with go(-1)', () => {
    const { env, app } = visited('ledger', 'accounts');
    env.traverse(-1);
    onPopState(app);                                   // Back to /ledger, nothing open
    expect(app.switched.map(s => s[0])).toEqual(['ledger']);
    openDialog();
    env.traverse(1);
    onPopState(app);                                   // Forward over the dialog
    expect(env.calls).toEqual([['go', -1]]);
    expect(app.switched.map(s => s[0])).toEqual(['ledger']);
});

test('a pop two entries back over a dialog returns with one go(2)', () => {
    const { env, app } = visited('ledger', 'accounts', 'income');
    openDialog();
    env.traverse(-2);
    onPopState(app);
    expect(env.calls).toEqual([['go', 2]]);
});

test('the pop the undo causes does not re-trigger the guard', () => {
    const { env, app } = visited('ledger', 'accounts');
    const dialog = openDialog();                       // stays shown in the fake
    env.traverse(-1);
    onPopState(app);
    env.traverse(1);                                   // the go(1) lands
    onPopState(app);
    expect(dialog.dispatched).toHaveLength(1);
    expect(env.calls).toEqual([['go', 1]]);
    expect(app.switched).toEqual([]);
    // The index on screen is still 2: the next page gets 3.
    dialog.hidden = true;
    app.switchPage('income');
    expect(globalThis.history.state).toEqual({ mf: 3 });
});

test('a user pop to another index while an undo is pending is not taken for it', () => {
    const { env, app } = visited('ledger', 'accounts');
    const dialog = openDialog();
    env.traverse(-1);
    onPopState(app);                                   // undo pending: expects index 2
    dialog.hidden = true;
    env.traverse(-1);                                  // a second user Back lands on 0
    onPopState(app);
    expect(app.switched.map(s => s[0])).toEqual(['health']);
    // That pop dropped the undo: a later pop landing on index 2 is applied.
    env.traverse(2);
    onPopState(app);
    expect(app.switched.map(s => s[0])).toEqual(['health', 'accounts']);
});

test('an entry without an index falls back to pushing the address back', () => {
    const { env, app } = visited('ledger', 'accounts');
    env.entries[1].state = null;                       // e.g. the login gate's replaceState
    openDialog();
    env.traverse(-1);
    onPopState(app);
    expect(env.calls).toEqual([['push', '/accounts']]);
    expect(app.switched).toEqual([]);
});

test('leaveSettings steps back only when the entry carries the Settings marker', () => {
    const marked = settingsBrowser('/ledger', '', true, { mf: 2 });
    initRouter(settingsApp(marked, 'ledger'));
    recordSettings('security', 'push');
    leaveSettings();
    expect(marked.calls).toEqual([['push', '/ledger?settings=security'], ['back']]);

    jest.resetModules();
    ({ initRouter, leaveSettings } = require('../../src/router.js'));
    const unmarked = settingsBrowser('/ledger', '?settings=security', true, { mf: 3 });
    initRouter(settingsApp(unmarked, 'ledger'));
    leaveSettings();
    expect(unmarked.calls).toEqual([['replace', '/ledger']]);
    expect(globalThis.history.state).toEqual({ mf: 3 });
});

test('a marked Settings entry from before a reload closes in place, not by a step back', () => {
    // The entry before it belongs to the discarded document: back() would reboot.
    const env = settingsBrowser('/ledger', '?settings=security', true, { mf: 3, settings: true });
    initRouter(settingsApp(env, 'ledger'));
    leaveSettings();
    expect(env.calls).toEqual([['replace', '/ledger']]);
    expect(globalThis.history.state).toEqual({ mf: 3 });
});

test('the palette choosing the page under a Settings entry from before a reload drops it in place', () => {
    const env = settingsBrowser('/ledger', '?settings=security', false, { mf: 3, settings: true });
    initRouter(settingsApp(env, 'ledger'));
    recordView(fakeApp('ledger'), { page: 'ledger' });
    expect(env.calls).toEqual([['replace', '/ledger']]);
    expect(globalThis.history.state).toEqual({ mf: 3 });
});

test('a push before a pending undo lands is based on the entry on screen', () => {
    const { env, app } = visited('ledger', 'accounts');
    const dialog = openDialog();
    env.traverse(-1);
    onPopState(app);                                   // go(1) pending; on screen: index 1
    dialog.hidden = true;
    app.switchPage('income');                          // e.g. a click before go lands
    expect(env.at()).toBe(2);
    expect(globalThis.history.state).toEqual({ mf: 2 });
    expect(env.entries.map(e => e.state && e.state.mf)).toEqual([0, 1, 2]);
});

test('a replace drops a pending undo, so a later pop to its index is applied', () => {
    const { env, app } = visited('ledger', 'accounts');
    const dialog = openDialog();
    env.traverse(-1);
    onPopState(app);                                   // undo pending, expects index 2
    dialog.hidden = true;
    app._currentPage = 'reports';                      // a view change that replaces
    recordView(app, { page: 'reports', subTab: 'calendar' }, 'replace');
    env.traverse(1);                                   // a genuine Forward to index 2
    onPopState(app);
    expect(app.switched.map(s => s[0])).toEqual(['accounts']);
});

test('Settings marks its pushed entry and keeps the mark on replace', () => {
    const env = settingsBrowser('/ledger', '', false, { mf: 2 });
    initRouter(settingsApp(env, 'ledger'));
    recordSettings('', 'push');
    expect(globalThis.history.state).toEqual({ mf: 3, settings: true });
    recordSettings('security', 'replace');
    expect(globalThis.history.state).toEqual({ mf: 3, settings: true });
});

test('the step back from leaveSettings applies the address and syncs the index', () => {
    const env = settingsBrowser('/ledger', '', false, { mf: 2 });
    const app = settingsApp(env, 'ledger');
    initRouter(app);
    applySettingsFromLocation(app);
    app.openSettings({ page: 'security' });
    env.modalOpen = false;                             // closed by its button
    leaveSettings();
    env.traverse(-1);
    onPopState(app);
    expect(env.calls.map(c => c[0])).toEqual(['push', 'back']);
    app.switchPage('accounts');
    expect(globalThis.history.state).toEqual({ mf: 3 });
});

test('the palette choosing the page under Settings steps back; another page replaces', () => {
    const same = settingsBrowser('/ledger', '', false, { mf: 2 });
    initRouter(settingsApp(same, 'ledger'));
    recordSettings('', 'push');
    recordView(fakeApp('ledger'), { page: 'ledger' });
    expect(same.calls).toEqual([['push', '/ledger?settings'], ['back']]);

    jest.resetModules();
    ({ recordView, recordSettings, initRouter } = require('../../src/router.js'));
    const other = settingsBrowser('/ledger', '', false, { mf: 2 });
    initRouter(settingsApp(other, 'ledger'));
    recordSettings('', 'push');
    recordView(fakeApp('ledger'), { page: 'accounts' });
    expect(other.calls).toEqual([['push', '/ledger?settings'], ['replace', '/accounts']]);
    expect(globalThis.history.state).toEqual({ mf: 3 });
});

test('the palette choosing the page under a bookmarked Settings drops it in place', () => {
    const env = settingsBrowser('/ledger', '?settings=security', false, { mf: 0 });
    initRouter(settingsApp(env, 'ledger'));
    recordView(fakeApp('ledger'), { page: 'ledger' });
    expect(env.calls).toEqual([['replace', '/ledger']]);
});

// ── #734 Task 2: router hardening ────────────────────────────────────────────

test('isSettingsOpen is the #settingsModal not-hidden check', () => {
    const env = settingsBrowser('/ledger');
    const { isSettingsOpen } = require('../../src/router.js');
    expect(isSettingsOpen()).toBe(false);
    env.modalOpen = true;
    expect(isSettingsOpen()).toBe(true);
    globalThis.document.getElementById = () => null;
    expect(isSettingsOpen()).toBe(false);
});

// Settings as the app opens it: the open records its address, then the page
// shown (the default one on a wide screen) records itself with a replace.
function wideSettingsApp(env, page, shown = 'appearance') {
    const app = settingsApp(env, page);
    app.openSettings = (opts) => {
        app.settingsCalls.push(['open', opts]);
        env.modalOpen = true;
        recordSettings(opts.page || '', 'push');
        recordSettings(shown, 'replace');
    };
    return app;
}

test('a bare ?settings opened from the address names the page shown, in place', () => {
    const env = settingsBrowser('/', '?settings', false, { mf: 4, settings: true });
    const app = wideSettingsApp(env, 'health');
    initRouter(app);
    applySettingsFromLocation(app);
    expect(env.calls).toEqual([['replace', '/?settings=appearance']]);
    expect(globalThis.history.state).toEqual({ mf: 4, settings: true });
});

test('an unknown Settings page from the address is rewritten to the page shown', () => {
    const env = settingsBrowser('/ledger', '?settings=nope', false, { mf: 1 });
    const app = wideSettingsApp(env, 'ledger');
    initRouter(app);
    applySettingsFromLocation(app);
    expect(env.calls).toEqual([['replace', '/ledger?settings=appearance']]);
    expect(globalThis.history.state).toEqual({ mf: 1 });
});

test('Settings opened by popstate canonicalises after the address is applied', () => {
    const env = settingsBrowser('/ledger', '', false, { mf: 0 });
    const app = wideSettingsApp(env, 'ledger', 'security');
    initRouter(app);
    applySettingsFromLocation(app);
    globalThis.location.search = '?settings';
    onPopState(app);
    expect(app.settingsCalls.map(c => c[0])).toEqual(['open']);
    expect(env.calls).toEqual([['replace', '/ledger?settings=security']]);
});

test('an address that already names the page shown is not rewritten', () => {
    const env = settingsBrowser('/ledger', '?settings=security', false, { mf: 0 });
    const app = wideSettingsApp(env, 'ledger', 'security');
    initRouter(app);
    applySettingsFromLocation(app);
    expect(env.calls).toEqual([]);
});

test('a narrow list opened from a bare ?settings keeps it', () => {
    const env = settingsBrowser('/ledger', '?settings', false, { mf: 0 });
    const app = wideSettingsApp(env, 'ledger', '');
    initRouter(app);
    applySettingsFromLocation(app);
    expect(env.calls).toEqual([]);
});

// ── #747: leftovers from the 8.8.4 review ────────────────────────────────────

test('an Escape handler that navigates keeps the navigation: no go() undo against a truncated target', () => {
    const { env, app } = visited('ledger', 'accounts');
    const dialog = openDialog();
    // The dialog's own Escape handling switches page (here: to income).
    dialog.dispatchEvent = () => { app.switchPage('income'); return true; };
    env.traverse(-1);
    onPopState(app);
    expect(env.calls.map(c => c[0])).toEqual(['push']);
    expect(env.entries[env.at()].state).toEqual({ mf: 2 });
    // The index now matches the position, so a later undo stays correct.
    const dialog2 = openDialog();
    env.calls.length = 0;
    env.traverse(-1);
    onPopState(app);
    expect(dialog2.dispatched).toHaveLength(1);
    expect(env.calls).toEqual([['go', 1]]);
});

test('Settings addresses keep unrelated query parameters (#747)', () => {
    const env = settingsBrowser('/ledger', '?foo=1', false, { mf: 0 });
    recordSettings('security', 'push');
    expect(env.calls).toEqual([['push', '/ledger?settings=security&foo=1']]);
    env.calls.length = 0;
    recordSettings('backup', 'replace');
    expect(env.calls).toEqual([['replace', '/ledger?settings=backup&foo=1']]);
    env.calls.length = 0;
    // Closing in place (an unmarked entry) drops only ?settings.
    env.entries[env.at()].state = { mf: 0 };
    leaveSettings();
    expect(env.calls).toEqual([['replace', '/ledger?foo=1']]);
});

test('a canonical rewrite keeps unrelated parameters and drops only the legacy ?page= (#747)', () => {
    const { calls } = fakeBrowser('/', '?page=strategy&foo=1');
    const app = fakeApp('health');
    initRouter(app);
    applyLocation(app);
    expect(calls).toContainEqual(['replace', '/plan?foo=1']);
});

test('a repeated ?settings is not canonical and collapses to one (#747)', () => {
    const parsed = parseLocation('/', '?settings=a&settings=b');
    expect(parsed).toMatchObject({ settings: 'a', canonical: false });
    expect(buildPath(parsed)).toBe('/?settings=a');
});

test('a render that throws inside applyLocation still canonicalises, flushes and syncs (#747)', () => {
    const { calls } = fakeBrowser('/', '?page=strategy');
    const app = fakeApp('health');
    app.switchPage = () => { throw new Error('render failed'); };
    initRouter(app);
    expect(() => applyLocation(app)).toThrow('render failed');
    // The address was still rewritten in place, and applying was reset, so the
    // next record is not swallowed.
    expect(calls).toContainEqual(['replace', '/plan']);
    app._currentPage = 'ledger';
    recordView(app, { page: 'ledger' });
    expect(calls).toContainEqual(['push', '/ledger']);
});

test('a throwing Settings open does not leave a stale page that a later apply replays (#747)', () => {
    const env = settingsBrowser('/ledger', '?settings', false, { mf: 0 });
    const app = wideSettingsApp(env, 'ledger');
    app.openSettings = () => { env.modalOpen = true; recordSettings('security', 'replace'); throw new Error('boom'); };
    initRouter(app);
    expect(() => applySettingsFromLocation(app)).toThrow('boom');
    // The failed apply itself still flushed the page it was handed, so the address names the
    // page Settings shows (on the old code the flush was skipped and it stayed a bare ?settings).
    expect(env.calls).toEqual([['replace', '/ledger?settings=security']]);
});

test('a password-reset token is never carried into a Settings address (#747)', () => {
    const env = settingsBrowser('/', '?reset_token=abc123&foo=1', false, { mf: 0 });
    recordSettings('security', 'push');
    expect(env.calls).toEqual([['push', '/?settings=security&foo=1']]);
    env.calls.length = 0;
    // Nor by an in-place close or the canonical rewrite.
    env.entries[env.at()].state = { mf: 0 };
    leaveSettings();
    expect(env.calls).toEqual([['replace', '/?foo=1']]);
});

test('an Escape handler that replaces the entry keeps the index and skips the undo (#747)', () => {
    const { env, app } = visited('ledger', 'accounts');
    const dialog = openDialog();
    dialog.dispatchEvent = () => { recordView(app, { page: 'accounts', subTab: null }, 'replace'); return true; };
    env.traverse(-1);
    onPopState(app);
    expect(env.calls.map(c => c[0])).toEqual(['replace']);
});
