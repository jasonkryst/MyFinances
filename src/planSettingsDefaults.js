// The plan-settings row as it is after Clear All Data or at the start of a
// replace import (#529). Pure and import-free: the browser's pgDeleteAll
// (postgresSync.js) and the server's POST /api/import (server/src/importStore.js)
// both read this one copy, and tests/features/test_harness_reset.py checks the
// test harness's HTTP wipe against it.
export const DEFAULT_PLAN_SETTINGS = {
    strategy: null,
    monthlyPayment: null,
    perMonthStimulus: [],
    ledgerSettings: { accountFilter: 'all', dateRange: 'around7', sortKey: 'date', sortDir: 'desc', clearedFilter: 'all', categoryFilter: 'all', pageSize: 25 },
    forecastSettings: { rangeMonths: 1, accountId: 'total', notableThresholdPct: 130 },
    retirementTargetDate: null,
    homePurchasePlan: null,
    budgetCategories: {},
    reconDrafts: {}
};
