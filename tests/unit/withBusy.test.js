// withBusy (#459): locks a form or modal while its save is pending.
const { withBusy } = require('../../src/utils.js');

function el(tagName, props = {}) {
    return { tagName, type: '', readOnly: false, disabled: false, ...props };
}

function fakeRoot(controls) {
    const attrs = {};
    return {
        controls,
        getAttribute: k => (k in attrs ? attrs[k] : null),
        setAttribute: (k, v) => { attrs[k] = String(v); },
        removeAttribute: k => { delete attrs[k]; },
        hasAttribute: k => k in attrs,
        // Honors a plain tag-name list, so the selector withBusy passes matters.
        querySelectorAll: selector => {
            const tags = selector.split(',').map(s => s.trim().toUpperCase());
            return controls.filter(c => tags.includes(c.tagName));
        },
    };
}

function deferred() {
    let resolve, reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

describe('withBusy', () => {
    test('locks while pending and restores afterwards', async () => {
        const text = el('INPUT', { type: 'text' });
        const num = el('INPUT', { type: 'number' });
        const area = el('TEXTAREA');
        const check = el('INPUT', { type: 'checkbox' });
        const select = el('SELECT');
        const button = el('BUTTON', { type: 'submit' });
        const root = fakeRoot([text, num, area, check, select, button]);
        const gate = deferred();
        let seen;

        const run = withBusy(root, async () => {
            seen = {
                busy: root.getAttribute('aria-busy'),
                text: [text.readOnly, text.disabled],
                num: [num.readOnly, num.disabled],
                area: [area.readOnly, area.disabled],
                check: [check.readOnly, check.disabled],
                select: [select.readOnly, select.disabled],
                button: [button.readOnly, button.disabled],
            };
            await gate.promise;
            return 'saved';
        });
        expect(seen).toEqual({
            busy: 'true',
            text: [true, false],
            num: [true, false],
            area: [true, false],
            check: [false, true],
            select: [false, true],
            button: [false, true],
        });
        gate.resolve();
        await expect(run).resolves.toBe('saved');

        expect(root.hasAttribute('aria-busy')).toBe(false);
        for (const c of [text, num, area, check, select, button]) {
            expect([c.readOnly, c.disabled]).toEqual([false, false]);
        }
    });

    test('a second call while busy is ignored', async () => {
        const root = fakeRoot([el('BUTTON')]);
        const gate = deferred();
        const fn = jest.fn(() => gate.promise);
        const first = withBusy(root, fn);
        const second = withBusy(root, fn);
        await expect(second).resolves.toBeUndefined();
        expect(fn).toHaveBeenCalledTimes(1);
        gate.resolve('ok');
        await expect(first).resolves.toBe('ok');
        // Free again once the first save settles.
        await expect(withBusy(root, async () => 'again')).resolves.toBe('again');
    });

    test('restores controls even when the save throws', async () => {
        const input = el('INPUT', { type: 'text' });
        const button = el('BUTTON');
        const root = fakeRoot([input, button]);
        await expect(withBusy(root, async () => { throw new Error('boom'); })).rejects.toThrow('boom');
        expect(root.hasAttribute('aria-busy')).toBe(false);
        expect(input.readOnly).toBe(false);
        expect(button.disabled).toBe(false);
    });

    test('leaves controls that were already locked alone', async () => {
        const readOnlyInput = el('INPUT', { type: 'text', readOnly: true });
        const disabledButton = el('BUTTON', { disabled: true });
        const root = fakeRoot([readOnlyInput, disabledButton]);
        await withBusy(root, async () => {});
        expect(readOnlyInput.readOnly).toBe(true);
        expect(disabledButton.disabled).toBe(true);
    });

    test.each(['radio', 'button', 'submit', 'reset', 'file'])('an input of type %s is disabled, not read-only', async type => {
        const input = el('INPUT', { type });
        const root = fakeRoot([input]);
        let during;
        await withBusy(root, async () => { during = [input.readOnly, input.disabled]; });
        expect(during).toEqual([false, true]);
    });

    test('leaves non-form elements alone', async () => {
        const link = el('A');
        const root = fakeRoot([link, el('BUTTON')]);
        await withBusy(root, async () => {
            expect([link.readOnly, link.disabled]).toEqual([false, false]);
        });
    });

    test('with no root it just runs the save', async () => {
        await expect(withBusy(null, async () => 7)).resolves.toBe(7);
    });
});
