import { createCrudResource } from '../crudRouter.js';
import { sanitizeBill } from '../sanitizers/index.js';

export default createCrudResource({
    table: 'bills',
    sanitize: sanitizeBill,
    requiredFields: ['name'],
    columns: {
        id: 'id',
        name: 'name',
        amount: 'amount',
        dueDay: 'due_day',
        category: 'category',
        accountId: 'account_id'
    }
});
