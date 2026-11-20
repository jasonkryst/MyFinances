// Settings navigation shell (7.20.0): a grouped list of rows that open pages.
// Wide screens (>= 768px) show the list and the page side by side; narrow
// screens drill in (list first, a row opens its page, Back returns).
// DOM-only module; the values loading and saving live in setupWizard.js.
import { t } from './i18n.js';

export const SETTINGS_PAGES = ['appearance', 'language', 'notifications', 'backup', 'advanced', 'security', 'about'];
const DEFAULT_PAGE = 'appearance';
const WIDE_QUERY = '(min-width: 768px)';

let modalEl = null;
let activePage = DEFAULT_PAGE;
let drilledIn = false; // narrow only: a page (not the list) is showing
let initialized = false;

export function isSettingsNarrow() {
    return !window.matchMedia(WIDE_QUERY).matches;
}

export function getActiveSettingsPage() {
    return activePage;
}

function rowFor(page) {
    return modalEl ? modalEl.querySelector(`.settings-row[data-settings-page="${page}"]`) : null;
}

// Applies activePage/drilledIn to the DOM (no focus changes).
function apply() {
    if (!modalEl) return;
    const narrow = isSettingsNarrow();
    modalEl.classList.toggle('settings-shell--page', narrow && drilledIn);
    modalEl.querySelectorAll('.settings-page').forEach(p => {
        p.classList.toggle('settings-page--active', p.id === `settingsPage-${activePage}`);
    });
    modalEl.querySelectorAll('.settings-row[data-settings-page]').forEach(r => {
        if (r.getAttribute('data-settings-page') === activePage && !narrow) r.setAttribute('aria-current', 'page');
        else r.removeAttribute('aria-current');
    });
}

export function showSettingsPage(page, { focus = true } = {}) {
    activePage = SETTINGS_PAGES.includes(page) ? page : DEFAULT_PAGE;
    drilledIn = true;
    apply();
    if (focus) {
        const heading = document.getElementById(`settingsPageTitle-${activePage}`);
        if (heading) heading.focus();
    }
}

// Narrow only: show the list with the previously open page's row focused.
export function showSettingsList() {
    drilledIn = false;
    apply();
    const row = rowFor(activePage);
    if (row) row.focus();
}

export function showSettingsListQuiet() {
    drilledIn = false;
    apply();
}

// Escape: on a narrow sub-page go back (true); otherwise let the caller close (false).
export function handleSettingsEscape() {
    if (isSettingsNarrow() && drilledIn) {
        showSettingsList();
        return true;
    }
    return false;
}

function focusableVisible() {
    return Array.from(modalEl.querySelectorAll('button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])'))
        .filter(el => !el.disabled && el.offsetParent !== null && el.getAttribute('tabindex') !== '-1');
}

function onKeydown(event) {
    if (event.key === 'Tab') {
        const items = focusableVisible();
        if (!items.length) { event.preventDefault(); modalEl.focus(); return; }
        const first = items[0];
        const last = items[items.length - 1];
        const current = document.activeElement;
        if (event.shiftKey && (current === first || !modalEl.contains(current) || current === modalEl)) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && (current === last || !modalEl.contains(current))) {
            event.preventDefault();
            first.focus();
        }
        return;
    }
    const row = event.target.closest ? event.target.closest('.settings-row') : null;
    if (!row) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        const rows = Array.from(modalEl.querySelectorAll('.settings-row'));
        const i = rows.indexOf(row);
        const next = rows[i + (event.key === 'ArrowDown' ? 1 : -1)];
        if (next) { event.preventDefault(); next.focus(); }
    }
}

export function initSettingsNav(modal) {
    if (initialized || !modal) return;
    initialized = true;
    modalEl = modal;
    modal.querySelectorAll('.settings-row[data-settings-page]').forEach(row => {
        row.addEventListener('click', () => showSettingsPage(row.getAttribute('data-settings-page')));
    });
    const back = document.getElementById('settingsBackBtn');
    if (back) back.addEventListener('click', () => showSettingsList());
    modal.addEventListener('keydown', onKeydown);
    // Review focus 2: crossing the breakpoint keeps the current page.
    const mq = window.matchMedia(WIDE_QUERY);
    const onChange = () => { if (!modal.classList.contains('hidden')) apply(); };
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else if (mq.addListener) mq.addListener(onChange);
}

// Row values and their accessible names (the name includes the value).
export function refreshSettingsRowValues() {
    if (!modalEl) return;
    const theme = document.getElementById('themeSwitcher');
    const locale = document.getElementById('settingLocale');
    const currency = document.getElementById('settingCurrency');
    const values = {};
    if (theme && theme.selectedOptions[0]) values.appearance = theme.selectedOptions[0].textContent.trim();
    if (locale && currency && locale.selectedOptions[0]) {
        values.language = `${locale.selectedOptions[0].textContent.trim()} · ${currency.value}`;
    }
    Object.keys(values).forEach(page => {
        const valueEl = document.getElementById(`settingsRowValue-${page}`);
        if (valueEl) valueEl.textContent = values[page];
    });
    modalEl.querySelectorAll('.settings-row[data-settings-page]').forEach(row => {
        const page = row.getAttribute('data-settings-page');
        const labelEl = row.querySelector('.settings-row-label');
        if (!labelEl) return;
        if (values[page]) {
            row.setAttribute('aria-label', t('settings.rowWithValue', { label: labelEl.textContent.trim(), value: values[page] }));
        } else {
            row.removeAttribute('aria-label');
        }
    });
}
