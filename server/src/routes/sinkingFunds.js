import { createCrudResource } from '../crudRouter.js';
import { sanitizeSinkingFund } from '../sanitizers/index.js';

export default createCrudResource({
    table: 'sinking_funds',
    sanitize: sanitizeSinkingFund,
    requiredFields: ['name', 'accountId'],
    foreignKeys: { accountId: 'accounts' },
    columns: {
        id: 'id',
        name: 'name',
        allocationMethod: 'allocation_method',
        monthlyAllocation: 'monthly_allocation',
        targetAmount: 'target_amount',
        currentAmount: 'current_amount',
        autoContribute: 'auto_contribute',
        accountId: 'account_id',
        notes: 'notes'
    }
});
