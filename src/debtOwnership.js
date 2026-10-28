// #272: Debt ownership split — pure share math plus the "Ownership" form control
// shown in the Add Debt form and the inline debt editor when 2+ people are linked.
//
// Data model: debt.ownershipSplit is null/absent (= equal share among
// debt.personIds, what every pre-existing debt gets) or { [personId]: fraction }
// summing to 1.0 (sanitized by sanitizeOwnershipSplit in sanitizers.js).
// Income is deliberately NOT split: each income has at most one personId.
import { escapeHtml } from './utils.js';
import { sanitizeOwnershipSplit } from './sanitizers.js';

// ---- Pure share math ----------------------------------------------------

/** Fraction (0-1) of `debt` attributable to `personId`; 0 when not linked. */
export function getDebtShare(debt, personId) {
    const ids = (debt && debt.personIds) || [];
    if (!ids.includes(personId)) return 0;
    const split = debt.ownershipSplit;
    if (ids.length > 1 && split && typeof split === 'object') {
        const f = Number(split[personId]);
        return Number.isFinite(f) && f >= 0 ? f : 0;
    }
    return 1 / ids.length;
}

/** True when the debt has 2+ people and an explicit (non-equal-share) split. */
export function hasCustomSplit(debt) {
    return !!(debt && (debt.personIds || []).length > 1
        && debt.ownershipSplit && typeof debt.ownershipSplit === 'object');
}

/**
 * Returns a copy of `debt` with `personId` unlinked. With a replacement person
 * the removed share moves to them (added to their share if already linked);
 * without one the remaining shares are renormalized proportionally. Fewer
 * than 2 remaining people ⇒ no split (100% to the sole owner).
 */
export function removePersonFromDebt(debt, personId, replacementId) {
    const oldIds = debt.personIds || [];
    const newIds = oldIds.filter(id => id !== personId);
    if (replacementId != null && !newIds.includes(replacementId)) newIds.push(replacementId);
    let split = null;
    if (hasCustomSplit(debt)) {
        const removed = getDebtShare(debt, personId);
        const raw = {};
        for (const id of newIds) raw[id] = oldIds.includes(id) ? getDebtShare(debt, id) : 0;
        if (replacementId != null) raw[replacementId] = (raw[replacementId] || 0) + removed;
        const sum = Object.values(raw).reduce((a, b) => a + b, 0);
        if (sum > 0) for (const id of Object.keys(raw)) raw[id] /= sum;
        split = raw;
    }
    return { ...debt, personIds: newIds, ownershipSplit: sanitizeOwnershipSplit(split, newIds) };
}

const round2 = n => Math.round(n * 100) / 100;

/** Percent strings like "60" / "33.33" without trailing zeros. */
function fmtPct(fraction) {
    return String(round2(fraction * 100));
}

/** Equal percentages for n people that sum to exactly 100 (residue on the last). */
export function equalPercents(n) {
    if (n <= 0) return [];
    const base = round2(100 / n);
    const out = Array(n).fill(base);
    out[n - 1] = round2(100 - base * (n - 1));
    return out;
}

/**
 * Auto-balance: set `changedId` to `newPct` (clamped 0-100) and share the
 * remainder equally among the others, so the total is always exactly 100 and
 * nothing goes negative. `pcts` is { [id]: percent }; returns a new map.
 */
export function autoBalancePercents(ids, changedId, newPct) {
    const v = Number.isFinite(newPct) ? Math.min(100, Math.max(0, round2(newPct))) : 0;
    const others = ids.filter(id => id !== changedId);
    const out = {};
    out[changedId] = v;
    if (others.length === 0) { out[changedId] = 100; return out; }
    const remainder = round2(100 - v);
    const each = round2(remainder / others.length);
    others.forEach((id, i) => {
        out[id] = i === others.length - 1 ? round2(remainder - each * (others.length - 1)) : each;
    });
    return out;
}

// ---- Form control -------------------------------------------------------

function selectedPersonIds(selectEl) {
    return Array.from(selectEl.selectedOptions || []).map(o => parseInt(o.value, 10)).filter(Number.isFinite);
}

function controlInnerHtml(rootId, persons, ids, split) {
    const custom = !!split;
    const pcts = {};
    if (custom) ids.forEach(id => { pcts[id] = fmtPct(Number(split[id]) || 0); });
    else equalPercents(ids.length).forEach((p, i) => { pcts[ids[i]] = String(p); });
    const rows = ids.map(id => {
        const p = (persons || []).find(x => x.id === id);
        const name = p ? p.name : 'Unknown person';
        return `<div class="ownership-row">
                <label for="${rootId}-pct-${id}" class="ownership-row-label">${escapeHtml(name)}</label>
                <input type="number" id="${rootId}-pct-${id}" class="ownership-pct-input" min="0" max="100" step="0.01" value="${pcts[id]}" data-ownership-pct data-person-id="${id}" aria-label="Ownership percent for ${escapeHtml(name)}">
                <span aria-hidden="true">%</span>
            </div>`;
    }).join('');
    return `<fieldset class="ownership-fieldset">
            <legend>Ownership</legend>
            <label class="ownership-mode"><input type="radio" name="${rootId}-mode" value="equal" data-ownership-mode${custom ? '' : ' checked'}> Shared equally</label>
            <label class="ownership-mode"><input type="radio" name="${rootId}-mode" value="custom" data-ownership-mode${custom ? ' checked' : ''}> Custom split</label>
            <div class="ownership-custom${custom ? '' : ' hidden'}" data-ownership-custom>
                ${rows}
                <div class="ownership-total" role="status" aria-live="polite">Total: <span data-ownership-total>100</span>%</div>
            </div>
        </fieldset>`;
}

/**
 * (Re)renders the Ownership control into `root` for the people currently
 * selected in `selectEl`. Hidden entirely with fewer than 2 people.
 * `split` pre-fills a custom split (edit mode); otherwise keeps the user's
 * current choice when the same people are still selected.
 */
export function renderOwnershipControl(app, root, selectEl, split) {
    if (!root || !selectEl) return;
    const ids = selectedPersonIds(selectEl);
    if (ids.length < 2) {
        root.innerHTML = '';
        root.classList.add('hidden');
        root.removeAttribute('data-ownership-ids');
        return;
    }
    const key = ids.join(',');
    if (split === undefined && root.getAttribute('data-ownership-ids') === key) return; // same people: keep state
    const rootId = root.id || 'ownership';
    const initial = split && typeof split === 'object' ? split : null;
    root.innerHTML = controlInnerHtml(rootId, app.persons, ids, initial);
    root.setAttribute('data-ownership-ids', key);
    root.classList.remove('hidden');
}

/** Reads the control: null (equal share / hidden) or { [personId]: fraction }. */
export function readOwnershipSplit(root) {
    if (!root || root.classList.contains('hidden')) return null;
    const mode = root.querySelector('[data-ownership-mode]:checked');
    if (!mode || mode.value !== 'custom') return null;
    const out = {};
    for (const input of root.querySelectorAll('[data-ownership-pct]')) {
        const id = parseInt(input.getAttribute('data-person-id'), 10);
        const pct = parseFloat(input.value);
        if (Number.isFinite(id)) out[id] = Number.isFinite(pct) && pct > 0 ? pct / 100 : 0;
    }
    return out;
}

function onPctInput(input) {
    const root = input.closest('[data-ownership-ids]');
    if (!root) return;
    const inputs = Array.from(root.querySelectorAll('[data-ownership-pct]'));
    const ids = inputs.map(i => parseInt(i.getAttribute('data-person-id'), 10));
    const changedId = parseInt(input.getAttribute('data-person-id'), 10);
    const raw = parseFloat(input.value);
    if (!Number.isFinite(raw)) return; // mid-typing (empty); leave others alone
    const next = autoBalancePercents(ids, changedId, raw);
    for (const i of inputs) {
        const id = parseInt(i.getAttribute('data-person-id'), 10);
        if (id === changedId) continue; // never rewrite the field being typed in
        i.value = String(next[id]);
    }
    const totalEl = root.querySelector('[data-ownership-total]');
    if (totalEl) totalEl.textContent = '100';
}

let _listenersInstalled = false;

/** Installs the delegated listeners once (idempotent). `getApp` resolves lazily. */
export function installOwnershipListeners(getApp) {
    if (_listenersInstalled) return;
    _listenersInstalled = true;
    document.addEventListener('change', e => {
        const t = e.target;
        if (!(t instanceof Element)) return;
        if (t.matches('select[data-ownership-for]')) {
            const root = document.getElementById(t.getAttribute('data-ownership-for'));
            renderOwnershipControl(getApp(), root, t);
        } else if (t.matches('[data-ownership-mode]')) {
            const root = t.closest('[data-ownership-ids]');
            const custom = root && root.querySelector('[data-ownership-custom]');
            if (custom) custom.classList.toggle('hidden', t.value !== 'custom');
        } else if (t.matches('[data-ownership-pct]')) {
            onPctInput(t);
        }
    });
    document.addEventListener('input', e => {
        const t = e.target;
        if (t instanceof Element && t.matches('[data-ownership-pct]')) onPctInput(t);
    });
    document.addEventListener('reset', e => {
        const form = e.target;
        if (!(form instanceof Element) || form.id !== 'debtForm') return;
        // reset() restores defaults after this event, so re-evaluate next tick.
        setTimeout(() => {
            const sel = document.getElementById('debtPersons');
            const root = document.getElementById('debtOwnership');
            if (sel && root) { root.removeAttribute('data-ownership-ids'); renderOwnershipControl(getApp(), root, sel); }
        }, 0);
    });
}

/** "Alex 60% · Sam 40%" as an HTML string (names escaped), or '' when equal/none. */
export function buildOwnershipSplitHtml(debt, persons) {
    if (!hasCustomSplit(debt)) return '';
    const parts = debt.personIds.map(id => {
        const p = (persons || []).find(x => x.id === id);
        if (!p) return null;
        return `${escapeHtml(p.name)} ${fmtPct(getDebtShare(debt, id))}%`;
    }).filter(Boolean);
    return parts.length ? parts.join(' &middot; ') : '';
}
