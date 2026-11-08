// Unit tests for buildPlanSettingsPatch (issues #564, #521): a partial PATCH
// body holds only the named plan-settings fields.
const { buildPlanSettingsPatch, PLAN_SETTINGS_FIELDS } = require('../../src/planSettingsPatch.js');

function makeApp(overrides = {}) {
    return {
        _ledgerAccountFilter: '7', _ledgerDateRange: 'next30',
        _ledgerSortKey: 'amount', _ledgerSortDir: 'asc', _ledgerClearedFilter: 'cleared',
        _forecastRangeMonths: 6, _forecastAccountId: '7', _forecastNotableThresholdPct: 150,
        retirementTargetDate: '2050-01-01',
        homePurchasePlan: { targetHomePrice: 300000 },
        budgetCategories: { Food: { mode: 'fixed', amount: 400 } },
        perMonthStimulus: [100, 0, 50],
        ...overrides
    };
}

const inputs = (monthlyPayment, strategy) => () => ({ monthlyPayment, strategy });

describe('buildPlanSettingsPatch: positive', () => {
    test('a single field yields a body with only that key', () => {
        const { body, unknown } = buildPlanSettingsPatch(makeApp(), ['budgetCategories']);
        expect(body).toEqual({ budgetCategories: { Food: { mode: 'fixed', amount: 400 } } });
        expect(unknown).toEqual([]);
    });

    test('a string is accepted as one field', () => {
        expect(buildPlanSettingsPatch(makeApp(), 'retirementTargetDate').body)
            .toEqual({ retirementTargetDate: '2050-01-01' });
    });

    test('several fields are all included, nothing else', () => {
        const { body } = buildPlanSettingsPatch(makeApp(), ['monthlyPayment', 'strategy'], inputs('750.5', 'snowball'));
        expect(body).toEqual({ monthlyPayment: 750.5, strategy: 'snowball' });
    });

    test('every listed field has a builder', () => {
        const { body, unknown } = buildPlanSettingsPatch(makeApp(), PLAN_SETTINGS_FIELDS, inputs('1', 'avalanche'));
        expect(unknown).toEqual([]);
        expect(Object.keys(body).sort()).toEqual([...PLAN_SETTINGS_FIELDS].sort());
    });

    test('ledgerSettings and forecastSettings are sent as whole objects', () => {
        const { body } = buildPlanSettingsPatch(makeApp(), ['ledgerSettings', 'forecastSettings']);
        expect(body.ledgerSettings).toEqual({
            accountFilter: '7', dateRange: 'next30', sortKey: 'amount', sortDir: 'asc', clearedFilter: 'cleared'
        });
        expect(body.forecastSettings).toEqual({ rangeMonths: 6, accountId: '7', notableThresholdPct: 150 });
    });

    test('ledgerSettings stores the pre-cross-navigation filters while one is showing', () => {
        const app = makeApp({
            _ledgerCrossNavLabel: 'Food', _ledgerAccountFilter: 'all', _ledgerDateRange: 'all',
            _ledgerPreCrossNavAccount: '3', _ledgerPreCrossNavDateRange: 'around7'
        });
        const { body } = buildPlanSettingsPatch(app, ['ledgerSettings']);
        expect(body.ledgerSettings.accountFilter).toBe('3');
        expect(body.ledgerSettings.dateRange).toBe('around7');
    });

    test('perMonthStimulus fills holes and drops invalid values to 0', () => {
        const stim = [];
        stim[2] = 75;
        stim[4] = -5;
        stim[5] = NaN;
        const { body } = buildPlanSettingsPatch(makeApp({ perMonthStimulus: stim }), ['perMonthStimulus']);
        expect(body.perMonthStimulus).toEqual([0, 0, 75, 0, 0, 0]);
        expect(JSON.stringify(body)).not.toContain('null');
    });

    test('defaults fill unset app state', () => {
        const { body } = buildPlanSettingsPatch({}, ['ledgerSettings', 'forecastSettings', 'retirementTargetDate',
            'homePurchasePlan', 'budgetCategories', 'perMonthStimulus']);
        expect(body).toEqual({
            ledgerSettings: { accountFilter: 'all', dateRange: 'around7', sortKey: 'date', sortDir: 'desc', clearedFilter: 'all' },
            forecastSettings: { rangeMonths: 1, accountId: 'total', notableThresholdPct: 130 },
            retirementTargetDate: null,
            homePurchasePlan: null,
            budgetCategories: {},
            perMonthStimulus: []
        });
    });
});

describe('buildPlanSettingsPatch: negative', () => {
    test.each([[undefined], [null], [[]], [42], [{}]])('no usable fields (%p) gives a null body', fields => {
        expect(buildPlanSettingsPatch(makeApp(), fields).body).toBeNull();
    });

    test('unknown names are reported and never sent', () => {
        const { body, unknown } = buildPlanSettingsPatch(makeApp(), ['budgetCategories', 'debts', '__proto__', 'constructor']);
        expect(body).toEqual({ budgetCategories: { Food: { mode: 'fixed', amount: 400 } } });
        expect(unknown).toEqual(['debts', '__proto__', 'constructor']);
    });

    test('only unknown names gives a null body', () => {
        const { body, unknown } = buildPlanSettingsPatch(makeApp(), ['nope']);
        expect(body).toBeNull();
        expect(unknown).toEqual(['nope']);
    });

    test('the Plan inputs are not read unless monthlyPayment or strategy is named', () => {
        const read = jest.fn(() => ({ monthlyPayment: '999', strategy: 'snowball' }));
        buildPlanSettingsPatch(makeApp(), ['budgetCategories', 'ledgerSettings', 'forecastSettings',
            'retirementTargetDate', 'homePurchasePlan', 'perMonthStimulus'], read);
        expect(read).not.toHaveBeenCalled();
    });

    test.each([['', null], ['0', null], ['abc', null], [undefined, null], ['12.5', 12.5]])(
        'monthlyPayment %p is sent as %p', (raw, expected) => {
            expect(buildPlanSettingsPatch({}, ['monthlyPayment'], inputs(raw)).body).toEqual({ monthlyPayment: expected });
        });

    test('an empty strategy is sent as null', () => {
        expect(buildPlanSettingsPatch({}, ['strategy'], inputs(undefined, '')).body).toEqual({ strategy: null });
    });
});
