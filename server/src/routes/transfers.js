import { createCrudResource } from '../crudRouter.js';
import { sanitizeTransfer } from '../sanitizers/index.js';

export default createCrudResource({
    table: 'transfers',
    sanitize: sanitizeTransfer,
    requiredFields: ['fromAccountId', 'toAccountId'],
    foreignKeys: { fromAccountId: 'accounts', toAccountId: 'accounts' },
    columns: {
        id: 'id',
        fromAccountId: 'from_account_id',
        toAccountId: 'to_account_id',
        amount: 'amount',
        date: 'date',
        memo: 'memo',
        createdAt: 'created_at'
    }
});
