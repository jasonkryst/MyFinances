// #730: a deep link such as /reports/forecast is not a cache entry of its own.
// Offline, sw.js must answer a navigation with the cached /index.html shell,
// and only a navigation (a missing script must still fail).
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SW_SOURCE = fs.readFileSync(path.join(__dirname, '..', '..', 'sw.js'), 'utf8');
const SHELL = { shell: true };

function loadWorker() {
    const listeners = {};
    const self = {
        location: { origin: 'http://x' },
        addEventListener: (type, fn) => { listeners[type] = fn; },
        skipWaiting: () => {},
        clients: { claim: () => {} },
    };
    const cache = {
        match: async (req) => (req === '/index.html' ? SHELL : undefined),
        put: async () => {},
        addAll: async () => {},
    };
    const context = vm.createContext({
        self,
        URL,
        Request: function Request() {},
        console,
        caches: { open: async () => cache, keys: async () => [], delete: async () => true },
        fetch: () => Promise.reject(new Error('offline')),
    });
    vm.runInContext(SW_SOURCE, context);
    return listeners.fetch;
}

function dispatch(onFetch, request) {
    let responded;
    onFetch({ request, respondWith: (p) => { responded = p; } });
    return responded;
}

describe('sw.js offline navigation fallback', () => {
    test('a navigation with no cache entry gets the cached /index.html', async () => {
        const onFetch = loadWorker();
        const p = dispatch(onFetch, { method: 'GET', mode: 'navigate', url: 'http://x/reports/forecast' });
        await expect(p).resolves.toBe(SHELL);
    });

    test('a non-navigation request for an uncached URL still rejects', async () => {
        const onFetch = loadWorker();
        const p = dispatch(onFetch, { method: 'GET', mode: 'cors', url: 'http://x/src/missing.js' });
        await expect(p).rejects.toThrow('offline');
    });
});
