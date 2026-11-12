import { createCrudResource } from '../crudRouter.js';
import { sanitizeManualTransaction, isValidManualTransaction } from '../sanitizers/index.js';

// Manual one-off transactions (#584). The same validity rule as import: a
// record with no account, no name or a zero/non-finite amount is a 400,
// never stored (crudRouter rejects a null sanitize result).
function sanitizeOrReject(body, idFallback) {
    const clean = sanitizeManualTransaction(body, idFallback);
    return isValidManualTransaction(clean) ? clean : null;
}

export default createCrudResource({
    table: 'manual_transactions',
    sanitize: sanitizeOrReject,
    requiredFields: ['accountId'],
    foreignKeys: { accountId: 'accounts' },
    columns: {
        id: 'id',
        accountId: 'account_id',
        date: 'date',
        amount: 'amount',
        name: 'name',
        category: 'category',
        memo: 'memo',
        createdAt: 'created_at'
    }
});
