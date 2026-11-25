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
