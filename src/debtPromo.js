// Promotional APR UI for debts (#681): reads the add-form and inline-edit
// promo inputs, renders them for the inline editor, and builds the card's
// promo line and payoff hint. The math lives in the pure promoApr.js.

import { escapeHtml, formatCurrency, formatMonthYear, sanitizeFiniteNumber, sanitizeDateISO, todayISO } from './utils.js';
import { t } from './i18n.js';
import { isPromoActive, promoPayoffHint } from './promoApr.js';

// Reads the four promo inputs. Returns { fields } or { error } (a locale key).
// Both empty clears the promo; only one of rate and end date is an error.
export function readPromoInputs({ rateEl, endEl, deferredEl, accruedEl }) {
    const rawRate = String(rateEl?.value ?? '').trim();
    const rawEnd = String(endEl?.value ?? '').trim();
    if (rawRate === '' && rawEnd === '') {
        return { fields: { promoRate: null, promoEndDate: null, deferredInterest: false, deferredInterestAccrued: 0 } };
    }
    const rate = Number(rawRate);
    if (rawRate === '' || !Number.isFinite(rate) || rate < 0 || rate > 100) return { error: 'debts.errPromoRate' };
    const promoEndDate = sanitizeDateISO(rawEnd);
    if (!promoEndDate) return { error: 'debts.errPromoEnd' };
    const deferredInterest = Boolean(deferredEl?.checked);
    const rawAccrued = String(accruedEl?.value ?? '').trim();
    const accrued = rawAccrued === '' ? 0 : Number(rawAccrued);
    if (deferredInterest && (!Number.isFinite(accrued) || accrued < 0)) return { error: 'debts.errDeferredAccrued' };
    return {
        fields: {
            promoRate: rate,
            promoEndDate,
            deferredInterest,
            deferredInterestAccrued: deferredInterest ? sanitizeFiniteNumber(accrued, 0, { min: 0, max: 1e9 }) : 0,
        },
    };
}

// The inline editor's promo inputs for one debt (ids inline-promo-*-<id>).
export function renderInlinePromoFields(debt) {
    const id = debt.id;
    const rate = debt.promoRate ?? '';
    const end = debt.promoEndDate || '';
    const accrued = debt.deferredInterest ? (debt.deferredInterestAccrued || 0) : '';
    return `
        <div class="debt-detail"><label for="inline-promo-rate-${id}"><strong>${escapeHtml(t('debts.promoRateLabel'))}</strong></label> <input id="inline-promo-rate-${id}" type="number" step="0.01" min="0" max="100" value="${escapeHtml(String(rate))}"></div>
        <div class="debt-detail"><label for="inline-promo-end-${id}"><strong>${escapeHtml(t('debts.promoEndLabel'))}</strong></label> <input id="inline-promo-end-${id}" type="date" value="${escapeHtml(end)}"></div>
        <div class="debt-detail"><label for="inline-deferred-${id}"><input id="inline-deferred-${id}" type="checkbox"${debt.deferredInterest ? ' checked' : ''}> ${escapeHtml(t('debts.deferredShort'))}</label></div>
        <div class="debt-detail"><label for="inline-deferred-accrued-${id}"><strong>${escapeHtml(t('debts.deferredAccruedShort'))}</strong></label> <input id="inline-deferred-accrued-${id}" type="number" step="0.01" min="0" value="${escapeHtml(String(accrued))}"></div>`;
}

export function inlinePromoElements(id) {
    return {
        rateEl: document.getElementById(`inline-promo-rate-${id}`),
        endEl: document.getElementById(`inline-promo-end-${id}`),
        deferredEl: document.getElementById(`inline-deferred-${id}`),
        accruedEl: document.getElementById(`inline-deferred-accrued-${id}`),
    };
}

export function formPromoElements() {
    return {
        rateEl: document.getElementById('debtPromoRate'),
        endEl: document.getElementById('debtPromoEndDate'),
        deferredEl: document.getElementById('debtDeferredInterest'),
        accruedEl: document.getElementById('debtDeferredAccrued'),
    };
}

function rateText(rate) {
    return `${Number(rate).toFixed(2).replace(/\.00$/, '')}%`;
}

function endDateLabel(iso) {
    const [y, m] = iso.split('-').map(Number);
    return formatMonthYear(new Date(y, m - 1, 1));
}

// The card's promo notice while the promo is active: "0% until Jun 2027
// (then 24.99%)", the deferred-interest warning, and the payment that clears
// the balance before it ends. '' once the promo is over (or there is none).
export function renderPromoCardHtml(debt, iso = todayISO()) {
    if (!debt || debt.debtType === 'fixedAmount' || !isPromoActive(debt, iso)) return '';
    const line = t('debts.promoUntil', {
        rate: rateText(debt.promoRate),
        date: endDateLabel(debt.promoEndDate),
        regular: rateText(debt.interestRate || 0),
    });
    const hint = promoPayoffHint(debt, iso);
    const hintText = hint && hint.payment > 0
        ? t(debt.deferredInterest ? 'debts.promoPayoffDeferred' : 'debts.promoPayoff', { amount: formatCurrency(hint.payment) })
        : '';
    return `<div class="debt-promo-note${debt.deferredInterest ? ' debt-promo-note--deferred' : ''}">
        <span class="debt-promo-line">${escapeHtml(line)}</span>
        ${debt.deferredInterest ? `<span class="debt-promo-deferred">${escapeHtml(t('debts.promoDeferredBadge'))}</span>` : ''}
        ${hintText ? `<span class="debt-promo-hint">${escapeHtml(hintText)}</span>` : ''}
    </div>`;
}
