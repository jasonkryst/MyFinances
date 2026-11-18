// Remap the settings that hold an account id when a backup is imported (#651).
//
// Pure: imports only constants from the leaf settingsSchema.js. Account ids are
// new after an import, so a stored id would match nothing, or worse, a
// different account.
import { SURPLUS_ACCOUNT_ID, NOTIFY_FILTER_ACCOUNT } from './settingsSchema.js';

function resolveAccountId(value, accountIdMap) {
    if (value == null || !accountIdMap) return null;
    const key = String(value);
    if (!Object.prototype.hasOwnProperty.call(accountIdMap, key)) return null;
    const mapped = accountIdMap[key];
    return mapped == null ? null : mapped;
}

// settings: array of { key, value }. accountIdMap: { [oldId]: newId }.
// Returns { settings, changes }; the input is never mutated. A change has
// kind 'remapped' (new id), 'coerced' (reset to default 0) or 'rejected'
// (entry dropped), and is recorded only when the value actually changes.
export function remapAccountSettings(settings, accountIdMap) {
    const out = [];
    const changes = [];
    for (const entry of Array.isArray(settings) ? settings : []) {
        if (entry && entry.key === SURPLUS_ACCOUNT_ID) {
            const to = resolveAccountId(entry.value, accountIdMap);
            if (to == null) {
                changes.push({ key: entry.key, from: entry.value, to: null, kind: 'rejected' });
                continue;
            }
            if (to !== entry.value) changes.push({ key: entry.key, from: entry.value, to, kind: 'remapped' });
            out.push({ ...entry, value: to });
        } else if (entry && entry.key === NOTIFY_FILTER_ACCOUNT) {
            if (entry.value === 0) { out.push({ ...entry }); continue; }
            const to = resolveAccountId(entry.value, accountIdMap);
            if (to == null) {
                changes.push({ key: entry.key, from: entry.value, to: 0, kind: 'coerced' });
                out.push({ ...entry, value: 0 });
                continue;
            }
            if (to !== entry.value) changes.push({ key: entry.key, from: entry.value, to, kind: 'remapped' });
            out.push({ ...entry, value: to });
        } else {
            out.push(entry && typeof entry === 'object' ? { ...entry } : entry);
        }
    }
    return { settings: out, changes };
}
