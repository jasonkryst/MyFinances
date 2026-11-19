import { renderBalanceChart } from '../../src/charts.js';
import { setLocale } from '../../src/i18n.js';

describe('Plan chart axis follows the selected currency (issue #509)', () => {
    const realStorage = global.localStorage;
    let config;

    beforeEach(() => {
        global.document = {
            documentElement: {},
            querySelectorAll: () => [],
            getElementById: () => ({ getContext: () => ({}) }),
        };
        global.DebtCalculator = require('../../src/debtCalculator.js');
        global.Chart = jest.fn((ctx, cfg) => { config = cfg; });
        global.localStorage = { getItem: () => 'PLN', setItem: () => {} };
        setLocale(null, 'pl');
    });

    afterEach(() => {
        setLocale(null, 'en');
        global.localStorage = realStorage;
        delete global.Chart;
        delete global.DebtCalculator;
        delete global.document;
    });

    test('balance axis ticks use the currency and locale', () => {
        const app = { lastPaymentPlan: [{ month: 1, payments: [{ debtName: 'Card', balance: 1234 }] }] };
        renderBalanceChart(app);
        const tick = config.options.scales.y.ticks.callback(1234);
        expect(tick).toBe(new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN', minimumFractionDigits: 2 }).format(1234));
        expect(tick).not.toContain('$');
    });
});
