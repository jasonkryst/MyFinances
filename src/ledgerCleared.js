// Ledger cleared-transaction subsystem: tracks whether a transaction has
// posted/cleared the account, plus when it cleared. Keyed the same way as
// ledgerAmountOverrides (see makeLedgerTransactionId) so state survives
// ledger re-sorts and regeneration. Presence of a key means cleared;
// removing the key means uncleared -- there is no separate boolean field.

import { pgPut, pgDelete } from './postgresSync.js';

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

export function setLedgerCleared(app, transactionId, cleared) {
    if (!transactionId) return;
    if (!app.ledgerClearedTransactions) app.ledgerClearedTransactions = {};

    if (cleared) {
        const entry = { clearedAt: new Date().toISOString() };
        app.ledgerClearedTransactions[transactionId] = entry;
        if (app._storageBackendKind === 'postgres') {
            pgPut(app, `/api/ledger-cleared/${transactionId}`, entry);
        }
    } else {
        delete app.ledgerClearedTransactions[transactionId];
        if (app._storageBackendKind === 'postgres') {
            pgDelete(app, `/api/ledger-cleared/${transactionId}`);
        }
    }
}
