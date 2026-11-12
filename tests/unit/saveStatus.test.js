// Unit tests for the Saving / Saved chip state machine (issue #576).
const {
    INITIAL_SAVE_STATE, reduceSaveStatus, shouldWarnOnUnload, SAVED_VISIBLE_MS, SETTLE_MS,
} = require('../../src/saveStatus.js');

const run = (events, start = INITIAL_SAVE_STATE) => events.reduce(reduceSaveStatus, start);
const writes = (pending, failed) => ({ type: 'writes', pending, failed });

describe('reduceSaveStatus', () => {
    test('starts idle', () => {
        expect(INITIAL_SAVE_STATE).toEqual({ status: 'idle', pending: 0, failed: false });
    });

    test('pending > 0 means saving', () => {
        expect(run([writes(1)])).toEqual({ status: 'saving', pending: 1, failed: false });
        expect(run([writes(1), writes(3)]).pending).toBe(3);
    });

    test('count back to 0 stays saving until settle, then saved, then fade to idle', () => {
        let s = run([writes(1), writes(0)]);
        expect(s.status).toBe('saving');
        s = reduceSaveStatus(s, { type: 'settle' });
        expect(s).toEqual({ status: 'saved', pending: 0, failed: false });
        expect(reduceSaveStatus(s, { type: 'fade' }).status).toBe('idle');
    });

    test('a new write between 0 and settle keeps it saving (no flash of saved)', () => {
        let s = run([writes(1), writes(0), writes(1)]);
        s = reduceSaveStatus(s, { type: 'settle' });
        expect(s.status).toBe('saving');
        expect(s.pending).toBe(1);
    });

    test('a failure never ends as saved', () => {
        let s = run([writes(1), writes(1, true), writes(0)]);
        expect(s.status).toBe('saving');
        s = reduceSaveStatus(s, { type: 'settle' });
        expect(s.status).toBe('error');
        expect(s.failed).toBe(true);
    });

    test('a failure with nothing left pending is an error at once and survives a 0 count', () => {
        let s = run([writes(0, true)]);
        expect(s.status).toBe('error');
        s = run([writes(0)], s);
        expect(s.status).toBe('error');
        expect(reduceSaveStatus(s, { type: 'settle' }).status).toBe('error');
    });

    test('the next burst of writes clears an earlier failure', () => {
        let s = run([writes(0, true), writes(1)]);
        expect(s).toEqual({ status: 'saving', pending: 1, failed: false });
        s = run([writes(0), { type: 'settle' }], s);
        expect(s.status).toBe('saved');
    });

    test('failure in the middle of a burst marks the whole burst failed', () => {
        let s = run([writes(2), writes(1, true), writes(2)]);
        expect(s.failed).toBe(true);
    });

    test('settle and fade are ignored in the wrong state', () => {
        expect(reduceSaveStatus(INITIAL_SAVE_STATE, { type: 'settle' })).toBe(INITIAL_SAVE_STATE);
        const busy = run([writes(2)]);
        expect(reduceSaveStatus(busy, { type: 'settle' })).toBe(busy);
        expect(reduceSaveStatus(busy, { type: 'fade' })).toBe(busy);
        const err = run([writes(0, true)]);
        expect(reduceSaveStatus(err, { type: 'fade' })).toBe(err);
    });

    test('junk counts and unknown events are safe', () => {
        expect(run([writes(-4)]).status).toBe('idle');
        expect(run([writes(NaN)]).pending).toBe(0);
        expect(run([writes(undefined)]).pending).toBe(0);
        expect(reduceSaveStatus(INITIAL_SAVE_STATE, { type: 'nope' })).toBe(INITIAL_SAVE_STATE);
        expect(reduceSaveStatus(INITIAL_SAVE_STATE, undefined)).toBe(INITIAL_SAVE_STATE);
    });

    test('timing constants are sensible', () => {
        expect(SETTLE_MS).toBeGreaterThan(0);
        expect(SAVED_VISIBLE_MS).toBeGreaterThan(SETTLE_MS);
    });
});

describe('shouldWarnOnUnload', () => {
    test('warns only with writes pending', () => {
        expect(shouldWarnOnUnload(1)).toBe(true);
        expect(shouldWarnOnUnload(5)).toBe(true);
        expect(shouldWarnOnUnload(0)).toBe(false);
        expect(shouldWarnOnUnload(-1)).toBe(false);
        expect(shouldWarnOnUnload(NaN)).toBe(false);
        expect(shouldWarnOnUnload(undefined)).toBe(false);
        expect(shouldWarnOnUnload('3')).toBe(false);
    });
});
