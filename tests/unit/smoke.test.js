const DebtCalculator = require('../../src/debtCalculator.js');
const { normalizeText } = require('../../src/utils.js');

test('CJS require of debtCalculator.js works', () => {
    expect(typeof DebtCalculator.calculatePaymentPlan).toBe('function');
});

test('Babel-transformed ESM import of utils.js works', () => {
    expect(normalizeText('  hi  ')).toBe('hi');
});

// TEMPORARY (#380 verification): deliberately failing so the branch ruleset
// can be shown to block merging. This PR is never merged.
test('deliberately red (#380 ruleset verification)', () => {
    expect(1).toBe(2);
});
