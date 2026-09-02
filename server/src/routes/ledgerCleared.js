import { createKeyedResource } from '../keyedRouter.js';
import { sanitizeDateISO } from '../sanitizers/index.js';

function sanitizeClearedEntry(body, key) {
    return {
        clearedKey: key,
        clearedAt: sanitizeDateISO(body?.clearedAt) || new Date().toISOString()
    };
}

export default createKeyedResource({
    table: 'ledger_cleared_transactions',
    keyColumn: 'cleared_key',
    keyField: 'clearedKey',
    columns: {
        clearedKey: 'cleared_key',
        clearedAt: 'cleared_at'
    },
    sanitize: sanitizeClearedEntry
});
