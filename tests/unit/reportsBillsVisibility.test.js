import { renderReportsSummary } from '../../src/reportsSummary.js';
import { renderReportsIncomeExp } from '../../src/reportsCashFlow.js';

describe('Reports Bills visibility (issue #573)', () => {
    let container;

    beforeEach(() => {
        container = { innerHTML: '' };
        global.document = {
            getElementById: jest.fn((id) => {
                if (id === 'reportsSummary' || id === 'reportsIncomeExp') {
                    return container;
                }
                return null;
            })
        };
    });

    afterEach(() => {
        delete global.document;
    });

    function createApp(bills = []) {
        return {
            bills,
            accounts: [],
            ledger: [],
            expenses: [],
            recurring: [],
            debts: [],
            savingsGoals: [],
            sinkingFunds: [],
            debtPlan: [],
            netWorthSnapshots: [],
            computeAccountBalance: () => 0
        };
    }

    describe('renderReportsSummary', () => {
        test('does not render Bills row when app.bills is empty', () => {
            const app = createApp([]);
            renderReportsSummary(app);
            expect(container.innerHTML).not.toContain('rpt-stat--bills');
            expect(container.innerHTML).not.toContain('Facturas');
            expect(container.innerHTML).not.toContain('Bills');
        });

        test('does not render Bills row when app.bills is undefined', () => {
            const app = createApp(undefined);
            renderReportsSummary(app);
            expect(container.innerHTML).not.toContain('Bills');
        });

        test('renders Bills row when legacy bills exist', () => {
            const app = createApp([{ id: 1, name: 'Electric', amount: 120 }]);
            renderReportsSummary(app);
            expect(container.innerHTML).toContain('Bills');
        });
    });

    describe('renderReportsIncomeExp', () => {
        test('does not render Bills stat card when app.bills is empty', () => {
            const app = createApp([]);
            renderReportsIncomeExp(app);
            expect(container.innerHTML).not.toContain('rpt-stat--bills');
        });

        test('does not render Bills stat card when app.bills is undefined', () => {
            const app = createApp(undefined);
            renderReportsIncomeExp(app);
            expect(container.innerHTML).not.toContain('rpt-stat--bills');
        });

        test('renders Bills stat card when legacy bills exist', () => {
            const app = createApp([{ id: 1, name: 'Electric', amount: 120 }]);
            renderReportsIncomeExp(app);
            expect(container.innerHTML).toContain('rpt-stat--bills');
        });
    });
});
