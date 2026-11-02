import { buildMutateGlobs } from './tools/strykerScope.mjs';

export default {
    packageManager: 'npm',
    testRunner: 'jest',
    reporters: ['html', 'clear-text', 'progress'],
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
