import { createCrudResource } from '../crudRouter.js';
import { sanitizeExpense } from '../sanitizers/index.js';

export default createCrudResource({
    table: 'expenses',
    sanitize: sanitizeExpense,
    requiredFields: ['name', 'date'],
    columns: {
        id: 'id',
        name: 'name',
        budgetAmount: 'budget_amount',
        date: 'date',
        category: 'category',
        accountId: 'account_id'
    }
});
