import { createCrudResource } from '../crudRouter.js';
import { sanitizeBonus } from '../sanitizers/index.js';

export default createCrudResource({
    table: 'bonuses',
    sanitize: sanitizeBonus,
    requiredFields: ['name', 'date'],
    columns: {
        id: 'id',
        name: 'name',
        amount: 'amount',
        date: 'date',
        category: 'category',
        accountId: 'account_id',
        purpose: 'purpose'
    }
});
