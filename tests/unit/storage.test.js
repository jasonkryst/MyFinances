jest.mock('../../src/postgresSync.js', () => ({ pgDeleteAll: jest.fn() }));
jest.mock('../../src/storageAdapters.js', () => ({
    createStorageAdapter: jest.fn(() => ({ get: () => null, set: jest.fn(), remove: jest.fn() })),
    setStorageBackendPreference: jest.fn(),
    getStorageBackendPreference: jest.fn(() => 'local'),
}));

const { saveToStorage, flushStorageSave } = require('../../src/storage.js');

function makeApp(overrides = {}) {
    return {
        _storageBackendKind: 'local',
        storageAdapter: { get: () => null, set: jest.fn(), remove: jest.fn() },
        storageKey: 'debtTrackerData',
        debts: [], accounts: [], incomes: [], bonuses: [], bills: [], expenses: [],
        persons: [], recurringTemplates: [], emergencyFunds: [], sinkingFunds: [],
        reconciliations: [], planHistory: [], retirementSnapshots: [],
        retirementTargetDate: null, balanceHistory: [], settings: [],
        monthlySnapshots: [], netWorthMilestonesAwarded: [], perMonthStimulus: [],
        ledgerAmountOverrides: {}, ledgerClearedTransactions: {},
        _ledgerAccountFilter: 'all', _ledgerDateRange: 'around7',
        _ledgerSortKey: 'date', _ledgerSortDir: 'desc', _ledgerClearedFilter: 'all',
        _forecastRangeMonths: 1, _forecastAccountId: 'total',
        _forecastNotableThresholdPct: 130, _storageQuotaWarned: false,
        showStorageQuotaWarning: jest.fn(),
        ...overrides,
    };
}

beforeAll(() => {
    global.document = { getElementById: () => null, cookie: '' };
});

beforeEach(() => {
    jest.useFakeTimers();
});

afterEach(() => {
    flushStorageSave(); // drain any pending trailing write
    jest.useRealTimers();
});

// saveToStorage uses a leading+trailing debounce strategy:
//   - first call in a quiet period writes immediately (leading edge)
//   - rapid follow-on calls within 300ms are deferred to a trailing write
describe('saveToStorage debounce — leading edge (local/session backend)', () => {
    test('writes immediately on the first call', () => {
        const app = makeApp();
        saveToStorage(app);
        expect(app.storageAdapter.set).toHaveBeenCalledTimes(1);
    });

    test('a single call with no follow-ons does not write a second time', () => {
        const app = makeApp();
        saveToStorage(app);
        jest.runAllTimers();
        expect(app.storageAdapter.set).toHaveBeenCalledTimes(1);
    });

    test('after the debounce window expires the next call writes immediately again', () => {
        const app = makeApp();
        saveToStorage(app); // write 1
        jest.runAllTimers(); // close debounce window
        saveToStorage(app); // write 2 (new leading edge)
        expect(app.storageAdapter.set).toHaveBeenCalledTimes(2);
    });
});

describe('saveToStorage debounce — trailing edge (rapid-fire)', () => {
    test('rapid-fire calls after the first are held until the trailing timer fires', () => {
        const app = makeApp();
        saveToStorage(app); // immediate (leading)
        saveToStorage(app); // start trailing debounce
        saveToStorage(app); // reset trailing debounce
        expect(app.storageAdapter.set).toHaveBeenCalledTimes(1);
        jest.runAllTimers();
        expect(app.storageAdapter.set).toHaveBeenCalledTimes(2);
    });

    test('many rapid calls collapse to just two writes total', () => {
        const app = makeApp();
        for (let i = 0; i < 20; i++) saveToStorage(app);
        expect(app.storageAdapter.set).toHaveBeenCalledTimes(1); // leading only
        jest.runAllTimers();
        expect(app.storageAdapter.set).toHaveBeenCalledTimes(2); // + trailing
    });
});

describe('flushStorageSave', () => {
    test('immediately flushes a pending trailing write', () => {
        const app = makeApp();
        saveToStorage(app); // leading write
        saveToStorage(app); // pending trailing
        const before = app.storageAdapter.set.mock.calls.length;
        flushStorageSave();
        expect(app.storageAdapter.set).toHaveBeenCalledTimes(before + 1);
    });

    test('is a no-op when only the cooldown timer is active (no pending write)', () => {
        const app = makeApp();
        saveToStorage(app); // leading write + cooldown, no pending
        const before = app.storageAdapter.set.mock.calls.length;
        flushStorageSave();
        expect(app.storageAdapter.set).toHaveBeenCalledTimes(before); // unchanged
    });

    test('is a no-op when nothing is pending', () => {
        expect(() => flushStorageSave()).not.toThrow();
    });

    test('prevents the trailing timer from firing a second write after flush', () => {
        const app = makeApp();
        saveToStorage(app);
        saveToStorage(app); // pending trailing
        flushStorageSave();
        jest.runAllTimers();
        expect(app.storageAdapter.set).toHaveBeenCalledTimes(2); // leading + flush, not 3
    });
});

describe('saveToStorage — Postgres backend (not debounced)', () => {
    test('does not call storageAdapter.set for the Postgres backend', () => {
        global.fetch = jest.fn(() => Promise.resolve({ ok: true }));
        const app = makeApp({ _storageBackendKind: 'postgres' });
        saveToStorage(app);
        jest.runAllTimers();
        expect(app.storageAdapter.set).not.toHaveBeenCalled();
        delete global.fetch;
    });

    test('returns a Promise for the Postgres backend', () => {
        global.fetch = jest.fn(() => Promise.resolve({ ok: true }));
        const app = makeApp({ _storageBackendKind: 'postgres' });
        const result = saveToStorage(app);
        expect(result).toBeInstanceOf(Promise);
        delete global.fetch;
    });
});
