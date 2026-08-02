const DebtCalculator = require('../../src/debtCalculator.js');
const { normalizeText } = require('../../src/utils.js');

test('CJS require of debtCalculator.js works', () => {
    expect(typeof DebtCalculator.calculatePaymentPlan).toBe('function');
});

test('Babel-transformed ESM import of utils.js works', () => {
    expect(normalizeText('  hi  ')).toBe('hi');
});
