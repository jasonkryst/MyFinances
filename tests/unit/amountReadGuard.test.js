// #678: income and recurring-template amounts are effective-dated, so code must
// read them through getAmountOn / getCurrentAmount / computeNetIncomeAmount
// (src/amountSchedule.js, src/utils.js), never `record.amount` directly. This
// guard flags a direct `.amount` read on the variable names those records go
// by. A line that reads `.amount` of something else (a transaction, a bill, a
// bonus) carries `// amount-read-ok: <reason>`.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const SCAN_DIRS = ['src', path.join('server', 'src')];
const ALLOWED_FILES = new Set([
    'src/amountSchedule.js', // the one definition
    'src/sanitizers.js'      // shapes and validates the stored base amount
]);
const PATTERN = /\b(inc|income|incomes|tmpl|template|tpl|row)\.amount\b/;
const MARK = /\/\/ amount-read-ok: \S/;
// Files where recurring templates go by `t`.
const FILE_PATTERNS = {
    // also the sort comparator's `a`/`b` (#678 review)
    'src/recurring.js': /\b[tab]\.amount\b/,
    'src/recurringPaid.js': /\bt\.amount\b/
};

function walk(dir) {
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === 'locales' || entry.name === 'node_modules') continue;
            out.push(...walk(full));
        } else if (entry.name.endsWith('.js')) {
            out.push(full);
        }
    }
    return out;
}

test('no direct .amount read of an income or recurring template outside the helper', () => {
    const offenders = [];
    for (const dir of SCAN_DIRS) {
        for (const file of walk(path.join(ROOT, dir))) {
            const rel = path.relative(ROOT, file).split(path.sep).join('/');
            if (ALLOWED_FILES.has(rel)) continue;
            const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
            lines.forEach((line, i) => {
                const hit = PATTERN.test(line) || (FILE_PATTERNS[rel] && FILE_PATTERNS[rel].test(line));
                if (hit && !MARK.test(line)) offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
            });
        }
    }
    expect(offenders).toEqual([]);
});

test('the guard pattern catches the record variable names', () => {
    expect(PATTERN.test('formatCurrency(inc.amount)')).toBe(true);
    expect(PATTERN.test('Math.abs(Number(tmpl.amount))')).toBe(true);
    expect(PATTERN.test('buildDesc(row.amount, x)')).toBe(true);
    expect(PATTERN.test('tx.amount')).toBe(false);
    expect(PATTERN.test('const amountClass = 1')).toBe(false);
});
