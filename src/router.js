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

export function buildPath(view) {
    const page = ROUTE_PAGES.includes(view.page) ? view.page : 'health';
    let path = '/' + SEGMENT_BY_PAGE[page];
    if (view.subTab && ROUTE_SUB_TABS[page]) path += '/' + view.subTab;
    if (view.settings === '') path += '?settings';
    else if (view.settings) path += '?settings=' + view.settings;
    return path;
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
            if (raw !== '' || String(search).includes('settings=')) canonical = false;
        }
    }

    return { page, subTab, settings, canonical };
}

// ── Glue (#730): the address follows the view, Back/Forward move the view ────
// DOM/history access happens only inside these functions. No imports: pages
// are switched through app.switchPage, never a direct ui.js call.

let applying = false;
let listening = false;

// Sub-tab the address should show for `page`.
export function currentSubTab(app, page, requested = null) {
    if (requested) return requested;
    if (page === 'liabilities') return DEFAULT_SUB_TAB.liabilities;
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
    if (mode === 'replace') history.replaceState(null, '', path);
    else history.pushState(null, '', path);
}

// Show the view the address names (boot and popstate). Never pushes; a
// non-canonical address (legacy ?page=, unknown path) is rewritten in place.
export function applyLocation(app) {
    const parsed = parseLocation(location.pathname, location.search);
    const current = app._currentPage;
    const differs = parsed.page !== current
        || (parsed.subTab !== null && parsed.subTab !== currentSubTab(app, current));
    if (differs) {
        applying = true;
        try {
            app.switchPage(parsed.page, { subTab: parsed.subTab });
        } finally {
            applying = false;
        }
    }
    if (!parsed.canonical) {
        history.replaceState(null, '', buildPath({ page: parsed.page, subTab: parsed.subTab }));
    }
}

export function initRouter(app) {
    if (listening) return;
    listening = true;
    window.addEventListener('popstate', () => applyLocation(app));
}
