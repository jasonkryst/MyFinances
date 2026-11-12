import { createCrudResource } from '../crudRouter.js';
import { sanitizeTransfer, isValidTransfer } from '../sanitizers/index.js';

// #568: same validity rule as import, on POST and on EVERY PATCH. Unlike the
// other validated routes there is no carve-out for unrelated fields: the
// transfers CHECK constraint (migration 034) re-checks the whole row on any
// UPDATE, so letting a legacy invalid row through would turn into a 500.
// Such a row can still be fixed (amount/accounts) or deleted.
function sanitizeOrReject(body, idFallback) {
    const clean = sanitizeTransfer(body, idFallback);
    return isValidTransfer(clean) ? clean : null;
}

export default createCrudResource({
    table: 'transfers',
    sanitize: sanitizeOrReject,
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
