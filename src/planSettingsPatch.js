// Builds the body of a partial PATCH /api/plan-settings (issues #564, #521).
//
// The server updates only the fields present in the body, so a save names the
// groups it changed and nothing else is sent. Sending the whole row let a
// stale tab or device overwrite values set elsewhere (category budgets, home
// purchase plan, retirement target, strategy), and every record mutation used
// to send it.
//
// Pure and import-free so it can be unit tested (tests/unit/planSettingsPatch.test.js).

export const PLAN_SETTINGS_FIELDS = Object.freeze([
    'monthlyPayment',
    'strategy',
    'perMonthStimulus',
    'ledgerSettings',
    'forecastSettings',
    'retirementTargetDate',
    'homePurchasePlan',
    'budgetCategories'
]);

const BUILDERS = {
    // The Plan inputs are read only when the caller names them, so a save of
    // any other field never picks up an unsubmitted value typed into the form.
    monthlyPayment: (app, readPlanInputs) => {
        const v = parseFloat(readPlanInputs().monthlyPayment);
        return Number.isFinite(v) && v !== 0 ? v : null;
    },
    strategy: (app, readPlanInputs) => readPlanInputs().strategy || null,
    // The schedule table assigns by month index, so the array can be sparse;
    // Array.from turns holes into 0 instead of JSON nulls.
    perMonthStimulus: app => Array.from(
        Array.isArray(app.perMonthStimulus) ? app.perMonthStimulus : [],
        v => (Number.isFinite(v) && v > 0 ? v : 0)
    ),
    // While a Spending cross-navigation is showing (#315) the account and
    // date filters are temporary; store the user's own ones, as the device
    // copy does (ledger.js persistLedgerFilters).
    ledgerSettings: app => ({
        accountFilter: app._ledgerCrossNavLabel
            ? (app._ledgerPreCrossNavAccount ?? 'all')
            : (app._ledgerAccountFilter || 'all'),
        dateRange: app._ledgerCrossNavLabel
            ? (app._ledgerPreCrossNavDateRange ?? 'around7')
            : (app._ledgerDateRange || 'around7'),
        sortKey: app._ledgerSortKey || 'date',
        sortDir: app._ledgerSortDir || 'desc',
        clearedFilter: app._ledgerClearedFilter || 'all'
    }),
    forecastSettings: app => ({
        rangeMonths: app._forecastRangeMonths || 1,
        accountId: app._forecastAccountId || 'total',
        notableThresholdPct: app._forecastNotableThresholdPct || 130
    }),
    retirementTargetDate: app => app.retirementTargetDate || null,
    homePurchasePlan: app => app.homePurchasePlan || null,
    budgetCategories: app => app.budgetCategories || {}
};

// Returns a body object holding only the named fields, or null when no known
// field was named (the caller then sends nothing). Unknown names are reported
// in `unknown` so the caller can log them; they are never sent.
export function buildPlanSettingsPatch(app, fields, readPlanInputs = () => ({})) {
    const list = Array.isArray(fields) ? fields : (typeof fields === 'string' ? [fields] : []);
    const body = {};
    const unknown = [];
    for (const field of list) {
        if (Object.prototype.hasOwnProperty.call(BUILDERS, field)) {
            body[field] = BUILDERS[field](app, readPlanInputs);
        } else {
            unknown.push(field);
        }
    }
    return { body: Object.keys(body).length > 0 ? body : null, unknown };
}
