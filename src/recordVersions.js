// Optimistic concurrency helpers (issues #578, #563). Pure and DOM-free (Jest +
// Stryker scope), like concurrency.js.
//
// The client keeps a "shadow": a deep copy of the last copy of each record the
// server confirmed, with its rowVersion. A PATCH sends only the fields that
// differ from the shadow plus that version, so a stale tab can't overwrite
// fields it never touched, and the server can refuse a write based on an old
// version (409 with its current row). classifyConflict then decides whether the
// two edits can simply be combined or the user has to choose.

// Never diffed: the id is in the URL and the version travels separately.
const META_FIELDS = new Set(['id', 'rowVersion']);

// Structural equality for JSON-shaped values (what the API sends and stores).
export function deepEqual(a, b) {
    if (a === b) return true;
    if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
    // Arrays go through the key comparison too: same keys (indexes) and
    // values means same length and elements.
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    return ka.length === kb.length && ka.every(k => Object.prototype.hasOwnProperty.call(b, k) && deepEqual(a[k], b[k]));
}

// The fields of `body` whose value differs from `base` (the shadow). Undefined
// values are skipped: JSON.stringify would drop them anyway.
export function diffFields(base, body) {
    const out = {};
    if (!body || typeof body !== 'object') return out;
    const from = base && typeof base === 'object' ? base : {};
    for (const [k, v] of Object.entries(body)) {
        if (META_FIELDS.has(k) || v === undefined) continue;
        if (!deepEqual(from[k], v)) out[k] = v;
    }
    return out;
}

// After a 409: `base` is what this tab last saw, `theirs` is the server's
// current row, `diff` is what this tab wants to change.
// - conflicts: fields both sides changed, to different values.
// - theirsChanges: the server's changes to fields this tab didn't touch; safe
//   to apply locally.
export function classifyConflict(base, theirs, diff) {
    const b = base && typeof base === 'object' ? base : {};
    const t = theirs && typeof theirs === 'object' ? theirs : {};
    const d = diff && typeof diff === 'object' ? diff : {};
    const conflicts = Object.keys(d).filter(k => !deepEqual(t[k], b[k]) && !deepEqual(t[k], d[k]));
    const theirsChanges = {};
    for (const [k, v] of Object.entries(t)) {
        if (META_FIELDS.has(k) || k in d) continue;
        if (!deepEqual(v, b[k])) theirsChanges[k] = v;
    }
    return { conflicts, theirsChanges };
}

// The item path a record lives at, or null when it has no usable id.
export function itemPath(collectionPath, id) {
    if (typeof collectionPath !== 'string' || !collectionPath) return null;
    if (!(Number.isInteger(id) && id >= 0) && !(typeof id === 'string' && /^\d+$/.test(id))) return null;
    return `${collectionPath}/${id}`;
}

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

// Last server-confirmed copy of each record, keyed by item path. Only rows
// that carry an integer rowVersion are kept: without one there is nothing to
// check against, and the PATCH goes out unversioned.
export function createShadowStore() {
    const rows = new Map();
    return {
        get(path) {
            const row = rows.get(path);
            return row ? clone(row) : null;
        },
        set(path, row) {
            if (typeof path !== 'string' || !row || !Number.isInteger(row.rowVersion)) return false;
            rows.set(path, clone(row));
            return true;
        },
        delete(path) {
            rows.delete(path);
        },
        clear() {
            rows.clear();
        },
        get size() {
            return rows.size;
        },
    };
}
