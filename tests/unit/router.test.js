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
    const env = settingsBrowser('/ledger');
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
    overlayDocument({ byId: { 'inline-name-3': hiddenRow, 'cancelEditBtn': fakeEl('cancelEditBtn', { hidden: true }) } });
    const app = editApp('liabilities');
    app.editingDebtId = 3;        // rendered on the hidden Debts panel
    app.editingAccountId = 7;     // not rendered at all (another page)
    app.editingBillId = 2;        // bills have no edit UI
    expect(closeInnermost(app)).toBe(false);
    expect(app.cancelled).toEqual([]);
});

test('a debt edit uses the form canceller while #cancelEditBtn is shown, else the inline one', () => {
    fakeBrowser('/liabilities/debts');
    const btn = fakeEl('cancelEditBtn');
    overlayDocument({ byId: { cancelEditBtn: btn, 'inline-name-3': fakeEl('inline-name-3') } });
    const app = editApp('liabilities');
    app.editingDebtId = 3;
    expect(closeInnermost(app)).toBe(true);
    btn.hidden = true;
    expect(closeInnermost(app)).toBe(true);
    expect(app.cancelled).toEqual(['cancelEdit', 'cancelInlineEdit']);
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
    const env = settingsBrowser('/accounts');
    const app = settingsApp(env, 'accounts');
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
    const marked = settingsBrowser('/ledger', '?settings=security', true, { mf: 3, settings: true });
    leaveSettings();
    expect(marked.calls).toEqual([['back']]);
    const unmarked = settingsBrowser('/ledger', '?settings=security', true, { mf: 3 });
    leaveSettings();
    expect(unmarked.calls).toEqual([['replace', '/ledger']]);
    expect(globalThis.history.state).toEqual({ mf: 3 });
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
