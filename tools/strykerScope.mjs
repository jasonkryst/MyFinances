// Stryker mutate scope, by function name (issue #452).
//
// stryker.config.mjs used to hard-code line ranges ('src/sanitizers.js:5-64'),
// which drifted as the files grew until most pointed at unrelated code. Here
// the scope is a list of function names per file; buildMutateGlobs() parses
// each file with Babel at config-load time and emits exact `file:start-end`
// ranges, so the ranges can never drift. A name that no longer resolves throws,
// which fails the Stryker run and tests/unit/strykerScope.test.js.
//
// Rule for what belongs here: the pure, DOM-free functions that tests/unit
// imports directly from these files. The Jest guard fails when a unit test
// imports a function from a scoped file that is in neither MUTATE_SCOPE nor
// EXCLUDED, so a newly tested function can't be silently left unmutated.
//
// `node tools/strykerScope.mjs` prints the resolved globs;
// `node tools/strykerScope.mjs --check` prints a JSON report for the guard.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseSync } from '@babel/core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// A file mapped to `true` is mutated whole.
export const MUTATE_SCOPE = {
    'src/debtCalculator.js': ['calculatePaymentPlan', 'formatDate', 'calculateMonthsBetweenDates'],
    'src/utils.js': [
        'formatCurrency', 'normalizeText', 'normalizeMultilineText', 'sanitizeFiniteNumber',
        'parseFiniteOrNull', 'formatShortDate', 'formatMonthYear', 'sanitizeInteger', 'sanitizeDateISO',
        'dateToISO', 'dailyCompoundInterest', 'computeNetIncomeAmount', 'computeMonthlyIncomeForMonth', 'withBusy',
    ],
    'src/sanitizers.js': [
        'sanitizePerson', 'sanitizeAccount', 'sanitizeDebt', 'sanitizeOwnershipSplit', 'remapDebtPersonRefs',
        'remapIncomePersonRef', 'sanitizeIncome', 'sanitizeBonus', 'sanitizeBill', 'sanitizeExpense',
        'sanitizeRecurringTemplate', 'sanitizeLedgerOverrides', 'sanitizeHomePurchasePlan',
        'sanitizeLedgerClearedTransactions', 'sanitizeEmergencyFund', 'sanitizeSinkingFund',
        'sanitizeNetWorthSnapshot', 'sanitizeForecastSettings', 'sanitizeSetting', 'sanitizeRetirementSnapshot',
        'sanitizeBalanceHistoryEntry', 'sanitizeReconciliation', 'sanitizePlanHistoryEntry',
    ],
    'src/retirementCalculator.js': [
        'computeRetirementProjection', 'splitGrowthFromContribution', 'getContributionLimit',
        'computeYtdContributions', 'computeMonthlyWithdrawal', 'computeScenarioRates',
        'computeRetirementProjectionScenarios', 'computeRetirementProjectionSeries', 'computeCoastFire',
    ],
    'src/balanceHistoryCore.js': true,
    // #456: shared new-password rules (browser meter + server enforcement).
    'src/passwordPolicy.js': true,
    // #564: partial plan-settings PATCH body builder.
    'src/planSettingsPatch.js': true,
    // #519: bounded request pool for import/rollback fan-outs.
    'src/concurrency.js': true,
    // #520: Ledger override/cleared key remapping on import.
    'src/ledgerKeyRemap.js': true,
    // #578: optimistic-concurrency diff/conflict helpers.
    'src/recordVersions.js': true,
    // #575: refresh-on-focus / cross-tab refresh decisions.
    'src/refreshPolicy.js': true,
};

// Imported by tests/unit from a scoped file but deliberately not mutated.
export const EXCLUDED = {
    'src/sanitizers.js': {
        // The import orchestrator: hundreds of lines whose behavior is covered
        // end-to-end by the Playwright import tests, not by Jest. Mutating it
        // would swamp the score with mutants Jest was never meant to kill.
        sanitizeParsedState: 'import orchestrator, covered by Playwright not Jest',
    },
};

function parseFile(relPath) {
    const code = readFileSync(path.join(ROOT, relPath), 'utf8');
    return parseSync(code, {
        filename: relPath, sourceType: 'module', configFile: false, babelrc: false,
        parserOpts: { errorRecovery: false },
    });
}

function nodeName(node) {
    switch (node.type) {
        case 'FunctionDeclaration': return node.id && node.id.name;
        case 'ClassMethod': case 'ObjectMethod': return !node.computed && node.key && (node.key.name || node.key.value);
        case 'VariableDeclarator':
            return node.init && /^(Arrow)?FunctionExpression$/.test(node.init.type) && node.id.name;
        default: return null;
    }
}

// name -> [{ start, end }] for every named function-like node in the file.
export function collectFunctions(relPath) {
    const found = new Map();
    const walk = node => {
        if (!node || typeof node.type !== 'string') return;
        const name = nodeName(node);
        if (name) {
            if (!found.has(name)) found.set(name, []);
            found.get(name).push({ start: node.loc.start.line, end: node.loc.end.line });
        }
        for (const key of Object.keys(node)) {
            if (key === 'loc' || key === 'leadingComments' || key === 'trailingComments' || key === 'innerComments') continue;
            const child = node[key];
            if (Array.isArray(child)) child.forEach(walk);
            else if (child && typeof child === 'object') walk(child);
        }
    };
    walk(parseFile(relPath).program);
    return found;
}

// [{ file, name, start, end }] for MUTATE_SCOPE; throws on a missing or
// ambiguous (declared more than once) name.
export function resolveScope() {
    const out = [];
    for (const [file, names] of Object.entries(MUTATE_SCOPE)) {
        if (names === true) { out.push({ file, name: '*', start: null, end: null }); continue; }
        const fns = collectFunctions(file);
        for (const name of names) {
            const hits = fns.get(name) || [];
            if (hits.length !== 1) {
                throw new Error(`strykerScope: ${file} has ${hits.length} declarations of "${name}" (expected 1). `
                    + 'Update MUTATE_SCOPE in tools/strykerScope.mjs.');
            }
            out.push({ file, name, ...hits[0] });
        }
    }
    // Stable, readable order: file order as listed, then by line.
    const fileOrder = Object.keys(MUTATE_SCOPE);
    return out.sort((a, b) => fileOrder.indexOf(a.file) - fileOrder.indexOf(b.file) || (a.start ?? 0) - (b.start ?? 0));
}

export function buildMutateGlobs() {
    return resolveScope().map(r => (r.start === null ? r.file : `${r.file}:${r.start}-${r.end}`));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    if (process.argv.includes('--check')) {
        const functions = {};
        for (const file of Object.keys(MUTATE_SCOPE)) {
            functions[file] = Object.fromEntries(collectFunctions(file));
        }
        let resolved = null, error = null;
        try { resolved = resolveScope(); } catch (e) { error = e.message; }
        process.stdout.write(JSON.stringify({ scope: MUTATE_SCOPE, excluded: EXCLUDED, resolved, error, functions }));
    } else {
        for (const g of buildMutateGlobs()) console.log(g);
    }
}
