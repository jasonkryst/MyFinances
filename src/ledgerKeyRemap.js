// Ledger key remapping on import (issue #520). Pure and DOM-free (Jest +
// Stryker scope), like concurrency.js.
//
// Ledger amount overrides and cleared flags are keyed
// `type|sourceId|accountId|date` (makeLedgerTransactionId in
// ledgerTransactions.js). An import gives every record a new server id, so the
// keys must be rewritten through the same id maps the records went through, or
// they silently stop matching any ledger row.

// Account segment for transactions with no linked account (UNLINKED_KEY in
// ledgerTransactions.js). It has no id to remap.
export const UNLINKED_ACCOUNT_KEY = '__unlinked__';

// Which id map resolves the sourceId segment of each keyed transaction type.
// `interest` rows use the account's own id as their source. `savings` is
// resolved separately (two collections share it). Reconciliation and rollover
// rows have no transactionId, so they never appear in a key.
const SOURCE_MAP_BY_TYPE = new Map([
    ['income', 'incomes'],
    ['bonus', 'bonuses'],
    ['debt', 'debts'],
    ['bill', 'bills'],
    ['expense', 'expenses'],
    ['transfer', 'transfers'],
    ['recurring', 'recurringTemplates'],
    ['interest', 'accounts'],
]);

// undefined/null both mean "not mapped"; callers test with `== null`.
function lookup(map, id) {
    return map instanceof Map ? map.get(String(id)) : null;
}

// Emergency and sinking funds both post `savings` rows and have independent id
// sequences, so an old id can match one fund of each kind. The key's account
// segment (the fund's own account at export time) breaks the tie; a tie it
// can't break resolves to null rather than guessing. A fund that failed to
// post (newId null) still claims its key, so the key is dropped instead of
// sliding onto the other fund.
function resolveSavings(funds, sourceId, accountSegment) {
    if (!Array.isArray(funds)) return null;
    const candidates = funds.filter(f => f && String(f.oldId) === sourceId);
    const match = candidates.length === 1
        ? candidates
        : candidates.filter(f => (f.oldAccountId == null ? UNLINKED_ACCOUNT_KEY : String(f.oldAccountId)) === accountSegment);
    return match.length === 1 ? match[0].newId : null;
}

// Rewrite one key. `idMaps` holds one Map(String(oldId) -> newId) per
// collection field (accounts, incomes, bonuses, debts, bills, expenses,
// transfers, recurringTemplates) plus `savings`: [{ oldId, newId, oldAccountId }].
// Returns the new key, or null when the key is malformed, its type is unknown,
// or its source record or account isn't in the maps.
export function remapLedgerKey(key, idMaps) {
    if (typeof key !== 'string' || !idMaps) return null;
    const parts = key.split('|');
    if (parts.length !== 4) return null;
    const [type, sourceId, accountSegment, date] = parts;
    // An empty type, source or account segment can't match any map below.
    if (!date) return null;

    let newAccount;
    if (accountSegment === UNLINKED_ACCOUNT_KEY) {
        newAccount = UNLINKED_ACCOUNT_KEY;
    } else {
        newAccount = lookup(idMaps.accounts, accountSegment);
        if (newAccount == null) return null;
    }

    let newSource;
    if (type === 'savings') {
        newSource = resolveSavings(idMaps.savings, sourceId, accountSegment);
    } else {
        // An unknown type has no map, so lookup() resolves it to null.
        newSource = lookup(idMaps[SOURCE_MAP_BY_TYPE.get(type)], sourceId);
    }
    if (newSource == null) return null;

    return `${type}|${newSource}|${newAccount}|${date}`;
}

// Rewrite every [key, value] entry. Unresolvable entries are dropped (never
// stored as orphans) and counted so the caller can report one summary warning.
export function remapLedgerEntries(entries, idMaps) {
    const out = [];
    let dropped = 0;
    for (const [key, value] of entries || []) {
        const newKey = remapLedgerKey(key, idMaps);
        if (newKey == null) { dropped++; continue; }
        out.push([newKey, value]);
    }
    return { entries: out, dropped };
}

// One import warning (sanitizeParsedState's shape) summarizing dropped keys,
// or null when nothing was dropped.
export function ledgerKeyDropWarning(recordType, dropped) {
    if (!(dropped > 0)) return null;
    return {
        recordType,
        recordName: `${dropped} ${dropped === 1 ? 'entry' : 'entries'}`,
        kind: 'rejected',
        reason: 'Referenced a record or account that is not in this file — not imported.'
    };
}
