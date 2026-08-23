import { createCrudResource } from '../crudRouter.js';
import { sanitizeReconciliation } from '../sanitizers/index.js';

export default createCrudResource({
    table: 'reconciliations',
    sanitize: sanitizeReconciliation,
    requiredFields: ['accountId', 'statementBalance'],
    foreignKeys: { accountId: 'accounts' },
    columns: {
        id: 'id',
        accountId: 'account_id',
        date: 'date',
        previousBalance: 'previous_balance',
        statementBalance: 'statement_balance',
        difference: 'difference',
        note: 'note',
        createdAt: 'created_at'
    }
});
