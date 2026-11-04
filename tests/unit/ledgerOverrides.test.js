jest.mock('../../src/postgresSync.js', () => ({ pgPut: jest.fn(), pgDelete: jest.fn() }));
jest.mock('../../src/ui.js', () => ({ showAlertModal: jest.fn(), confirmZeroAmountAllowed: jest.fn() }));
jest.mock('../../src/i18n.js', () => ({ t: jest.fn((key) => key) }));

const { pgPut, pgDelete } = require('../../src/postgresSync.js');
const { setLedgerAmountOverride, clearLedgerAmountOverride } = require('../../src/ledgerOverrides.js');

// Override keys are `type|id|accountId|date`, so they can contain `|` and other
// characters that are not valid in a URL path segment unencoded.
const PIPE_KEY = 'expense|42|acct-1|2026-01-31';

function makeApp(overrides = {}) {
    return {
        _storageBackendKind: 'postgres',
        ledgerAmountOverrides: {},
        ...overrides,
    };
}

beforeEach(() => {
    pgPut.mockClear();
    pgDelete.mockClear();
});

describe('override API URLs encode the composite key', () => {
    test('setLedgerAmountOverride PUTs an encoded key', () => {
        const app = makeApp();
        setLedgerAmountOverride(app, PIPE_KEY, '-12.5');
        expect(pgPut).toHaveBeenCalledTimes(1);
        const [, path] = pgPut.mock.calls[0];
        expect(path).toBe(`/api/ledger-overrides/${encodeURIComponent(PIPE_KEY)}`);
        expect(path).not.toContain(PIPE_KEY);
        const sent = pgPut.mock.calls[0][2];
        expect(sent.overrideKey).toBe(PIPE_KEY);
    });

    test('clearLedgerAmountOverride DELETEs an encoded key', () => {
        const app = makeApp({ ledgerAmountOverrides: { [PIPE_KEY]: { amount: 1 } } });
        clearLedgerAmountOverride(app, PIPE_KEY);
        expect(pgDelete).toHaveBeenCalledTimes(1);
        const [, path] = pgDelete.mock.calls[0];
        expect(path).toBe(`/api/ledger-overrides/${encodeURIComponent(PIPE_KEY)}`);
        expect(path).not.toContain(PIPE_KEY);
    });

    test('local backend makes no postgres calls', () => {
        const app = makeApp({ _storageBackendKind: 'local' });
        setLedgerAmountOverride(app, PIPE_KEY, '1');
        clearLedgerAmountOverride(app, PIPE_KEY);
        expect(pgPut).not.toHaveBeenCalled();
        expect(pgDelete).not.toHaveBeenCalled();
    });
});
