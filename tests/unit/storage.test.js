jest.mock('../../src/postgresSync.js', () => ({
    pgDeleteAll: jest.fn(() => Promise.resolve()),
    // The real one counts the write for the Saving chip (#576); here it just runs it.
    trackWrite: jest.fn(fn => fn()),
}));

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

// A fetch that never answers, but rejects (like the browser) once its signal aborts.
function hangingFetch() {
    return jest.fn((url, init = {}) => new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(init.signal.reason || new Error('aborted')));
    }));
}

describe('timeouts', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    test('a probe that never settles is unreachable after PROBE_TIMEOUT_MS', async () => {
        const { PROBE_TIMEOUT_MS } = require('../../src/storage.js');
        global.fetch = hangingFetch();
        const pending = probeServer();
        await jest.advanceTimersByTimeAsync(PROBE_TIMEOUT_MS);
        await expect(pending).resolves.toEqual({ reachable: false });
        expect(global.fetch.mock.calls[0][1].signal).toBeDefined();
    });

    test('a hanging setup-status after a 401 is unreachable too', async () => {
        const { PROBE_TIMEOUT_MS } = require('../../src/storage.js');
        const hang = hangingFetch();
        global.fetch = jest.fn((url, init) => (url === '/api/plan-settings'
            ? Promise.resolve(res(401, {}))
            : hang(url, init)));
        const pending = probeServer();
        await jest.advanceTimersByTimeAsync(PROBE_TIMEOUT_MS);
        await expect(pending).resolves.toEqual({ reachable: false });
    });

    test('a load that never settles rejects after LOAD_TIMEOUT_MS', async () => {
        const { loadFromPostgres, LOAD_TIMEOUT_MS } = require('../../src/storage.js');
        global.fetch = hangingFetch();
        const pending = loadFromPostgres({});
        const assertion = expect(pending).rejects.toBeDefined();
        await jest.advanceTimersByTimeAsync(LOAD_TIMEOUT_MS);
        await assertion;
    });
});

describe('loadFromPostgres errors', () => {
    test('a 401 during load throws SessionExpiredError (re-probe, not the unreachable gate)', async () => {
        const { loadFromPostgres, SessionExpiredError } = require('../../src/storage.js');
        global.fetch = jest.fn((url) => Promise.resolve(url === '/api/debts' ? res(401, {}) : res(200, [])));
        await expect(loadFromPostgres({})).rejects.toBeInstanceOf(SessionExpiredError);
    });

    test('a 500 during load throws a plain error', async () => {
        const { loadFromPostgres, SessionExpiredError } = require('../../src/storage.js');
        global.fetch = jest.fn((url) => Promise.resolve(url === '/api/debts' ? res(500, {}) : res(200, [])));
        const err = await loadFromPostgres({}).catch(e => e);
        expect(err).toBeInstanceOf(Error);
        expect(err).not.toBeInstanceOf(SessionExpiredError);
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

    test('PATCHes only the named fields and resolves true', async () => {
        global.fetch = jest.fn(() => Promise.resolve(res(200, {})));
        await expect(saveToStorage(makeApp(), ['retirementTargetDate'])).resolves.toBe(true);
        expect(global.fetch).toHaveBeenCalledTimes(1);
        const [url, init] = global.fetch.mock.calls[0];
        expect(url).toBe('/api/plan-settings');
        expect(init.method).toBe('PATCH');
        expect(JSON.parse(init.body)).toEqual({ retirementTargetDate: null });
    });

    test('does not read the Plan inputs for a non-Plan field (#564)', async () => {
        global.fetch = jest.fn(() => Promise.resolve(res(200, {})));
        const getById = jest.spyOn(global.document, 'getElementById');
        await saveToStorage(makeApp(), ['budgetCategories', 'ledgerSettings']);
        expect(getById).not.toHaveBeenCalled();
        getById.mockRestore();
    });

    test('resolves false when the request fails', async () => {
        global.fetch = jest.fn(() => Promise.reject(new TypeError('Failed to fetch')));
        const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
        await expect(saveToStorage(makeApp(), ['budgetCategories'])).resolves.toBe(false);
        spy.mockRestore();
    });

    test.each([[undefined], [[]], [['debts']]])('sends nothing without a known field (%p)', async fields => {
        global.fetch = jest.fn(() => Promise.resolve(res(200, {})));
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
        await expect(saveToStorage(makeApp(), fields)).resolves.toBe(true);
        expect(global.fetch).not.toHaveBeenCalled();
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
    });

    test('drops unknown fields but still sends the known ones', async () => {
        global.fetch = jest.fn(() => Promise.resolve(res(200, {})));
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
        await saveToStorage(makeApp(), ['budgetCategories', 'accounts']);
        expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toEqual({ budgetCategories: {} });
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('accounts'));
        warn.mockRestore();
    });
});
