// Unit tests for the bounded request pool (issue #519).
const { mapWithConcurrency, mapSettledWithConcurrency, IMPORT_CONCURRENCY } = require('../../src/concurrency.js');

const tick = () => new Promise(r => setTimeout(r, 0));

// Records how many calls run at once; each call resolves after `delay` ticks.
function tracker() {
    const t = { active: 0, max: 0, started: [] };
    t.fn = async (item, index) => {
        t.started.push(index);
        t.active++;
        t.max = Math.max(t.max, t.active);
        await tick(); await tick();
        t.active--;
        return item * 10;
    };
    return t;
}

describe('mapWithConcurrency: positive', () => {
    test('IMPORT_CONCURRENCY is 6', () => {
        expect(IMPORT_CONCURRENCY).toBe(6);
    });

    test('never runs more than the limit at once, and does use it', async () => {
        const t = tracker();
        await mapWithConcurrency(Array.from({ length: 50 }, (_, i) => i), 6, t.fn);
        expect(t.max).toBe(6);
    });

    test('keeps input order even when calls finish out of order', async () => {
        const delays = [5, 1, 4, 0, 3, 2];
        const out = await mapWithConcurrency(delays, 3, async (d) => {
            for (let i = 0; i < d; i++) await tick();
            return `v${d}`;
        });
        expect(out).toEqual(delays.map(d => `v${d}`));
    });

    test('passes (item, index) and starts every item exactly once', async () => {
        const t = tracker();
        const out = await mapWithConcurrency([1, 2, 3, 4, 5], 2, t.fn);
        expect(out).toEqual([10, 20, 30, 40, 50]);
        expect([...t.started].sort()).toEqual([0, 1, 2, 3, 4]);
    });

    test('a limit above the item count runs them all at once', async () => {
        const t = tracker();
        await mapWithConcurrency([1, 2, 3], 10, t.fn);
        expect(t.max).toBe(3);
    });

    test('accepts any iterable', async () => {
        expect(await mapWithConcurrency(new Set([1, 2]), 2, async x => x + 1)).toEqual([2, 3]);
    });

    test('2,000 items finish with only 6 ever in flight', async () => {
        const t = tracker();
        const out = await mapWithConcurrency(Array.from({ length: 2000 }, (_, i) => i), IMPORT_CONCURRENCY, t.fn);
        expect(out).toHaveLength(2000);
        expect(t.max).toBe(IMPORT_CONCURRENCY);
    });
});

describe('mapWithConcurrency: negative', () => {
    test.each([[[]], [null], [undefined]])('empty input (%p) resolves to [] without calling fn', async (items) => {
        const fn = jest.fn();
        await expect(mapWithConcurrency(items, 6, fn)).resolves.toEqual([]);
        expect(fn).not.toHaveBeenCalled();
    });

    test.each([[0], [-3], [NaN], ['x'], [undefined]])('an invalid limit (%p) runs one at a time', async (limit) => {
        const t = tracker();
        await mapWithConcurrency([1, 2, 3, 4], limit, t.fn);
        expect(t.max).toBe(1);
    });

    test('rejects with the first error and starts nothing after it', async () => {
        const started = [];
        const err = new Error('boom');
        const p = mapWithConcurrency(Array.from({ length: 20 }, (_, i) => i), 2, async (i) => {
            started.push(i);
            await tick();
            if (i === 3) throw err;
            return i;
        });
        await expect(p).rejects.toBe(err);
        // Items 0-3 started, plus at most the one worker's next pick before i=3 failed.
        expect(Math.max(...started)).toBeLessThanOrEqual(4);
    });

    test('waits for in-flight calls to settle before rejecting', async () => {
        let slowDone = false;
        const p = mapWithConcurrency([0, 1], 2, async (i) => {
            if (i === 0) throw new Error('fast failure');
            for (let k = 0; k < 5; k++) await tick();
            slowDone = true;
        });
        await expect(p).rejects.toThrow('fast failure');
        expect(slowDone).toBe(true);
    });

    test('a synchronous throw in fn is a rejection too', async () => {
        await expect(mapWithConcurrency([1], 1, () => { throw new Error('sync'); })).rejects.toThrow('sync');
    });

    test('only the first of several errors is thrown', async () => {
        const p = mapWithConcurrency([1, 2], 2, async (i) => { await tick(); throw new Error(`e${i}`); });
        await expect(p).rejects.toThrow('e1');
    });
});

describe('mapSettledWithConcurrency', () => {
    test('attempts every item, never rejects, and reports each outcome', async () => {
        const out = await mapSettledWithConcurrency([1, 2, 3, 4], 2, async (i) => {
            if (i % 2 === 0) throw new Error(`bad ${i}`);
            return i;
        });
        expect(out.map(r => r.status)).toEqual(['fulfilled', 'rejected', 'fulfilled', 'rejected']);
        expect(out[0].value).toBe(1);
        expect(out[1].reason.message).toBe('bad 2');
    });

    test('respects the limit', async () => {
        const t = tracker();
        await mapSettledWithConcurrency(Array.from({ length: 30 }, (_, i) => i), 4, t.fn);
        expect(t.max).toBe(4);
    });
});
