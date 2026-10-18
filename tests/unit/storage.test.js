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
    global.document = { getElementById: () => null };
});

beforeEach(() => {
    jest.useFakeTimers();
});

afterEach(() => {
    flushStorageSave(); // drain any pending write
    jest.useRealTimers();
});

describe('saveToStorage debounce (local/session backend)', () => {
    test('does not write immediately on first call', () => {
        const app = makeApp();
        saveToStorage(app);
        expect(app.storageAdapter.set).not.toHaveBeenCalled();
    });

    test('writes exactly once after the timer fires', () => {
        const app = makeApp();
        saveToStorage(app);
        jest.runAllTimers();
        expect(app.storageAdapter.set).toHaveBeenCalledTimes(1);
    });

    test('rapid-fire calls collapse to a single write', () => {
        const app = makeApp();
        saveToStorage(app);
        saveToStorage(app);
        saveToStorage(app);
        jest.runAllTimers();
        expect(app.storageAdapter.set).toHaveBeenCalledTimes(1);
    });

    test('a second batch after the first fires produces its own single write', () => {
        const app = makeApp();
        saveToStorage(app);
        jest.runAllTimers();
        saveToStorage(app);
        jest.runAllTimers();
        expect(app.storageAdapter.set).toHaveBeenCalledTimes(2);
    });
});

describe('flushStorageSave', () => {
    test('immediately writes when a debounced save is pending', () => {
        const app = makeApp();
        saveToStorage(app);
        expect(app.storageAdapter.set).not.toHaveBeenCalled();
        flushStorageSave();
        expect(app.storageAdapter.set).toHaveBeenCalledTimes(1);
    });

    test('is a no-op when nothing is pending', () => {
        // no saveToStorage call — flushStorageSave should not throw
        expect(() => flushStorageSave()).not.toThrow();
    });

    test('prevents the debounce timer from firing again after flush', () => {
        const app = makeApp();
        saveToStorage(app);
        flushStorageSave();
        jest.runAllTimers();
        expect(app.storageAdapter.set).toHaveBeenCalledTimes(1); // not twice
    });
});

describe('saveToStorage postgres backend (not debounced)', () => {
    test('does not call storageAdapter.set for the postgres backend', () => {
        global.fetch = jest.fn(() => Promise.resolve({ ok: true }));
        const app = makeApp({ _storageBackendKind: 'postgres' });
        saveToStorage(app);
        jest.runAllTimers();
        expect(app.storageAdapter.set).not.toHaveBeenCalled();
        delete global.fetch;
    });

    test('returns a Promise for the postgres backend', () => {
        global.fetch = jest.fn(() => Promise.resolve({ ok: true }));
        const app = makeApp({ _storageBackendKind: 'postgres' });
        const result = saveToStorage(app);
        expect(result).toBeInstanceOf(Promise);
        delete global.fetch;
    });
});
