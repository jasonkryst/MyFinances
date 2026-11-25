// Explicit per-category monthly budgets (issue #255).
//
// app.budgetCategories: { [category]: { mode: 'fixed' | 'derived', amount,
// rollover?: 'both' | 'overspend', rolloverStart?: 'YYYY-MM' } } (rollover: #687).
// A category with no entry is "derived": its budget is the scheduled
// (pre-override) amount of the month's bills / expenses / outflow recurring
// templates in that category - bucketed with the exact classifier the Spending
// report uses for actuals, so budget and actual are directly comparable.
//
// Every export here is a hoisted function declaration (bills.js imports this
// module and sits on the ui.js import cycle - see CLAUDE.md).

import { escapeHtml, formatCurrency, normalizeText, reportRangeMonthsList } from './utils.js';
import { t, categoryLabel } from './i18n.js';
import { getLedgerTransactionsForMonth } from './ledgerTransactions.js';
import { spendingCategoryForTx, computeSpendingByCategoryRange } from './spending.js';
import { BUDGET_CATEGORY_MAX_AMOUNT, BUDGET_CATEGORY_MAX_ENTRIES } from './sanitizers.js';
import { withProjectionCache } from './projectionCache.js';
import {
    isValidRolloverMode, isValidRolloverStart, computeRolloverCarry, rolloverMonthsBefore
} from './budgetRollover.js';

const FORBIDDEN_KEYS = ['__proto__', 'constructor', 'prototype'];

function _configured(app) {
    return app.budgetCategories && typeof app.budgetCategories === 'object' ? app.budgetCategories : {};
}

function _isFixed(entry) {
    return !!entry && entry.mode === 'fixed';
}

function _rolloverOf(entry) {
    return entry && isValidRolloverMode(entry.rollover) && isValidRolloverStart(entry.rolloverStart)
        ? { mode: entry.rollover, start: entry.rolloverStart }
        : null;
}

// Carry into (year, month) for each rollover category: Map<category, carry>.
// One derived + actual pass per month, shared by every rollover category.
export function computeRolloverCarriesForApp(app, year, month) {
    const configured = _configured(app);
    const out = new Map();
    const monthsByStart = new Map();
    for (const cat of Object.keys(configured)) {
        const ro = _rolloverOf(configured[cat]);
        if (ro && !monthsByStart.has(ro.start)) monthsByStart.set(ro.start, rolloverMonthsBefore(ro.start, year, month));
    }
    if (monthsByStart.size === 0) return out;
    const perMonth = new Map();
    const monthData = (y, m) => {
        const key = `${y}-${m}`;
        if (!perMonth.has(key)) {
            const actual = new Map();
            for (const { category, total } of computeSpendingByCategoryRange(app, y, m, 1)) actual.set(category, total);
            perMonth.set(key, { derived: computeDerivedBudgetByCategory(app, y, m), actual });
        }
        return perMonth.get(key);
    };
    for (const cat of Object.keys(configured)) {
        const entry = configured[cat];
        const ro = _rolloverOf(entry);
        if (!ro) continue;
        const rows = monthsByStart.get(ro.start).map(({ year: y, month: m }) => {
            const d = monthData(y, m);
            return {
                budget: _isFixed(entry) ? entry.amount : (d.derived.get(cat) || 0),
                actual: d.actual.get(cat) || 0
            };
        });
        out.set(cat, computeRolloverCarry(rows, ro.mode));
    }
    return out;
}

// The single derivation: Map<category, scheduled monthly amount>.
export function computeDerivedBudgetByCategory(app, year, month) {
    const out = new Map();
    for (const tx of getLedgerTransactionsForMonth(app, year, month)) {
        // Manual transactions (#584) are actuals, not scheduled amounts:
        // counting them would raise the budget by exactly the overspend.
        if (tx.type === 'manual') continue;
        const cat = spendingCategoryForTx({ ...tx, amount: tx.originalAmount });
        if (!cat) continue;
        out.set(cat, (out.get(cat) || 0) + Math.abs(tx.originalAmount || 0));
    }
    return out;
}

// Rows for the Variance "Budget vs. Actual" table over the rangeMonths-month
// range ending at (year, month).
export function computeCategoryBudgets(app, year, month, rangeMonths = 1) {
    const configured = _configured(app);
    const months = reportRangeMonthsList(year, month, rangeMonths);
    const derivedTotals = new Map();
    for (const { year: y, month: m } of months) {
        for (const [cat, amt] of computeDerivedBudgetByCategory(app, y, m)) {
            derivedTotals.set(cat, (derivedTotals.get(cat) || 0) + amt);
        }
    }
    const actuals = new Map();
    for (const { category, total } of computeSpendingByCategoryRange(app, year, month, rangeMonths)) {
        actuals.set(category, total);
    }
    const carries = withProjectionCache(app, () => computeRolloverCarriesForApp(app, months[0].year, months[0].month));
    const names = new Set([...derivedTotals.keys(), ...actuals.keys(), ...Object.keys(configured)]);
    const rows = [];
    for (const category of names) {
        const entry = Object.prototype.hasOwnProperty.call(configured, category) ? configured[category] : null;
        const fixed = _isFixed(entry);
        const budget = fixed ? entry.amount * months.length : (derivedTotals.get(category) || 0);
        const actual = actuals.get(category) || 0;
        if (!entry && budget === 0 && actual === 0) continue;
        const ro = _rolloverOf(entry);
        const carried = ro ? (carries.get(category) || 0) : 0;
        const available = budget + carried;
        rows.push({
            category,
            mode: fixed ? 'fixed' : 'derived',
            rollover: ro ? ro.mode : null,
            budget,
            carried,
            available,
            actual,
            difference: available - actual,
            pctUsed: available > 0 ? actual / available : null,
            over: actual > available + 0.005
        });
    }
    rows.sort((a, b) => (b.actual - a.actual) || a.category.localeCompare(b.category));
    return rows;
}

function _signedCurrency(n) {
    return `${n < 0 ? '-' : ''}${formatCurrency(Math.abs(n))}`;
}

// Budget vs. Actual table markup for Reports -> Variance.
export function renderBudgetVsActualHtml(app, year, month, rangeMonths) {
    const rows = computeCategoryBudgets(app, year, month, rangeMonths);
    const heading = `<h3 class="var-title bva-title">${escapeHtml(t('reports.bvaTitle'))}</h3>
        <p class="var-subtitle">${escapeHtml(rangeMonths > 1 ? t('reports.bvaSubRange', { n: rangeMonths }) : t('reports.bvaSub'))}</p>`;
    if (rows.length === 0) {
        return `<div class="bva-section" id="budgetVsActual">${heading}<p class="bva-empty">${escapeHtml(t('reports.bvaEmpty'))}</p></div>`;
    }
    const body = rows.map(r => {
        const name = escapeHtml(r.category);
        const shownName = escapeHtml(categoryLabel(r.category));
        const diffCls = r.over ? 'bva-neg' : 'bva-pos';
        const diffText = `${r.difference >= 0 ? '' : '-'}${formatCurrency(Math.abs(r.difference))}`;
        const carryRow = r.rollover
            ? `<span class="bva-cell bva-carry" data-label="${escapeHtml(t('reports.bvaCarried'))}">${escapeHtml(t('reports.bvaCarryNote', { carried: _signedCurrency(r.carried), available: _signedCurrency(r.available) }))}</span>`
            : '';
        const pct = r.pctUsed === null ? '—' : `${Math.round(r.pctUsed * 100)}%`;
        return `<div class="bva-row${r.over ? ' bva-row--over' : ''}" data-category="${name}">
            <span class="bva-cell bva-cat" data-label="${escapeHtml(t('reports.colCategory'))}">${shownName} <span class="bva-mode bva-mode--${r.mode}">${escapeHtml(r.mode === 'fixed' ? t('catBudgets.fixed') : t('catBudgets.derived'))}</span></span>
            <span class="bva-cell bva-budget" data-label="${escapeHtml(t('reports.bvaBudget'))}">${formatCurrency(r.budget)}</span>
            <span class="bva-cell bva-actual" data-label="${escapeHtml(t('reports.bvaActual'))}">${formatCurrency(r.actual)}</span>
            <span class="bva-cell bva-diff ${diffCls}" data-label="${escapeHtml(t('reports.bvaDifference'))}">${r.over ? escapeHtml(t('reports.bvaOver', { amount: diffText })) : diffText}</span>
            <span class="bva-cell bva-pct" data-label="${escapeHtml(t('reports.bvaPctUsed'))}">${pct}</span>
            ${carryRow}
        </div>`;
    }).join('');
    return `<div class="bva-section" id="budgetVsActual">${heading}
        <div class="bva-table">
            <div class="bva-header">
                <span>${escapeHtml(t('reports.colCategory'))}</span><span>${escapeHtml(t('reports.bvaBudget'))}</span><span>${escapeHtml(t('reports.bvaActual'))}</span><span>${escapeHtml(t('reports.bvaDifference'))}</span><span>${escapeHtml(t('reports.bvaPctUsed'))}</span>
            </div>
            ${body}
        </div>
    </div>`;
}

// ── Mutations ──────────────────────────────────────────────────────────────

// Returns { ok: true } or { ok: false, error }.
export function setCategoryBudget(app, rawName, mode, rawAmount, rawRollover, rawRolloverStart) {
    const name = normalizeText(rawName, 40);
    if (!name) return { ok: false, error: t('catBudgets.errName') };
    if (FORBIDDEN_KEYS.includes(name)) return { ok: false, error: t('catBudgets.errForbidden') };
    if (mode !== 'fixed' && mode !== 'derived') return { ok: false, error: t('catBudgets.errMode') };
    let amount = 0;
    if (mode === 'fixed') {
        const text = String(rawAmount ?? '').trim();
        const n = Number(text);
        if (text === '' || !Number.isFinite(n)) return { ok: false, error: t('catBudgets.errAmount') };
        if (n < 0) return { ok: false, error: t('catBudgets.errNegative') };
        if (n > BUDGET_CATEGORY_MAX_AMOUNT) return { ok: false, error: t('catBudgets.errTooLarge') };
        amount = n;
    }
    // #687: rollover is optional; '', null, undefined and 'off' all mean off.
    const rollover = rawRollover === undefined || rawRollover === null || rawRollover === '' || rawRollover === 'off' ? null : rawRollover;
    if (rollover !== null) {
        if (!isValidRolloverMode(rollover)) return { ok: false, error: t('catBudgets.errRollover') };
        if (!isValidRolloverStart(rawRolloverStart)) return { ok: false, error: t('catBudgets.errRolloverStart') };
    }
    const current = _configured(app);
    if (!Object.prototype.hasOwnProperty.call(current, name) && Object.keys(current).length >= BUDGET_CATEGORY_MAX_ENTRIES) {
        return { ok: false, error: t('catBudgets.errMax', { max: BUDGET_CATEGORY_MAX_ENTRIES }) };
    }
    const entry = rollover === null ? { mode, amount } : { mode, amount, rollover, rolloverStart: rawRolloverStart };
    app.budgetCategories = { ...current, [name]: entry };
    app.saveToStorage(['budgetCategories']);
    return { ok: true, name };
}

export function resetCategoryBudget(app, name) {
    const current = { ..._configured(app) };
    if (!Object.prototype.hasOwnProperty.call(current, name)) return;
    delete current[name];
    app.budgetCategories = current;
    app.saveToStorage(['budgetCategories']);
}

// ── Liabilities -> Budget panel ────────────────────────────────────────────

export function getKnownBudgetCategories(app, derived) {
    const names = new Set(derived.keys());
    for (const e of app.expenses || []) names.add(e.category || 'Other');
    for (const b of app.bills || []) names.add(b.category || 'Other');
    for (const k of Object.keys(_configured(app))) names.add(k);
    return Array.from(names).sort((a, b) => a.localeCompare(b));
}

let _statusMessage = '';

function _currentYearMonth() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function _rowHtml(app, name, derived, carryNow) {
    const entry = Object.prototype.hasOwnProperty.call(_configured(app), name) ? _configured(app)[name] : null;
    const fixed = _isFixed(entry);
    const n = escapeHtml(name);
    const label = categoryLabel(name);
    const derivedAmt = derived.get(name) || 0;
    const ro = _rolloverOf(entry);
    const roOption = (value, key) => `<option value="${value}"${(ro ? ro.mode : '') === value ? ' selected' : ''}>${escapeHtml(t(key))}</option>`;
    const note = ro && carryNow
        ? t('catBudgets.carriedNote', { carried: _signedCurrency(carryNow.carried), available: _signedCurrency(carryNow.available) })
        : '';
    return `<div class="cb-row" data-category="${n}">
        <span class="cb-name">${escapeHtml(label)}</span>
        <select class="cb-mode select-styled" aria-label="${escapeHtml(t('catBudgets.modeAria', { name: label }))}">
            <option value="derived"${fixed ? '' : ' selected'}>${escapeHtml(t('catBudgets.derived'))}</option>
            <option value="fixed"${fixed ? ' selected' : ''}>${escapeHtml(t('catBudgets.fixed'))}</option>
        </select>
        <input type="number" class="cb-amount" step="0.01" min="0" placeholder="0.00" aria-label="${escapeHtml(t('catBudgets.amountAria', { name: label }))}" value="${fixed ? escapeHtml(String(entry.amount)) : ''}"${fixed ? '' : ' disabled'}>
        <span class="cb-derived">${fixed ? '' : escapeHtml(t('catBudgets.derivedAmount', { amount: formatCurrency(derivedAmt) }))}</span>
        <span class="cb-actions">
            <button type="button" class="btn btn-small btn-success cb-save" aria-label="${escapeHtml(t('catBudgets.saveAria', { name: label }))}">${escapeHtml(t('common.save'))}</button>
            <button type="button" class="btn btn-small btn-secondary cb-reset" aria-label="${escapeHtml(t('catBudgets.resetAria', { name: label }))}"${entry ? '' : ' disabled'}>${escapeHtml(t('catBudgets.reset'))}</button>
        </span>
        <span class="cb-rollover">
            <select class="cb-rollover-mode select-styled" aria-label="${escapeHtml(t('catBudgets.rolloverAria', { name: label }))}">
                ${roOption('', 'catBudgets.rolloverOff')}
                ${roOption('both', 'catBudgets.rolloverBoth')}
                ${roOption('overspend', 'catBudgets.rolloverOverspend')}
            </select>
            <input type="month" class="cb-rollover-start" aria-label="${escapeHtml(t('catBudgets.rolloverStartAria', { name: label }))}" value="${ro ? escapeHtml(ro.start) : ''}"${ro ? '' : ' hidden'}>
            <span class="cb-carried">${escapeHtml(note)}</span>
        </span>
        <span class="cb-error" role="alert"></span>
    </div>`;
}

export function renderCategoryBudgetsPanel(app) {
    const container = document.getElementById('categoryBudgetsPanel');
    if (!container) return;
    const now = new Date();
    const derived = computeDerivedBudgetByCategory(app, now.getFullYear(), now.getMonth());
    const names = getKnownBudgetCategories(app, derived);
    const carryNow = new Map(computeCategoryBudgets(app, now.getFullYear(), now.getMonth(), 1).map(r => [r.category, r]));
    const rows = names.length
        ? names.map(n => _rowHtml(app, n, derived, carryNow.get(n))).join('')
        : `<p class="cb-empty">${escapeHtml(t('catBudgets.empty'))}</p>`;
    container.innerHTML = `
        <h3 class="cb-title">${escapeHtml(t('catBudgets.title'))}</h3>
        <p class="cb-help">${escapeHtml(t('catBudgets.help'))}</p>
        <p class="cb-status" role="status">${escapeHtml(_statusMessage)}</p>
        <div class="cb-list">${rows}</div>
        <div class="cb-add">
            <div class="form-group">
                <label for="cbNewName">${escapeHtml(t('catBudgets.newCategory'))}</label>
                <input type="text" id="cbNewName" maxlength="40" placeholder="${escapeHtml(t('catBudgets.newCategoryPlaceholder'))}">
            </div>
            <div class="form-group">
                <label for="cbNewAmount">${escapeHtml(t('catBudgets.newAmount'))}</label>
                <input type="number" id="cbNewAmount" step="0.01" min="0" placeholder="0.00">
            </div>
            <button type="button" class="btn btn-success" id="cbAddBtn">${escapeHtml(t('catBudgets.addBtn'))}</button>
            <span class="cb-error" id="cbAddError" role="alert"></span>
        </div>`;
    _statusMessage = '';

    container.onchange = (e) => {
        const roSel = e.target.closest('.cb-rollover-mode');
        if (roSel) {
            const start = roSel.closest('.cb-row').querySelector('.cb-rollover-start');
            start.hidden = roSel.value === '';
            // Turning rollover on starts it this month; the user can edit it.
            if (roSel.value !== '' && !start.value) start.value = _currentYearMonth();
            return;
        }
        const sel = e.target.closest('.cb-mode');
        if (!sel) return;
        const amount = sel.closest('.cb-row').querySelector('.cb-amount');
        amount.disabled = sel.value !== 'fixed';
        if (!amount.disabled) amount.focus();
    };
    container.onclick = (e) => {
        const addBtn = e.target.closest('#cbAddBtn');
        if (addBtn) {
            const err = container.querySelector('#cbAddError');
            const res = setCategoryBudget(app, container.querySelector('#cbNewName').value, 'fixed', container.querySelector('#cbNewAmount').value);
            if (!res.ok) { err.textContent = res.error; return; }
            _statusMessage = t('catBudgets.saved', { name: categoryLabel(res.name) });
            renderCategoryBudgetsPanel(app);
            return;
        }
        const row = e.target.closest('.cb-row');
        if (!row) return;
        const name = row.dataset.category;
        if (e.target.closest('.cb-save')) {
            const res = setCategoryBudget(app, name, row.querySelector('.cb-mode').value, row.querySelector('.cb-amount').value,
                row.querySelector('.cb-rollover-mode').value, row.querySelector('.cb-rollover-start').value);
            if (!res.ok) { row.querySelector('.cb-error').textContent = res.error; return; }
            _statusMessage = t('catBudgets.saved', { name: categoryLabel(name) });
            renderCategoryBudgetsPanel(app);
        } else if (e.target.closest('.cb-reset')) {
            resetCategoryBudget(app, name);
            _statusMessage = t('catBudgets.resetDone', { name: categoryLabel(name) });
            renderCategoryBudgetsPanel(app);
        }
    };
}
