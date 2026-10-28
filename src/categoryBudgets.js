// Explicit per-category monthly budgets (issue #255).
//
// app.budgetCategories: { [category]: { mode: 'fixed' | 'derived', amount } }.
// A category with no entry is "derived": its budget is the scheduled
// (pre-override) amount of the month's bills / expenses / outflow recurring
// templates in that category - bucketed with the exact classifier the Spending
// report uses for actuals, so budget and actual are directly comparable.
//
// Every export here is a hoisted function declaration (bills.js imports this
// module and sits on the ui.js import cycle - see CLAUDE.md).

import { escapeHtml, formatCurrency, normalizeText, reportRangeMonthsList } from './utils.js';
import { getLedgerTransactionsForMonth } from './ledgerTransactions.js';
import { spendingCategoryForTx, computeSpendingByCategoryRange } from './spending.js';
import { BUDGET_CATEGORY_MAX_AMOUNT, BUDGET_CATEGORY_MAX_ENTRIES } from './sanitizers.js';

const FORBIDDEN_KEYS = ['__proto__', 'constructor', 'prototype'];

function _configured(app) {
    return app.budgetCategories && typeof app.budgetCategories === 'object' ? app.budgetCategories : {};
}

function _isFixed(entry) {
    return !!entry && entry.mode === 'fixed';
}

// The single derivation: Map<category, scheduled monthly amount>.
export function computeDerivedBudgetByCategory(app, year, month) {
    const out = new Map();
    for (const tx of getLedgerTransactionsForMonth(app, year, month)) {
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
    const names = new Set([...derivedTotals.keys(), ...actuals.keys(), ...Object.keys(configured)]);
    const rows = [];
    for (const category of names) {
        const entry = Object.prototype.hasOwnProperty.call(configured, category) ? configured[category] : null;
        const fixed = _isFixed(entry);
        const budget = fixed ? entry.amount * months.length : (derivedTotals.get(category) || 0);
        const actual = actuals.get(category) || 0;
        if (!entry && budget === 0 && actual === 0) continue;
        rows.push({
            category,
            mode: fixed ? 'fixed' : 'derived',
            budget,
            actual,
            difference: budget - actual,
            pctUsed: budget > 0 ? actual / budget : null,
            over: actual > budget + 0.005
        });
    }
    rows.sort((a, b) => (b.actual - a.actual) || a.category.localeCompare(b.category));
    return rows;
}

// Budget vs. Actual table markup for Reports -> Variance.
export function renderBudgetVsActualHtml(app, year, month, rangeMonths) {
    const rows = computeCategoryBudgets(app, year, month, rangeMonths);
    const heading = `<h3 class="var-title bva-title">Budget vs. Actual</h3>
        <p class="var-subtitle">${rangeMonths > 1 ? `Budgets are multiplied across the ${rangeMonths}-month range. ` : ''}Set fixed budgets under Liabilities &rarr; Budget &rarr; Category Budgets; categories without one use their scheduled amounts.</p>`;
    if (rows.length === 0) {
        return `<div class="bva-section" id="budgetVsActual">${heading}<p class="bva-empty">No spending categories to budget yet.</p></div>`;
    }
    const body = rows.map(r => {
        const name = escapeHtml(r.category);
        const diffCls = r.over ? 'bva-neg' : 'bva-pos';
        const diffText = `${r.difference >= 0 ? '' : '-'}${formatCurrency(Math.abs(r.difference))}`;
        const pct = r.pctUsed === null ? '—' : `${Math.round(r.pctUsed * 100)}%`;
        return `<div class="bva-row${r.over ? ' bva-row--over' : ''}" data-category="${name}">
            <span class="bva-cell bva-cat" data-label="Category">${name} <span class="bva-mode bva-mode--${r.mode}">${r.mode === 'fixed' ? 'Fixed' : 'Derived'}</span></span>
            <span class="bva-cell bva-budget" data-label="Budget">${formatCurrency(r.budget)}</span>
            <span class="bva-cell bva-actual" data-label="Actual">${formatCurrency(r.actual)}</span>
            <span class="bva-cell bva-diff ${diffCls}" data-label="Difference">${diffText}${r.over ? ' over' : ''}</span>
            <span class="bva-cell bva-pct" data-label="% Used">${pct}</span>
        </div>`;
    }).join('');
    return `<div class="bva-section" id="budgetVsActual">${heading}
        <div class="bva-table">
            <div class="bva-header">
                <span>Category</span><span>Budget</span><span>Actual</span><span>Difference</span><span>% Used</span>
            </div>
            ${body}
        </div>
    </div>`;
}

// ── Mutations ──────────────────────────────────────────────────────────────

// Returns { ok: true } or { ok: false, error }.
export function setCategoryBudget(app, rawName, mode, rawAmount) {
    const name = normalizeText(rawName, 40);
    if (!name) return { ok: false, error: 'Enter a category name.' };
    if (FORBIDDEN_KEYS.includes(name)) return { ok: false, error: 'That category name is not allowed.' };
    if (mode !== 'fixed' && mode !== 'derived') return { ok: false, error: 'Choose Fixed or Derived.' };
    let amount = 0;
    if (mode === 'fixed') {
        const text = String(rawAmount ?? '').trim();
        const n = Number(text);
        if (text === '' || !Number.isFinite(n)) return { ok: false, error: 'Enter a budget amount (a number).' };
        if (n < 0) return { ok: false, error: 'Budget amount cannot be negative.' };
        if (n > BUDGET_CATEGORY_MAX_AMOUNT) return { ok: false, error: 'Budget amount is too large.' };
        amount = n;
    }
    const current = _configured(app);
    if (!Object.prototype.hasOwnProperty.call(current, name) && Object.keys(current).length >= BUDGET_CATEGORY_MAX_ENTRIES) {
        return { ok: false, error: `You can configure at most ${BUDGET_CATEGORY_MAX_ENTRIES} category budgets.` };
    }
    app.budgetCategories = { ...current, [name]: { mode, amount } };
    app.saveToStorage();
    return { ok: true, name };
}

export function resetCategoryBudget(app, name) {
    const current = { ..._configured(app) };
    if (!Object.prototype.hasOwnProperty.call(current, name)) return;
    delete current[name];
    app.budgetCategories = current;
    app.saveToStorage();
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

function _rowHtml(app, name, derived) {
    const entry = Object.prototype.hasOwnProperty.call(_configured(app), name) ? _configured(app)[name] : null;
    const fixed = _isFixed(entry);
    const n = escapeHtml(name);
    const derivedAmt = derived.get(name) || 0;
    return `<div class="cb-row" data-category="${n}">
        <span class="cb-name">${n}</span>
        <select class="cb-mode select-styled" aria-label="Budget mode for ${n}">
            <option value="derived"${fixed ? '' : ' selected'}>Derived</option>
            <option value="fixed"${fixed ? ' selected' : ''}>Fixed</option>
        </select>
        <input type="number" class="cb-amount" step="0.01" min="0" placeholder="0.00" aria-label="Monthly budget amount for ${n}" value="${fixed ? escapeHtml(String(entry.amount)) : ''}"${fixed ? '' : ' disabled'}>
        <span class="cb-derived">${fixed ? '' : `Derived: ${formatCurrency(derivedAmt)}/mo`}</span>
        <span class="cb-actions">
            <button type="button" class="btn btn-small btn-success cb-save" aria-label="Save budget for ${n}">Save</button>
            <button type="button" class="btn btn-small btn-secondary cb-reset" aria-label="Reset ${n} to derived"${entry ? '' : ' disabled'}>Reset</button>
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
    const rows = names.length
        ? names.map(n => _rowHtml(app, n, derived)).join('')
        : '<p class="cb-empty">No categories yet. Add a budget below or create expenses and recurring items first.</p>';
    container.innerHTML = `
        <h3 class="cb-title">Category Budgets</h3>
        <p class="cb-help">Set a fixed monthly budget per category, or leave it Derived to use this month's scheduled bills, expenses and recurring items. Budget vs. Actual appears on Reports &rarr; Variance.</p>
        <p class="cb-status" role="status">${escapeHtml(_statusMessage)}</p>
        <div class="cb-list">${rows}</div>
        <div class="cb-add">
            <div class="form-group">
                <label for="cbNewName">New category</label>
                <input type="text" id="cbNewName" maxlength="40" placeholder="e.g. Housing">
            </div>
            <div class="form-group">
                <label for="cbNewAmount">Monthly budget ($)</label>
                <input type="number" id="cbNewAmount" step="0.01" min="0" placeholder="0.00">
            </div>
            <button type="button" class="btn btn-success" id="cbAddBtn">Add Budget</button>
            <span class="cb-error" id="cbAddError" role="alert"></span>
        </div>`;
    _statusMessage = '';

    container.onchange = (e) => {
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
            _statusMessage = `Saved budget for ${res.name}.`;
            renderCategoryBudgetsPanel(app);
            return;
        }
        const row = e.target.closest('.cb-row');
        if (!row) return;
        const name = row.dataset.category;
        if (e.target.closest('.cb-save')) {
            const res = setCategoryBudget(app, name, row.querySelector('.cb-mode').value, row.querySelector('.cb-amount').value);
            if (!res.ok) { row.querySelector('.cb-error').textContent = res.error; return; }
            _statusMessage = `Saved budget for ${name}.`;
            renderCategoryBudgetsPanel(app);
        } else if (e.target.closest('.cb-reset')) {
            resetCategoryBudget(app, name);
            _statusMessage = `${name} reset to derived.`;
            renderCategoryBudgetsPanel(app);
        }
    };
}
