// The login gate's "try again in N minutes" (from a 429's Retry-After).
const { parseRetryAfterMinutes } = require('../../src/utils.js');

describe('parseRetryAfterMinutes', () => {
    const NOW = Date.parse('2026-11-16T12:26:42Z');

    test.each([
        ['900', 15], ['899', 15], ['61', 2], ['60', 1], ['1', 1], ['0', 1], [' 120 ', 2], [300, 5],
    ])('%p seconds -> %p min', (value, minutes) => {
        expect(parseRetryAfterMinutes(value, NOW)).toBe(minutes);
    });

    test('an HTTP date counts from now, never below 1', () => {
        expect(parseRetryAfterMinutes('Mon, 16 Nov 2026 12:41:42 GMT', NOW)).toBe(15);
        expect(parseRetryAfterMinutes('Mon, 16 Nov 2026 12:27:00 GMT', NOW)).toBe(1);
        expect(parseRetryAfterMinutes('Mon, 16 Nov 2026 12:00:00 GMT', NOW)).toBe(1);
    });

    test.each([[null], [undefined], [''], ['  '], ['soon'], ['-5'], ['1.5']])('%p is unreadable', (value) => {
        expect(parseRetryAfterMinutes(value, NOW)).toBeNull();
    });
});
