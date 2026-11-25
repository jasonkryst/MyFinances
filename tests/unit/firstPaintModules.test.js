// First-paint module budget (#713). The landing page (Health) paints after
// app.js's static import graph has downloaded; over HTTP/1.1 on simulated
// slow 4G every extra module queues, and the signed-in Lighthouse score
// tracks the count. Page renderers, forms and modals sit behind
// src/appFeatures.js (loaded by boot after Health paints), so none of them
// may creep back into the static closure.
const fs = require('fs');
const path = require('path');

const SRC = path.resolve(__dirname, '../../src');
const IMPORT_RE = /(?:^|\n)\s*(?:import|export)\s[^;]*?from\s*['"](\.[^'"]+)['"]|(?:^|\n)\s*import\s*['"](\.[^'"]+)['"]/g;

function staticClosure(entry) {
    const seen = new Set([path.resolve(SRC, entry)]);
    const queue = [...seen];
    while (queue.length) {
        const file = queue.shift();
        const source = fs.readFileSync(file, 'utf8');
        IMPORT_RE.lastIndex = 0;
        let m;
        while ((m = IMPORT_RE.exec(source))) {
            const dep = path.resolve(path.dirname(file), m[1] || m[2]);
            if (!seen.has(dep) && fs.existsSync(dep)) { seen.add(dep); queue.push(dep); }
        }
    }
    return [...seen].map(f => path.relative(SRC, f).split(path.sep).join('/'));
}

// Measured at 46 modules / 747 KB raw when the split landed. A little headroom
// for ordinary changes; a jump means a page module was imported statically.
const MAX_MODULES = 52;
const MAX_RAW_KB = 800;

// Modules only a page other than Health (or a form/modal) needs.
const MUST_BE_LAZY = [
    'ledger.js', 'accounts.js', 'recurring.js', 'recurringPaid.js', 'debts.js', 'income.js',
    'savings.js', 'bills.js', 'strategy.js', 'reports.js', 'reportsNetWorth.js', 'people.js',
    'charts.js', 'forecast.js', 'spending.js', 'notificationsCenter.js', 'liveRefresh.js',
    'setupWizard.js', 'dataExport.js', 'dataTransferModal.js', 'calendarFeed.js',
    'balanceHistory.js', 'keyboardShortcuts.js', 'retirement.js', 'reconciliation.js'
];

describe('first-paint static import graph', () => {
    const closure = staticClosure('app.js');

    test('app.js stays under the module and size budget', () => {
        const kb = closure.reduce((n, f) => n + fs.statSync(path.join(SRC, f)).size, 0) / 1024;
        expect(closure.length).toBeLessThanOrEqual(MAX_MODULES);
        expect(kb).toBeLessThanOrEqual(MAX_RAW_KB);
    });

    test.each(MUST_BE_LAZY)('%s is not in the static closure', (name) => {
        expect(closure).not.toContain(name);
        expect(closure).not.toContain('appFeatures.js');
    });

    test('Health and its own dependencies are in the closure', () => {
        for (const name of ['health.js', 'recurringCashFlow.js', 'projectionCore.js', 'storage.js', 'ui.js']) {
            expect(closure).toContain(name);
        }
    });

    test('health.js does not reach the page modules on its own', () => {
        const own = staticClosure('health.js');
        for (const name of ['recurring.js', 'accounts.js', 'ledger.js']) expect(own).not.toContain(name);
    });
});

describe('appFeatures.js exports', () => {
    const exported = new Set();
    const featuresSource = fs.readFileSync(path.join(SRC, 'appFeatures.js'), 'utf8');
    for (const m of featuresSource.matchAll(/export\s*\{([^}]*)\}/g)) {
        for (const part of m[1].split(',')) {
            const name = part.trim().split(/\s+as\s+/).pop();
            if (name) exported.add(name);
        }
    }

    test.each(['app.js', 'ui.js'])('every lazyFeature() name used by %s is exported', (file) => {
        const source = fs.readFileSync(path.join(SRC, file), 'utf8');
        const used = [...source.matchAll(/lazyFeature\('(\w+)'\)/g)].map(m => m[1]);
        expect(used.length).toBeGreaterThan(0);
        expect(used.filter(n => !exported.has(n))).toEqual([]);
    });
});
