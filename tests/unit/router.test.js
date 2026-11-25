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
const { recordView, currentSubTab, applyLocation, initRouter } = require('../../src/router.js');

test('PAGE_SECTION_IDS in ui.js has exactly the ROUTE_PAGES keys', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../src/ui.js'), 'utf8');
    const block = source.match(/const PAGE_SECTION_IDS = \{([^}]*)\}/);
    expect(block).not.toBeNull();
    const keys = [...block[1].matchAll(/^\s*([a-z]+)\s*:/gm)].map(m => m[1]);
    expect(keys.sort()).toEqual([...ROUTE_PAGES].sort());
});

function fakeBrowser(pathname, search = '') {
    const calls = [];
    const listeners = {};
    globalThis.location = { pathname, search };
    const move = (url) => {
        const u = new URL(url, 'http://x');
        globalThis.location.pathname = u.pathname;
        globalThis.location.search = u.search;
    };
    globalThis.history = {
        pushState: (s, t, url) => { calls.push(['push', url]); move(url); },
        replaceState: (s, t, url) => { calls.push(['replace', url]); move(url); }
    };
    globalThis.window = { addEventListener: (type, fn) => { (listeners[type] ||= []).push(fn); } };
    globalThis.document = { querySelector: () => null };
    return { calls, listeners };
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
    expect(app.switched).toEqual([['strategy', { subTab: null }]]);
    expect(calls).toEqual([['replace', '/plan']]);
});

test('applyLocation leaves a canonical address alone and skips the current view', () => {
    const { calls } = fakeBrowser('/ledger');
    const app = fakeApp('ledger');
    applyLocation(app);
    expect(app.switched).toEqual([]);
    expect(calls).toEqual([]);
});

test('initRouter registers one popstate listener that applies the address', () => {
    const { calls, listeners } = fakeBrowser('/');
    const app = fakeApp('health');
    initRouter(app);
    initRouter(app);
    expect(listeners.popstate).toHaveLength(1);
    globalThis.location.pathname = '/ledger';
    listeners.popstate[0]();
    expect(app.switched).toEqual([['ledger', { subTab: null }]]);
    expect(calls).toEqual([]);
});
