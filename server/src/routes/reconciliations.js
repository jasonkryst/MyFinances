import { createCrudResource } from '../crudRouter.js';
import { sanitizeReconciliation, isValidReconciliation } from '../sanitizers/index.js';
import { validatedSanitizer } from '../validity.js';

export default createCrudResource({
    table: 'reconciliations',
    // #568: an account and a finite statementBalance, like import.
    sanitize: validatedSanitizer(sanitizeReconciliation, isValidReconciliation, ['accountId', 'statementBalance']),
    requiredFields: ['accountId', 'statementBalance'],
    foreignKeys: { accountId: 'accounts' },
    columns: {
        id: 'id',
        accountId: 'account_id',
        date: 'date',
        statementStartDate: 'statement_start_date',
        statementEndDate: 'statement_end_date',
        previousBalance: 'previous_balance',
        statementBalance: 'statement_balance',
        difference: 'difference',
        note: 'note',
        createdAt: 'created_at'
    }
});
