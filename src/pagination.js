// Pure list pagination (#330). No imports: DOM-free and Node-safe.
//
// paginateList(items, page, pageSize) returns the slice for one page plus the
// numbers a pager needs. `page` is clamped into 1..totalPages (NaN, fractions
// and out-of-range values included); an empty list is one empty page.
export const DEFAULT_PAGE_SIZE = 25;

export function paginateList(items, page, pageSize = DEFAULT_PAGE_SIZE) {
    const list = Array.isArray(items) ? items : [];
    const total = list.length;
    let size = Math.floor(Number(pageSize));
    if (!Number.isFinite(size) || size < 1) size = DEFAULT_PAGE_SIZE;
    const totalPages = Math.max(1, Math.ceil(total / size));
    let p = Math.floor(Number(page));
    if (!Number.isFinite(p) || p < 1) p = 1;
    if (p > totalPages) p = totalPages;
    const startIdx = (p - 1) * size;
    const slice = list.slice(startIdx, startIdx + size);
    return {
        items: slice,
        page: p,
        totalPages,
        total,
        // 1-based inclusive range shown; 0/0 when empty.
        start: total === 0 ? 0 : startIdx + 1,
        end: total === 0 ? 0 : startIdx + slice.length,
    };
}
