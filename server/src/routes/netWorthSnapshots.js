import { createKeyedResource } from '../keyedRouter.js';
import { sanitizeNetWorthSnapshot } from '../sanitizers/index.js';

export default createKeyedResource({
    table: 'net_worth_snapshots',
    keyColumn: 'date',
    keyField: 'date',
    columns: {
        date: 'date',
        totalAssets: 'total_assets',
        totalLiabilities: 'total_liabilities',
        netWorth: 'net_worth',
        debtPaymentMade: 'debt_payment_made',
        incomeReceived: 'income_received',
        source: 'source'
    },
    sanitize: (body, key) => sanitizeNetWorthSnapshot({ ...body, date: key })
});
