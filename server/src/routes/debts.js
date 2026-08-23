import { createCrudResource } from '../crudRouter.js';
import { sanitizeDebt } from '../sanitizers/index.js';

export default createCrudResource({
    table: 'debts',
    sanitize: sanitizeDebt,
    requiredFields: ['name'],
    foreignKeys: { accountId: 'accounts' },
    columns: {
        id: 'id',
        name: 'name',
        category: 'category',
        debtType: 'debt_type',
        priority: 'priority',
        accountId: 'account_id',
        accountBalance: 'account_balance',
        originalBalance: 'original_balance',
        interestRate: 'interest_rate',
        minimumPayment: 'minimum_payment',
        originalMinimumPayment: 'original_minimum_payment',
        dueDate: 'due_date',
        debtStartDate: 'debt_start_date',
        fixedAmount: 'fixed_amount',
        fixedStartDate: 'fixed_start_date',
        fixedEndDate: 'fixed_end_date',
        updatedAt: 'updated_at'
    }
});
