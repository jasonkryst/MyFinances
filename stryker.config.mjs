import { buildMutateGlobs } from './tools/strykerScope.mjs';

export default {
    packageManager: 'npm',
    testRunner: 'jest',
    // `json` feeds the per-file floor check (tools/mutationFloors.cjs, #549).
    reporters: ['html', 'clear-text', 'progress', 'json'],
    // Reused by the PR job's `--incremental` run (#549); main's full run
    // (`--incremental --force`) refreshes it and caches it for PRs.
    incrementalFile: 'reports/stryker-incremental.json',
    // Mutation is scoped to exactly the functions tests/unit imports from
    // these files; the rest of each file is DOM-coupled or out of scope and
    // would only add no-coverage mutants. Ranges are generated from function
    // names at config-load time (tools/strykerScope.mjs, issue #452) because
    // hand-written line ranges drifted off their functions as files grew.
    // Edit MUTATE_SCOPE there, not line numbers here.
    mutate: buildMutateGlobs(),
    jest: {
        configFile: 'jest.config.js',
    },
    // Derived from the real local mutation run (score 64.56%, issue #452, the
    // first run whose ranges actually hit the tested functions):
    // low = floor(score), break = low-10, high = low+5.
    thresholds: { high: 69, low: 64, break: 54 },
};
