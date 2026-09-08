import { createCrudResource } from '../crudRouter.js';
import { sanitizeRetirementSnapshot } from '../sanitizers/index.js';

export default createCrudResource({
    table: 'retirement_snapshots',
    sanitize: sanitizeRetirementSnapshot,
    requiredFields: ['accountId'],
    foreignKeys: { accountId: 'accounts' },
    columns: {
        id: 'id',
        accountId: 'account_id',
        date: 'date',
        balance: 'balance',
        contribution: 'contribution'
    }
});
