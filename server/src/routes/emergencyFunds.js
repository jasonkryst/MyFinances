import { createCrudResource } from '../crudRouter.js';
import { sanitizeEmergencyFund } from '../sanitizers/index.js';

export default createCrudResource({
    table: 'emergency_funds',
    sanitize: sanitizeEmergencyFund,
    requiredFields: ['accountId'],
    foreignKeys: { accountId: 'accounts' },
    columns: {
        id: 'id',
        accountId: 'account_id',
        targetAmount: 'target_amount',
        currentAmount: 'current_amount',
        monthlyContribution: 'monthly_contribution',
        autoContribute: 'auto_contribute',
        notes: 'notes'
    }
});
