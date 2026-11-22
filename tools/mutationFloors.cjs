#!/usr/bin/env node
// Per-file mutation score floors (issue #549).
//
// Stryker's own thresholds are global, so one file can lose half its score
// while the total stays green. This reads Stryker's JSON report
// (reports/mutation/mutation.json, the `json` reporter) and fails when any
// file scores below its floor in tools/mutationFloors.json, or when a mutated
// file has no floor yet.
//
//   node tools/mutationFloors.cjs            check (exit 1 on a failure)
//   node tools/mutationFloors.cjs --derive   print new floors: floor(score) - MARGIN
//
// Floors are re-derived from a full run whenever tests raise a score; never
// lower one to make a run pass without saying why in the PR.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const REPORT_PATH = path.join(ROOT, 'reports', 'mutation', 'mutation.json');
const FLOORS_PATH = path.join(ROOT, 'tools', 'mutationFloors.json');
const MARGIN = 3;

const DETECTED = new Set(['Killed', 'Timeout']);
const UNDETECTED = new Set(['Survived', 'NoCoverage']);

// { file: { score, detected, undetected } } using Stryker's mutation score:
// detected / (detected + undetected). Errors and ignored mutants don't count.
// A file with no valid mutants is left out.
function computeFileScores(report) {
    const scores = {};
    const files = (report && report.files) || {};
    for (const [file, data] of Object.entries(files)) {
        let detected = 0;
        let undetected = 0;
        for (const m of (data && data.mutants) || []) {
            if (DETECTED.has(m.status)) detected++;
            else if (UNDETECTED.has(m.status)) undetected++;
        }
        const total = detected + undetected;
        if (total === 0) continue;
        scores[normalize(file)] = { score: (detected / total) * 100, detected, undetected };
    }
    return scores;
}

function normalize(file) {
    return file.split(path.sep).join('/').replace(/^\.\//, '');
}

// Failures as readable strings; empty means every file meets its floor.
function checkFloors(scores, floors) {
    const failures = [];
    for (const [file, { score }] of Object.entries(scores)) {
        if (!Object.prototype.hasOwnProperty.call(floors, file)) {
            failures.push(`${file}: no floor in tools/mutationFloors.json (scored ${score.toFixed(2)}; run --derive)`);
        } else if (score < floors[file]) {
            failures.push(`${file}: ${score.toFixed(2)} is below its floor ${floors[file]}`);
        }
    }
    return failures.sort();
}

function deriveFloors(scores, margin = MARGIN) {
    const out = {};
    for (const file of Object.keys(scores).sort()) {
        out[file] = Math.max(0, Math.floor(scores[file].score) - margin);
    }
    return out;
}

function main(argv) {
    if (!fs.existsSync(REPORT_PATH)) {
        console.error(`No mutation report at ${path.relative(ROOT, REPORT_PATH)}; run \`npm run test:mutation\` first.`);
        return 1;
    }
    const scores = computeFileScores(JSON.parse(fs.readFileSync(REPORT_PATH, 'utf8')));
    if (argv.includes('--derive')) {
        process.stdout.write(`${JSON.stringify(deriveFloors(scores), null, 4)}\n`);
        return 0;
    }
    const floors = JSON.parse(fs.readFileSync(FLOORS_PATH, 'utf8'));
    for (const [file, { score }] of Object.entries(scores).sort()) {
        console.log(`${file.padEnd(34)} ${score.toFixed(2).padStart(6)}  floor ${floors[file] ?? '-'}`);
    }
    const failures = checkFloors(scores, floors);
    if (failures.length) {
        for (const f of failures) console.error(`::error::${f}`);
        return 1;
    }
    console.log('Every file meets its mutation floor.');
    return 0;
}

module.exports = { computeFileScores, checkFloors, deriveFloors, MARGIN };

if (require.main === module) process.exitCode = main(process.argv.slice(2));
