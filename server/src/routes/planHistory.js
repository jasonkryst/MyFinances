import { createCrudResource } from '../crudRouter.js';
import { sanitizePlanHistoryEntry } from '../sanitizers/index.js';

export default createCrudResource({
    table: 'plan_history',
    sanitize: sanitizePlanHistoryEntry,
    requiredFields: ['monthlyPayment', 'strategy'],
    columns: {
        id: 'id',
        monthlyPayment: 'monthly_payment',
        strategy: 'strategy',
        totalInterest: 'total_interest',
        monthsToPayOff: 'months_to_pay_off',
        payoffDate: 'payoff_date',
        totalDebt: 'total_debt',
        createdAt: 'created_at'
    }
});
