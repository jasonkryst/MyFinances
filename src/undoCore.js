// Undo for deletes (#577): pure helpers, no imports. Undo re-creates a
// deleted record, which gets a new server id, so the Ledger entries keyed on
// the old id (`type|sourceId|accountId|date`, amount overrides and Cleared
// flags) must move to the new id or the restored record would lose them.

// Every key in `map` (an object keyed by Ledger transaction id) that belongs
// to source `type`/`sourceId`.
export function ledgerKeysForSource(map, type, sourceId) {
    if (!map || typeof map !== 'object') return [];
    const prefix = `${type}|${sourceId}|`;
    return Object.keys(map).filter(key => key.startsWith(prefix) && key.split('|').length === 4);
}

// The same key with its source id replaced; null for a malformed key.
export function rekeyLedgerKey(key, newSourceId) {
    const parts = String(key).split('|');
    if (parts.length !== 4 || newSourceId === null || newSourceId === undefined || newSourceId === '') return null;
    parts[1] = String(newSourceId);
    return parts.join('|');
}

// [{ oldKey, newKey, value }] for every entry of `map` that belongs to the
// source, ready to be written under the new id.
export function planLedgerRekey(map, type, oldId, newId) {
    return ledgerKeysForSource(map, type, oldId)
        .map(oldKey => ({ oldKey, newKey: rekeyLedgerKey(oldKey, newId), value: map[oldKey] }))
        .filter(m => m.newKey !== null && m.newKey !== m.oldKey);
}

// A copy of the deleted record for re-creating it: the old id and the
// server-managed rowVersion are dropped, everything else is kept.
export function recordForRecreate(record) {
    if (!record || typeof record !== 'object') return null;
    const { id, rowVersion, ...rest } = record;
    return rest;
}
