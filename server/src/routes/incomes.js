import { createCrudResource } from '../crudRouter.js';
import { sanitizeIncome } from '../sanitizers/index.js';

export default createCrudResource({
    table: 'incomes',
    sanitize: sanitizeIncome,
    requiredFields: ['name', 'firstPayDate'],
    foreignKeys: { accountId: 'accounts', personId: 'persons' },
    columns: {
        id: 'id',
        name: 'name',
        amount: 'amount',
        firstPayDate: 'first_pay_date',
        frequency: 'frequency',
        accountId: 'account_id',
        personId: 'person_id'
    }
});
