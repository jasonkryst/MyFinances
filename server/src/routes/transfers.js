import { createCrudResource } from '../crudRouter.js';
import { sanitizeTransfer, isValidTransfer } from '../sanitizers/index.js';
import { validatedSanitizer } from '../validity.js';

// #568: same validity rule as import. A PATCH that touches none of these
// fields is let through, so a legacy invalid row stays editable (memo).

export default createCrudResource({
    table: 'transfers',
    sanitize: validatedSanitizer(sanitizeTransfer, isValidTransfer, ['fromAccountId', 'toAccountId', 'amount']),
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
