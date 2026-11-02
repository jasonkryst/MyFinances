// Guards the Stryker mutate scope (issue #452). tools/strykerScope.mjs turns
// function names into line ranges at config-load time; this checks the names
// still resolve and that no unit-tested function is silently left unmutated.
// It runs the resolver in a child process because the resolver is an ES
// module (Babel 8 is ESM-only) and this Jest suite is CommonJS.

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

function loadReport() {
    const out = execFileSync(process.execPath, [path.join(ROOT, 'tools', 'strykerScope.mjs'), '--check'], {
        cwd: ROOT, encoding: 'utf8',
    });
    return JSON.parse(out);
}

// { 'src/x.js': Set(names) } imported by tests/unit/*.test.js.
function unitTestImports() {
    const imports = {};
    const add = (file, name) => { (imports[file] = imports[file] || new Set()).add(name); };
    const dir = path.join(ROOT, 'tests', 'unit');
    for (const f of fs.readdirSync(dir).filter(n => n.endsWith('.test.js'))) {
        const src = fs.readFileSync(path.join(dir, f), 'utf8');
        for (const m of src.matchAll(/const\s*\{([^}]*)\}\s*=\s*require\(\s*['"]\.\.\/\.\.\/(src\/[\w./]+\.js)['"]\s*\)/g)) {
            for (const raw of m[1].split(',')) {
                const name = raw.split(':')[0].trim();
                if (name) add(m[2], name);
            }
        }
        // DebtCalculator is a class required whole; its tested surface is the
        // static methods the tests call.
        if (/require\(\s*['"]\.\.\/\.\.\/src\/debtCalculator\.js['"]\s*\)/.test(src)) {
            for (const m of src.matchAll(/DebtCalculator\.(\w+)\s*\(/g)) add('src/debtCalculator.js', m[1]);
        }
    }
    return imports;
}

describe('Stryker mutate scope (tools/strykerScope.mjs)', () => {
    const report = loadReport();

    test('every scoped function name resolves to exactly one declaration', () => {
        expect(report.error).toBeNull();
        expect(report.resolved.length).toBeGreaterThan(30);
    });

    test('each resolved range is exactly its function\'s declaration span', () => {
        for (const r of report.resolved) {
            if (r.name === '*') continue;
            const decls = report.functions[r.file][r.name];
            expect({ name: r.name, decls }).toEqual({ name: r.name, decls: [{ start: r.start, end: r.end }] });
            expect(r.end).toBeGreaterThanOrEqual(r.start);
        }
    });

    test('every function a unit test imports from a scoped file is mutated or explicitly excluded', () => {
        const imports = unitTestImports();
        const missing = [];
        for (const [file, names] of Object.entries(imports)) {
            const scope = report.scope[file];
            if (scope === undefined || scope === true) continue;
            const excluded = report.excluded[file] || {};
            for (const name of names) {
                const isFunction = Object.prototype.hasOwnProperty.call(report.functions[file], name);
                if (isFunction && !scope.includes(name) && !(name in excluded)) missing.push(`${file}: ${name}`);
            }
        }
        expect(missing).toEqual([]);
    });

    test('EXCLUDED entries are real, not also scoped, and carry a reason', () => {
        for (const [file, entries] of Object.entries(report.excluded)) {
            for (const [name, reason] of Object.entries(entries)) {
                expect(report.functions[file]).toHaveProperty([name]);
                expect(report.scope[file]).not.toContain(name);
                expect(typeof reason).toBe('string');
                expect(reason.length).toBeGreaterThan(10);
            }
        }
    });

    test('stryker.config.mjs takes its mutate list from the resolver, not hand-written ranges', () => {
        const cfg = fs.readFileSync(path.join(ROOT, 'stryker.config.mjs'), 'utf8');
        expect(cfg).toMatch(/mutate:\s*buildMutateGlobs\(\)/);
        expect(cfg).not.toMatch(/['"]src\/[\w./]+\.js:\d+-\d+['"]/);
    });
});
