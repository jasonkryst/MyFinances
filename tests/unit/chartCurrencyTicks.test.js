import { renderBalanceChart, renderProgressChart } from '../../src/charts.js';
import { setLocale } from '../../src/i18n.js';

describe('Plan chart axes follow the selected currency (issue #509)', () => {
    const realStorage = global.localStorage;
    let config;
    let currency;

    beforeEach(() => {
        global.document = {
            documentElement: {},
            querySelectorAll: () => [],
            getElementById: () => ({ getContext: () => ({}) }),
        };
        global.DebtCalculator = require('../../src/debtCalculator.js');
        global.Chart = jest.fn((ctx, cfg) => { config = cfg; });
        currency = 'PLN';
        global.localStorage = { getItem: () => currency, setItem: () => {} };
        setLocale(null, 'pl');
    });

    afterEach(() => {
        setLocale(null, 'en');
        global.localStorage = realStorage;
        delete global.Chart;
        delete global.DebtCalculator;
        delete global.document;
    });

    const plan = [{ month: 1, payments: [{ debtName: 'Card', balance: 1234, principal: 100, interest: 10, payment: 110 }] }];
    const plnWhole = v => new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN', maximumFractionDigits: 0 }).format(v);

    test('balance axis ticks use the currency and locale, without cents', () => {
        renderBalanceChart({ lastPaymentPlan: plan });
        const tick = config.options.scales.y.ticks.callback(1234);
        expect(tick).toBe(plnWhole(1234));
        expect(tick).not.toContain('$');
    });

    test('progress axis ticks use the currency and locale', () => {
        renderProgressChart({ lastPaymentPlan: plan });
        const tick = config.options.scales.y.ticks.callback(5000);
        expect(tick).toBe(plnWhole(5000));
        expect(tick).not.toContain('$');
    });

    test('with USD in English the axis still reads in dollars (no regression)', () => {
        currency = 'USD';
        setLocale(null, 'en');
        renderBalanceChart({ lastPaymentPlan: plan });
        expect(config.options.scales.y.ticks.callback(20000)).toBe('$20,000');
    });
});
