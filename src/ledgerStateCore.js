// Read-only lookups into the Ledger's per-transaction maps (#579): amount
// overrides (`app.ledgerAmountOverrides`) and Cleared state
// (`app.ledgerClearedTransactions`), both keyed `type|sourceId|accountId|date`.
// Pure and DOM-free so the projection core can run on the server too.
// ledgerOverrides.js and ledgerCleared.js re-export these, so existing
// imports keep working; the write paths stay there.

import { parseFiniteOrNull } from './utils.js';

export function getOverrideAmount(app, txId) {
    if (!txId) return null;
    const map = app.ledgerAmountOverrides || {};
    const entry = map[txId];
    if (!entry) return null;
    return parseFiniteOrNull(entry.amount);
}

export function getEffectiveAmount(app, tx) {
    const overrideAmount = getOverrideAmount(app, tx.transactionId);
    return overrideAmount !== null ? overrideAmount : tx.originalAmount;
}

export function isCleared(app, txId) {
    if (!txId) return false;
    const map = app.ledgerClearedTransactions || {};
    return !!map[txId];
}

export function getClearedAt(app, txId) {
    if (!txId) return null;
    const map = app.ledgerClearedTransactions || {};
    return map[txId]?.clearedAt || null;
}
