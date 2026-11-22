// Per-file mutation floors (#549): the score maths and the floor check.
const fs = require('fs');
const path = require('path');
const { computeFileScores, checkFloors, deriveFloors, MARGIN } = require('../../tools/mutationFloors.cjs');

const mutants = (...statuses) => statuses.map(status => ({ status }));

describe('computeFileScores', () => {
    test('detected = Killed + Timeout over detected + Survived + NoCoverage', () => {
        const scores = computeFileScores({ files: {
            'src/a.js': { mutants: mutants('Killed', 'Killed', 'Timeout', 'Survived', 'NoCoverage', 'CompileError', 'RuntimeError', 'Ignored') },
        } });
        expect(scores['src/a.js']).toEqual({ score: 60, detected: 3, undetected: 2 });
    });

    test('a file with only errors or ignored mutants is left out', () => {
        expect(computeFileScores({ files: { 'src/b.js': { mutants: mutants('CompileError', 'Ignored') } } })).toEqual({});
    });

    test('normalizes ./ prefixes and tolerates an empty report', () => {
        expect(Object.keys(computeFileScores({ files: { './src/c.js': { mutants: mutants('Killed') } } }))).toEqual(['src/c.js']);
        expect(computeFileScores(null)).toEqual({});
        expect(computeFileScores({ files: { 'src/d.js': {} } })).toEqual({});
    });
});

describe('checkFloors', () => {
    const scores = { 'src/a.js': { score: 60 }, 'src/b.js': { score: 59.99 } };

    test('passes when every file is at or above its floor', () => {
        expect(checkFloors(scores, { 'src/a.js': 60, 'src/b.js': 50 })).toEqual([]);
    });

    test('fails a file below its floor', () => {
        expect(checkFloors(scores, { 'src/a.js': 60, 'src/b.js': 60 })).toEqual(['src/b.js: 59.99 is below its floor 60']);
    });

    test('fails a mutated file that has no floor', () => {
        const failures = checkFloors(scores, { 'src/a.js': 1 });
        expect(failures).toHaveLength(1);
        expect(failures[0]).toMatch(/^src\/b\.js: no floor/);
    });

    test('a floor for a file no longer mutated is ignored', () => {
        expect(checkFloors({ 'src/a.js': { score: 90 } }, { 'src/a.js': 80, 'src/gone.js': 99 })).toEqual([]);
    });
});

describe('deriveFloors', () => {
    test(`is floor(score) - ${MARGIN}, never negative, sorted by file`, () => {
        expect(MARGIN).toBe(3);
        const out = deriveFloors({ 'src/z.js': { score: 64.99 }, 'src/a.js': { score: 2 }, 'src/m.js': { score: 100 } });
        expect(out).toEqual({ 'src/a.js': 0, 'src/m.js': 97, 'src/z.js': 61 });
        expect(Object.keys(out)).toEqual(['src/a.js', 'src/m.js', 'src/z.js']);
    });
});

describe('tools/mutationFloors.json', () => {
    const floors = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'tools', 'mutationFloors.json'), 'utf8'));

    test('has a numeric floor between 0 and 100 for each file', () => {
        expect(Object.keys(floors).length).toBeGreaterThan(20);
        for (const [file, floor] of Object.entries(floors)) {
            expect(file).toMatch(/^src\/[\w.]+\.js$/);
            expect(Number.isInteger(floor) && floor >= 0 && floor <= 100).toBe(true);
        }
    });

    test('covers every file in the Stryker scope', () => {
        const scope = require('child_process').execFileSync(process.execPath,
            [path.join(__dirname, '..', '..', 'tools', 'strykerScope.mjs'), '--check'],
            { cwd: path.join(__dirname, '..', '..'), encoding: 'utf8' });
        const files = Object.keys(JSON.parse(scope).scope);
        expect(files.filter(f => !(f in floors))).toEqual([]);
    });

    test('debtCalculator.js keeps a floor of at least 60 (#549)', () => {
        expect(floors['src/debtCalculator.js']).toBeGreaterThanOrEqual(60);
    });
});
