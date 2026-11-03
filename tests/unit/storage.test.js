jest.mock('../../src/postgresSync.js', () => ({ pgDeleteAll: jest.fn(() => Promise.resolve()) }));

const { saveToStorage, probeServer } = require('../../src/storage.js');

beforeAll(() => {
    global.document = { getElementById: () => null, cookie: '' };
});

afterEach(() => {
    delete global.fetch;
});

// A minimal fetch Response stand-in: `body` is returned by json() (or json()
// rejects when `body` is the NOT_JSON marker, like a real HTML response would).
const NOT_JSON = Symbol('not-json');
function res(status, body) {
    return {
        status,
        ok: status >= 200 && status < 300,
        json: () => (body === NOT_JSON
            ? Promise.reject(new SyntaxError('Unexpected token <'))
            : Promise.resolve(body)),
    };
}

function fetchRoutes(routes) {
    return jest.fn((url) => {
        const handler = routes[url];
        if (!handler) return Promise.reject(new Error(`unexpected fetch ${url}`));
        return handler();
    });
}

describe('probeServer', () => {
    test('plan-settings 200 means a signed-in session, without touching setup-status', async () => {
        global.fetch = fetchRoutes({ '/api/plan-settings': () => Promise.resolve(res(200, { strategy: 'avalanche' })) });
        await expect(probeServer()).resolves.toEqual({ reachable: true, hasSession: true });
        expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    test('401 then setup-status needsSetup:true means first-user setup', async () => {
        global.fetch = fetchRoutes({
            '/api/plan-settings': () => Promise.resolve(res(401, { error: 'UNAUTHENTICATED' })),
            '/auth/setup-status': () => Promise.resolve(res(200, { needsSetup: true })),
        });
        await expect(probeServer()).resolves.toEqual({ reachable: true, hasSession: false, needsSetup: true });
    });

    test('401 then setup-status needsSetup:false means sign-in', async () => {
        global.fetch = fetchRoutes({
            '/api/plan-settings': () => Promise.resolve(res(401, {})),
            '/auth/setup-status': () => Promise.resolve(res(200, { needsSetup: false })),
        });
        await expect(probeServer()).resolves.toEqual({ reachable: true, hasSession: false, needsSetup: false });
    });

    test('a rate-limited (429) setup-status still counts as reachable, sign-in mode', async () => {
        global.fetch = fetchRoutes({
            '/api/plan-settings': () => Promise.resolve(res(401, {})),
            '/auth/setup-status': () => Promise.resolve(res(429, NOT_JSON)),
        });
        await expect(probeServer()).resolves.toEqual({ reachable: true, hasSession: false, needsSetup: false });
    });

    test('setup-status without a boolean needsSetup is unreachable', async () => {
        global.fetch = fetchRoutes({
            '/api/plan-settings': () => Promise.resolve(res(401, {})),
            '/auth/setup-status': () => Promise.resolve(res(200, { hello: 1 })),
        });
        await expect(probeServer()).resolves.toEqual({ reachable: false });
    });

    test('plan-settings 502 (nginx, server down) is unreachable', async () => {
        global.fetch = fetchRoutes({ '/api/plan-settings': () => Promise.resolve(res(502, NOT_JSON)) });
        await expect(probeServer()).resolves.toEqual({ reachable: false });
    });

    test('a network rejection is unreachable', async () => {
        global.fetch = jest.fn(() => Promise.reject(new TypeError('Failed to fetch')));
        await expect(probeServer()).resolves.toEqual({ reachable: false });
    });

    test('a 200 with a non-JSON body (e.g. an HTML fallback page) is unreachable', async () => {
        global.fetch = fetchRoutes({ '/api/plan-settings': () => Promise.resolve(res(200, NOT_JSON)) });
        await expect(probeServer()).resolves.toEqual({ reachable: false });
    });

    test('setup-status failing after a 401 is unreachable', async () => {
        global.fetch = fetchRoutes({
            '/api/plan-settings': () => Promise.resolve(res(401, {})),
            '/auth/setup-status': () => Promise.resolve(res(503, NOT_JSON)),
        });
        await expect(probeServer()).resolves.toEqual({ reachable: false });
    });
});

describe('saveToStorage', () => {
    function makeApp() {
        return {
            _ledgerAccountFilter: 'all', _ledgerDateRange: 'around7',
            _ledgerSortKey: 'date', _ledgerSortDir: 'desc', _ledgerClearedFilter: 'all',
            _forecastRangeMonths: 1, _forecastAccountId: 'total', _forecastNotableThresholdPct: 130,
            retirementTargetDate: null, homePurchasePlan: null, budgetCategories: {},
        };
    }

    test('PATCHes plan settings and resolves true', async () => {
        global.fetch = jest.fn(() => Promise.resolve(res(200, {})));
        await expect(saveToStorage(makeApp())).resolves.toBe(true);
        expect(global.fetch).toHaveBeenCalledTimes(1);
        const [url, init] = global.fetch.mock.calls[0];
        expect(url).toBe('/api/plan-settings');
        expect(init.method).toBe('PATCH');
    });

    test('resolves false when the request fails', async () => {
        global.fetch = jest.fn(() => Promise.reject(new TypeError('Failed to fetch')));
        const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
        await expect(saveToStorage(makeApp())).resolves.toBe(false);
        spy.mockRestore();
    });
});
