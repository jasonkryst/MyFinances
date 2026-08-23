import { createCrudResource } from '../crudRouter.js';
import { sanitizeRecurringTemplate } from '../sanitizers/index.js';

export default createCrudResource({
    table: 'recurring_templates',
    sanitize: sanitizeRecurringTemplate,
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
        skippedMonths: 'skipped_months',
        paidMonths: 'paid_months'
    }
});
