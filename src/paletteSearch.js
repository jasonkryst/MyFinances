// Command palette record search (#686). Pure and import-free: DOM-free,
// Node-safe and Stryker-scoped. commandPalette.js builds the entries from
// app state (it knows which records are visible and how to format amounts);
// this module only folds, matches, ranks, groups and caps them.

// Group order in the palette, and the only types matchRecords accepts.
export const RECORD_TYPE_ORDER = ['account', 'debt', 'income', 'recurring', 'emergency', 'sinking', 'person'];

// At most this many records per type, so one long list can't push the rest off.
export const MAX_RECORDS_PER_TYPE = 5;

// Lower-cases and strips diacritics, so "cafe" finds "Café" and "zl" finds "Żł".
export function foldForSearch(text) {
    return String(text ?? '')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/ł/g, 'l')
        .replace(/Ł/g, 'L')
        .toLowerCase()
        .trim();
}

// 0 = the name starts with the query, 1 = a later word starts with it,
// 2 = it appears inside a word, null = no match. An empty query never matches.
export function matchRank(name, query) {
    const q = foldForSearch(query);
    if (!q) return null;
    const n = foldForSearch(name);
    const at = n.indexOf(q);
    if (at < 0) return null;
    if (at === 0) return 0;
    // Any word may start with it, even if the first occurrence is mid-word
    // ("Cargo Gold" for "go" ranks as a word start).
    return n.split(/[^\p{L}\p{N}]+/u).some(w => w.startsWith(q)) ? 1 : 2;
}

// entries: [{ type, id, name, ... }]. Returns the matches grouped by
// RECORD_TYPE_ORDER; inside a type, better rank first, then by name, then id.
// Entries with an unknown type or a blank name are ignored.
export function matchRecords(entries, query, maxPerType = MAX_RECORDS_PER_TYPE) {
    if (!Array.isArray(entries) || !foldForSearch(query)) return [];
    const cap = Math.max(1, Math.floor(Number(maxPerType)) || MAX_RECORDS_PER_TYPE);
    const byType = new Map(RECORD_TYPE_ORDER.map(t => [t, []]));
    for (const entry of entries) {
        if (!entry || !byType.has(entry.type)) continue;
        const name = String(entry.name ?? '').trim();
        if (!name) continue;
        const rank = matchRank(name, query);
        if (rank === null) continue;
        byType.get(entry.type).push({ entry, rank, key: foldForSearch(name) });
    }
    const out = [];
    for (const type of RECORD_TYPE_ORDER) {
        const hits = byType.get(type);
        hits.sort((a, b) => (a.rank - b.rank)
            || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
            || (Number(a.entry.id) - Number(b.entry.id)));
        for (const h of hits.slice(0, cap)) out.push(h.entry);
    }
    return out;
}
