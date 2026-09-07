export default {
    packageManager: 'npm',
    testRunner: 'jest',
    reporters: ['html', 'clear-text', 'progress'],
    // Line ranges scope mutation to exactly the functions covered by
    // tests/unit/*.test.js (see spec's per-file function list) — the full files
    // contain many more functions (DOM-coupled or simply out of scope for this
    // first slice) that would otherwise generate trivially-surviving no-coverage
    // mutants and make the score meaningless.
    // Each entry supports exactly one line range (Stryker's mutate-range regex
    // anchors to end-of-string), so multi-range files need one glob per range.
    mutate: [
        'src/debtCalculator.js:41-276', // calculatePaymentPlan
        'src/debtCalculator.js:431-433', // formatDate
        'src/debtCalculator.js:442-454', // calculateMonthsBetweenDates
        'src/utils.js:10-83', // formatCurrency, normalizeText, sanitizeFiniteNumber, parseFiniteOrNull, formatShortDate, formatMonthYear, sanitizeInteger, sanitizeDateISO
        'src/utils.js:92-97', // dateToISO
        'src/utils.js:284-287', // dailyCompoundInterest
        'src/sanitizers.js:5-63', // sanitizeAccount, sanitizeDebt, sanitizeIncome
        'src/sanitizers.js:77-98', // sanitizeBill, sanitizeExpense
        'src/sanitizers.js:100-130', // sanitizeLedgerOverrides, sanitizeLedgerClearedTransactions
        'src/sanitizers.js:131-152', // sanitizeRecurringTemplate
        'src/retirementCalculator.js:3-12', // computeRetirementProjection
        'src/retirementCalculator.js:14-23', // splitGrowthFromContribution
    ],
    jest: {
        configFile: 'jest.config.js',
    },
    // Derived from the real local mutation run (score 48.77%) with mutate scope
    // narrowed to only the tested functions: low = floor(score), break = low-10,
    // high = low+5.
    thresholds: { high: 53, low: 48, break: 38 },
};
