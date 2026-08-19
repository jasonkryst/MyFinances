import { createCrudResource } from '../crudRouter.js';
import { sanitizeAccount } from '../sanitizers/index.js';

export default createCrudResource({
    table: 'accounts',
    sanitize: sanitizeAccount,
    requiredFields: ['name'],
    columns: {
        id: 'id',
        name: 'name',
        type: 'type',
        startingBalance: 'starting_balance',
        interestRate: 'interest_rate'
    }
});
