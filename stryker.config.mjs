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
    // A mutant that removes a loop's exit (e.g. calculatePaymentPlan's
    // 600-month cap) can allocate without bound until Stryker's timeout. With
    // several workers that exhausted the CI runner's memory and killed the
    // whole job (#675). Capping each worker's heap makes such a mutant crash
    // only its own worker, which Stryker restarts.
    testRunnerNodeArgs: ['--max-old-space-size=1536'],
    // Re-derived from the full run after #548/#549 (score 84.41%):
    // low = floor(score), break = low-10, high = low+5. Per-file floors
    // (tools/mutationFloors.json, checked by tools/mutationFloors.cjs) are
    // the stricter gate; this global break only catches a collapse.
    thresholds: { high: 89, low: 84, break: 74 },
};
