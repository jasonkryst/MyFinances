// Early boot fetches (#703). A classic, async script that starts the session
// probe and, once it answers 200, the boot data fan-out while the ES module
// graph is still downloading, so the network round trips overlap the module
// waterfall instead of following it. storage.js consumes the results once
// (probeServer takes `plan`, loadFromPostgres takes `data[path]`) with the same
// semantics as before: same URLs, `no-store`, one plan-settings GET (#533).
// Every body is read here (#461), so an unconsumed response never stays open.
// Keep PATHS equal to what loadFromPostgres fetches; a path missing from here
// is simply fetched normally.
(function () {
    if (typeof fetch !== 'function') return;
    var PATHS = [
        '/api/persons', '/api/debts', '/api/accounts', '/api/incomes', '/api/bonuses',
        '/api/bills', '/api/expenses', '/api/recurring-templates', '/api/emergency-funds',
        '/api/sinking-funds', '/api/reconciliations', '/api/plan-history',
        '/api/retirement-snapshots', '/api/transfers', '/api/manual-transactions',
        '/api/balance-history', '/api/net-worth-snapshots', '/api/settings',
        '/api/ledger-overrides', '/api/ledger-cleared'
    ];
    function noop() {}
    function get(path) {
        var controller = new AbortController();
        var timer = setTimeout(function () { controller.abort(); }, 20000);
        var p = fetch(path, { cache: 'no-store', signal: controller.signal })
            .then(function (res) {
                return res.text().then(function (text) { return { status: res.status, ok: res.ok, text: text }; });
            })
            .then(function (r) { clearTimeout(timer); return r; },
                  function (e) { clearTimeout(timer); throw e; });
        p.catch(noop);
        return p;
    }
    var boot = { plan: get('/api/plan-settings'), data: null };
    boot.plan.then(function (r) {
        if (r.status !== 200) return;
        var data = {};
        PATHS.forEach(function (path) { data[path] = get(path); });
        boot.data = data;
    }, noop);
    window.__earlyBoot = boot;
    // A stored es/pl locale is loaded on demand by i18n.js; hint it now so it
    // downloads alongside the module graph rather than after it.
    try {
        var locale = localStorage.getItem('debtTrackerLocale');
        if (locale === 'es' || locale === 'pl') {
            var link = document.createElement('link');
            link.rel = 'modulepreload';
            link.href = 'src/locales/' + locale + '.js';
            document.head.appendChild(link);
        }
    } catch (_) { /* storage blocked: English */ }
})();
