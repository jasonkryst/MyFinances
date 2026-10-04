import { createCrudResource } from '../crudRouter.js';
import { sanitizeBalanceHistoryEntry } from '../sanitizers/index.js';

// "Exactly one of debtId / accountId" can't be expressed via requiredFields;
// sanitizeBalanceHistoryEntry returns null for it (-> 400) and the
// balance_history_one_owner CHECK constraint backs it up.
export default createCrudResource({
    table: 'balance_history',
    sanitize: sanitizeBalanceHistoryEntry,
    foreignKeys: { debtId: 'debts', accountId: 'accounts' },
    columns: {
        id: 'id',
        debtId: 'debt_id',
        accountId: 'account_id',
        date: 'date',
        balance: 'balance',
        minimumPayment: 'minimum_payment'
    }
});
