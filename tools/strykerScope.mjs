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
// `node tools/strykerScope.mjs --check` prints a JSON report for the guard;
// `--files` prints the scoped files, one per line (the PR mutation job).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseSync } from '@babel/core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// A file mapped to `true` is mutated whole.
export const MUTATE_SCOPE = {
    'src/debtCalculator.js': ['calculatePaymentPlan', 'formatDate', 'calculateMonthsBetweenDates',
        // #681: promotional APR.
        'hasPromo', 'promoDaysInMonth', 'promoEndsInMonth', 'monthlyInterest', 'rateForMonth', 'getPaymentOrder'],
    'src/utils.js': [
        'formatCurrency', 'normalizeText', 'normalizeMultilineText', 'sanitizeFiniteNumber',
        'parseFiniteOrNull', 'formatShortDate', 'formatMonthYear', 'sanitizeInteger', 'sanitizeDateISO',
        'dateToISO', 'dailyCompoundInterest', 'computeNetIncomeAmount', 'computeMonthlyIncomeForMonth', 'withBusy', 'isTransferLegTx',
        'getBonusDatesInMonth', 'getNextBonusDate', 'computeMonthlyBonusesForMonth', 'getBonusesByDayForMonth',
        'formatDateCached', 'formatLongDate', 'formatMonthLong', 'formatReportRangeLabel', 'parseContributionAmount', 'parseRetryAfterMinutes',
        'formatCurrencyAxis', 'formatCurrencyCompact', 'getCurrencyAffix', 'cachedCurrencyFormatter',
        // #679: payday helpers and the income end date.
        'getIncomePaydaysInMonth', 'countIncomePaydaysInMonth', 'getNextIncomePayDates', 'getIncomeEndDate', 'isIncomeEnded',
        // #547: escaping and the shared report-range helpers.
        'escapeHtml', 'getReportRangeMonths', 'reportRangeMonthsList', 'getPriorEquivalentRangeEnd',
    ],
    'src/sanitizers.js': [
        'sanitizePerson', 'sanitizeAccount', 'sanitizeDebt', 'sanitizeOwnershipSplit', 'remapDebtPersonRefs',
        'remapIncomePersonRef', 'sanitizeIncome', 'sanitizeBonus', 'sanitizeBill', 'sanitizeExpense',
        'sanitizeRecurringTemplate', 'sanitizeLedgerOverrides', 'sanitizeHomePurchasePlan',
        'sanitizeLedgerClearedTransactions', 'sanitizeEmergencyFund', 'sanitizeSinkingFund',
        'sanitizeNetWorthSnapshot', 'sanitizeForecastSettings', 'sanitizeLedgerSettings', 'sanitizeSetting', 'sanitizeRetirementSnapshot',
        'sanitizeBalanceHistoryEntry', 'sanitizeReconciliation', 'sanitizePlanHistoryEntry',
        'sanitizeManualTransaction', 'isValidManualTransaction', 'isValidTransfer', 'isValidReconciliation',
        'isValidRecurringTemplate', 'sanitizeLowBalanceThreshold',
        // #548: were neither listed nor excluded.
        'sanitizeTransfer', 'sanitizeBudgetCategories',
        // #312
        'sanitizePlanHistoryDebts',
        // #587
        'sanitizeReconDraft', 'sanitizeReconDrafts',
    ],
    // #548: the pure settings helpers (DOM-free; setSetting's pgPut is mocked in Jest).
    'src/settings.js': [
        'budgetThresholdKey', 'getSetting', 'setSetting', 'getFireMultiplier', 'computeFireNumber',
        'getCoastFireTarget', 'getZeroAmountPolicy', 'buildSettingsExport', 'parseSettingsImport',
    ],
    // #569: the shared settings key/value allowlist (browser export + server).
    'src/settingsSchema.js': ['validateExportedSetting', 'isAllowedSetting', 'isValidLedgerHiddenColumns'],
    // #651: account-id settings follow their account on import.
    'src/settingsRemap.js': true,
    'src/retirementCalculator.js': [
        'computeRetirementProjection', 'splitGrowthFromContribution', 'getContributionLimit',
        'computeYtdContributions', 'computeMonthlyWithdrawal', 'computeScenarioRates',
        'computeRetirementProjectionScenarios', 'computeRetirementProjectionSeries', 'computeCoastFire',
    ],
    'src/balanceHistoryCore.js': true,
    // #585: estimated net-worth trend points from balance history.
    'src/netWorthEstimate.js': true,
    // #211: bill-due and balance alert rules (browser + server notifications job).
    'src/notificationsCore.js': true,
    // #681: promotional APR helpers shared with the server.
    'src/promoApr.js': true,
    // #312: Plan History per-debt comparison.
    'src/planHistoryCompare.js': true,
    // #577: Undo's Ledger-key move for a re-created record.
    'src/undoCore.js': true,
    // #678: effective-dated amounts (income + recurring templates).
    'src/amountSchedule.js': true,
    // #680: sinking fund target-date schedule (required amount, status).
    'src/sinkingFundSchedule.js': true,
    // #689: Year in review insight rules.
    'src/yearReviewCore.js': true,
    // #456: shared new-password rules (browser meter + server enforcement).
    'src/passwordPolicy.js': true,
    // #564: partial plan-settings PATCH body builder.
    'src/planSettingsPatch.js': true,
    // #519: bounded request pool for import/rollback fan-outs.
    'src/concurrency.js': true,
    // #520: Ledger override/cleared key remapping on import.
    'src/ledgerKeyRemap.js': true,
    // #567/#478: merge-mode natural-key dedupe.
    'src/mergeDedupe.js': true,
    // #165: weekend due-date shift (shared by the browser and the server calendar feed).
    'src/weekendRule.js': true,
    // #330: pure list pagination slice/clamp.
    'src/pagination.js': true,
    // #686: command palette record search (fold, rank, group, cap).
    'src/paletteSearch.js': true,
    // #578: optimistic-concurrency diff/conflict helpers.
    'src/recordVersions.js': true,
    // #575: refresh-on-focus / cross-tab refresh decisions.
    'src/refreshPolicy.js': true,
    // #608: child-first deletion layers for Clear All Data.
    'src/resourceDeletion.js': true,
    // #586: Ledger free-text search predicate.
    'src/ledgerSearch.js': true,
    // #643: Notifications page filter/group/selection core.
    'src/notificationsFilter.js': true,
    // #580: Change history page helpers (changed fields, names, values, query).
    'src/changeHistoryCore.js': true,
    // #576: Saving/Saved chip state reducer.
    'src/saveStatus.js': true,
    // #518: render-scoped projection cache.
    'src/projectionCache.js': true,
    // #579: pure core shared by the browser and the server's snapshot job.
    'src/recurringOccurrences.js': true,
    'src/ledgerStateCore.js': true,
    'src/netWorthCore.js': true,
    // #547: ownership share math (the form-control half is DOM and stays out).
    'src/debtOwnership.js': ['getDebtShare', 'hasCustomSplit', 'removePersonFromDebt', 'equalPercents', 'autoBalancePercents', 'round2'],
    // #547: category budget derivation and mutations (render/panel code stays out).
    'src/categoryBudgets.js': ['_configured', '_isFixed', 'computeDerivedBudgetByCategory', 'computeCategoryBudgets',
        'setCategoryBudget', 'resetCategoryBudget', 'getKnownBudgetCategories'],
    'src/projectionCore.js': ['makeLedgerTransactionId', 'getLedgerTransactionsForMonth', 'computeAccountBalance', 'buildProjectedAccountTransactions'],
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
    } else if (process.argv.includes('--files')) {
        // One scoped file per line (#549: the PR mutation job's change check).
        for (const file of Object.keys(MUTATE_SCOPE)) console.log(file);
    } else {
        for (const g of buildMutateGlobs()) console.log(g);
    }
}
