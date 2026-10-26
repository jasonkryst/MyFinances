const { loadOnce, _resetLazyModuleCacheForTests, getResolvedModule } = require('../../src/lazyModules.js');

// These tests exercise the generic cache-once-per-key contract with a fake
// importFn, never a real import() of an ES-module-syntax source file --
// Node's native dynamic import() bypasses babel-jest's CJS transform
// entirely, so a real import('./retirement.js') call would try to parse
// that file with Node's own ESM loader and fail outside a browser (see
// docs/superpowers/specs/2026-10-25-dynamic-import-code-splitting-design.md).

beforeEach(() => {
    _resetLazyModuleCacheForTests();
});

describe('loadOnce', () => {
    test('resolves with the value importFn() resolves with', async () => {
        const mod = { hello: 'world' };
        const result = await loadOnce('k1', () => Promise.resolve(mod));
        expect(result).toBe(mod);
    });

    test('calls importFn only once across repeated calls with the same key', async () => {
        const importFn = jest.fn(() => Promise.resolve({ ok: true }));
        await loadOnce('k2', importFn);
        await loadOnce('k2', importFn);
        await loadOnce('k2', importFn);
        expect(importFn).toHaveBeenCalledTimes(1);
    });

    test('concurrent calls before the first resolves share the same in-flight promise', async () => {
        let resolveFn;
        const importFn = jest.fn(() => new Promise((resolve) => { resolveFn = resolve; }));

        const p1 = loadOnce('k3', importFn);
        const p2 = loadOnce('k3', importFn);
        expect(importFn).toHaveBeenCalledTimes(1);

        resolveFn({ value: 42 });
        const [r1, r2] = await Promise.all([p1, p2]);
        expect(r1).toEqual({ value: 42 });
        expect(r2).toEqual({ value: 42 });
    });

    test('different keys are cached independently', async () => {
        const importA = jest.fn(() => Promise.resolve('A'));
        const importB = jest.fn(() => Promise.resolve('B'));

        await loadOnce('keyA', importA);
        await loadOnce('keyB', importB);
        await loadOnce('keyA', importA);

        expect(importA).toHaveBeenCalledTimes(1);
        expect(importB).toHaveBeenCalledTimes(1);
    });

    test('a rejected importFn() is not cached -- a later call retries', async () => {
        const importFn = jest.fn()
            .mockImplementationOnce(() => Promise.reject(new Error('network error')))
            .mockImplementationOnce(() => Promise.resolve({ recovered: true }));

        await expect(loadOnce('k4', importFn)).rejects.toThrow('network error');
        expect(importFn).toHaveBeenCalledTimes(1);

        const result = await loadOnce('k4', importFn);
        expect(result).toEqual({ recovered: true });
        expect(importFn).toHaveBeenCalledTimes(2);
    });

    test('a second rejection after a successful retry is also not cached', async () => {
        const importFn = jest.fn()
            .mockImplementationOnce(() => Promise.reject(new Error('first failure')))
            .mockImplementationOnce(() => Promise.resolve('ok'))
            .mockImplementationOnce(() => Promise.reject(new Error('second failure')));

        await expect(loadOnce('k5', importFn)).rejects.toThrow('first failure');
        await expect(loadOnce('k5', importFn)).resolves.toBe('ok');

        // A successful load IS cached permanently -- a third call must not
        // re-invoke importFn even though the mock has a third rejecting
        // implementation queued up.
        await expect(loadOnce('k5', importFn)).resolves.toBe('ok');
        expect(importFn).toHaveBeenCalledTimes(2);
    });
});

describe('getResolvedModule', () => {
    test('returns null before loadOnce has resolved for that key', () => {
        expect(getResolvedModule('never-loaded')).toBeNull();
    });

    test('returns the resolved module namespace once settled', async () => {
        const mod = { fn: () => 'x' };
        await loadOnce('k6', () => Promise.resolve(mod));
        expect(getResolvedModule('k6')).toBe(mod);
    });

    test('stays null after a rejected load', async () => {
        await expect(loadOnce('k7', () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
        expect(getResolvedModule('k7')).toBeNull();
    });
});
