import { createCrudResource } from '../crudRouter.js';
import { sanitizeRecurringTemplate, isValidRecurringTemplate } from '../sanitizers/index.js';
import { validatedSanitizer } from '../validity.js';

export default createCrudResource({
    table: 'recurring_templates',
    // #569: a transfer template needs a distinct target and a positive amount.
    sanitize: validatedSanitizer(sanitizeRecurringTemplate, isValidRecurringTemplate, ['name', 'type', 'amount', 'accountId', 'targetAccountId']),
    requiredFields: ['name'],
    foreignKeys: { accountId: 'accounts', targetAccountId: 'accounts' },
    columns: {
        id: 'id',
        name: 'name',
        type: 'type',
        amount: 'amount',
        frequency: 'frequency',
        dayOfMonth: 'day_of_month',
        category: 'category',
        accountId: 'account_id',
        targetAccountId: 'target_account_id',
        startDate: 'start_date',
        endDate: 'end_date',
        paused: 'paused',
        archived: 'archived',
        pauseUntil: 'pause_until',
        skippedMonths: 'skipped_months',
        paidMonths: 'paid_months'
    }
});
