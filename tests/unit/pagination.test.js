import { paginateList, DEFAULT_PAGE_SIZE } from '../../src/pagination.js';

const range = n => Array.from({ length: n }, (_, i) => i + 1);

describe('paginateList', () => {
    test('default page size is 25', () => {
        expect(DEFAULT_PAGE_SIZE).toBe(25);
    });

    test('first page of a long list', () => {
        const r = paginateList(range(73), 1, 25);
        expect(r.items).toEqual(range(25));
        expect(r).toMatchObject({ page: 1, totalPages: 3, total: 73, start: 1, end: 25 });
    });

    test('middle and last pages', () => {
        const mid = paginateList(range(73), 2, 25);
        expect(mid.items).toEqual(range(50).slice(25));
        expect(mid).toMatchObject({ page: 2, start: 26, end: 50 });
        const last = paginateList(range(73), 3, 25);
        expect(last.items).toEqual([51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73]);
        expect(last).toMatchObject({ page: 3, start: 51, end: 73, totalPages: 3 });
    });

    test('exactly one full page has a single page', () => {
        const r = paginateList(range(25), 1, 25);
        expect(r.totalPages).toBe(1);
        expect(r.items).toHaveLength(25);
        expect(paginateList(range(26), 1, 25).totalPages).toBe(2);
    });

    test('empty list is one empty page', () => {
        expect(paginateList([], 1, 25)).toEqual({ items: [], page: 1, totalPages: 1, total: 0, start: 0, end: 0 });
    });

    test('non-array input behaves like an empty list', () => {
        expect(paginateList(null, 1, 25).total).toBe(0);
        expect(paginateList(undefined, 3, 25).page).toBe(1);
    });

    test('page below 1 clamps to 1', () => {
        expect(paginateList(range(60), 0, 25).page).toBe(1);
        expect(paginateList(range(60), -4, 25).page).toBe(1);
    });

    test('page above the last clamps to the last page', () => {
        const r = paginateList(range(60), 99, 25);
        expect(r.page).toBe(3);
        expect(r.items).toEqual(range(60).slice(50));
    });

    test('NaN, undefined, strings and fractions', () => {
        expect(paginateList(range(60), NaN, 25).page).toBe(1);
        expect(paginateList(range(60), undefined, 25).page).toBe(1);
        expect(paginateList(range(60), 'abc', 25).page).toBe(1);
        expect(paginateList(range(60), '2', 25).page).toBe(2);
        expect(paginateList(range(60), 2.9, 25).page).toBe(2);
        expect(paginateList(range(60), Infinity, 25).page).toBe(1);
    });

    test('invalid page size falls back to the default', () => {
        expect(paginateList(range(60), 1, 0).totalPages).toBe(3);
        expect(paginateList(range(60), 1, -5).totalPages).toBe(3);
        expect(paginateList(range(60), 1, NaN).items).toHaveLength(25);
        expect(paginateList(range(60), 1).items).toHaveLength(25);
    });

    test('fractional page size is floored', () => {
        expect(paginateList(range(10), 1, 2.7).items).toEqual([1, 2]);
    });

    test('does not mutate the input', () => {
        const input = range(30);
        paginateList(input, 2, 10);
        expect(input).toEqual(range(30));
    });

    test('small page sizes', () => {
        const r = paginateList(range(5), 3, 2);
        expect(r.items).toEqual([5]);
        expect(r).toMatchObject({ totalPages: 3, start: 5, end: 5 });
    });
});
