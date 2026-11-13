import { renderHealthDashboard } from '../../src/health.js';
import { setLocale } from '../../src/i18n.js';

describe('Health surplus dates follow the app locale (issue #512)', () => {
    let result;

    beforeEach(() => {
        jest.useFakeTimers({ now: new Date(2026, 0, 1, 9, 0, 0) });
        result = { innerHTML: '' };
        const elements = {
            healthSection: { innerHTML: '', querySelectorAll: () => [] },
            healthSurplusAcct: { value: '1', addEventListener: () => {} },
            healthSurplusResult: result,
        };
        global.document = {
            getElementById: jest.fn((id) => elements[id] || null),
            querySelectorAll: () => [],
            body: { classList: { contains: () => false } },
        };
        setLocale(null, 'pl');
    });

    afterEach(() => {
        setLocale(null, 'en');
        jest.useRealTimers();
        delete global.document;
    });

    test('projected transaction dates use the app locale', () => {
        const app = {
            accounts: [{ id: 1, name: 'Checking', type: 'Checking', startingBalance: 5000 }],
            bills: [{ id: 1, name: 'Rent', amount: 100, dueDay: 15, accountId: 1 }],
            settings: [],
            computeAccountBalance: () => 5000,
        };
        renderHealthDashboard(app);
        expect(result.innerHTML).toContain('15 sty 2026');
    });
});
