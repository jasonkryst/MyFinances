import { createKeyedResource } from '../keyedRouter.js';
import { normalizeText, sanitizeFiniteNumber, sanitizeInteger, sanitizeDateISO } from '../sanitizers/index.js';

function sanitizeOverrideEntry(body, key) {
    const amount = sanitizeFiniteNumber(body?.amount, NaN);
    if (!Number.isFinite(amount)) return null;
    return {
        overrideKey: key,
        amount,
        originalAmount: sanitizeFiniteNumber(body?.originalAmount, null),
        transactionName: normalizeText(body?.transactionName, 120) || null,
        accountId: sanitizeInteger(body?.accountId, null),
        date: sanitizeDateISO(body?.date),
        updatedAt: sanitizeDateISO(body?.updatedAt) || new Date().toISOString()
    };
}

export default createKeyedResource({
    table: 'ledger_amount_overrides',
    keyColumn: 'override_key',
    keyField: 'overrideKey',
    foreignKeys: { accountId: 'accounts' },
    columns: {
        overrideKey: 'override_key',
        amount: 'amount',
        originalAmount: 'original_amount',
        transactionName: 'transaction_name',
        accountId: 'account_id',
        date: 'date',
        updatedAt: 'updated_at'
    },
    sanitize: sanitizeOverrideEntry
});
