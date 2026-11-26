// Command palette / quick-jump (Ctrl+K): keyboard-first navigation across all
// pages, a handful of common actions and, while typing, the records whose
// names match (#686). Commands are rebuilt on every open so they follow the
// current locale.
import {
    escapeHtml, formatCurrency, todayISO, isIncomeEnded, computeNetIncomeAmount,
    refreshFilterDisclosureCounts,
} from './utils.js';
import { t } from './i18n.js';
import { getCurrentAmount } from './amountSchedule.js';
import { foldForSearch, matchRecords } from './paletteSearch.js';

// How long a jumped-to card stays highlighted.
export const RECORD_HIGHLIGHT_MS = 2000;

function buildCommands(app) {
    const page = t('palette.hintPage');
    const action = t('palette.hintAction');
    const nav = (pageName, labelKey, icon) => ({
        label: t(labelKey),
        hint: page,
        icon,
        leavesSettings: true,
        run: () => app.switchPage(pageName)
    });

    return [
        nav('health', 'nav.health', '🩺'),
        nav('accounts', 'nav.accounts', '🏦'),
        nav('income', 'nav.income', '💰'),
        nav('people', 'nav.people', '👨‍👩‍👧‍👦'),
        nav('liabilities', 'nav.liabilities', '💳'),
        nav('recurring', 'nav.recurring', '🔁'),
        nav('savings', 'nav.savings', '💰'),
        {
            label: `${t('nav.savings')} — ${t('savings.tabHome')}`,
            hint: page,
            icon: '🏠',
            leavesSettings: true,
            run: () => {
                app.savingsSubTab = 'home';
                app.switchPage('savings');
            }
        },
        nav('strategy', 'nav.strategy', '🎯'),
        nav('reports', 'nav.reports', '📈'),
        {
            label: `${t('nav.reports')} — ${t('reports.tabCalendar')}`,
            hint: page,
            icon: '📅',
            leavesSettings: true,
            run: () => app.switchPage('reports', { subTab: 'calendar' })
        },
        nav('ledger', 'nav.ledger', '📒'),
        nav('reconcile', 'nav.reconcile', '🔄'),
        nav('retirement', 'nav.retirement', '🏛️'),
        nav('notifications', 'notify.title', '🔔'),
        {
            label: t('palette.exportJson'),
            hint: action,
            icon: '⬇️',
            run: () => app.exportAllJSON()
        },
        {
            label: t('palette.importJson'),
            hint: action,
            icon: '⬆️',
            run: () => {
                app.openSettings({ page: 'backup' });
                setTimeout(() => document.getElementById('importJsonBtn')?.focus(), 50);
            }
        },
        {
            label: t('palette.cycleTheme'),
            hint: action,
            icon: '🌓',
            run: () => {
                const select = document.getElementById('themeSwitcher');
                if (!select) return;
                const order = ['light', 'dark', 'high-contrast'];
                const currentIndex = order.indexOf(select.value);
                select.value = order[(currentIndex + 1) % order.length];
                select.dispatchEvent(new Event('change'));
            }
        },
        {
            label: t('palette.calcPlan'),
            hint: action,
            icon: '🧮',
            leavesSettings: true,
            run: () => {
                app.switchPage('strategy');
                app.calculatePaymentPlanFromInputs();
            }
        },
        {
            label: t('settings.title'),
            hint: action,
            icon: '⚙️',
            run: () => document.getElementById('settingsBtn')?.click()
        },
        {
            label: t('settings.aboutShortcuts'),
            hint: action,
            icon: '⌨️',
            run: () => app.openKeyboardShortcuts()
        },
        {
            label: t('palette.bonusAdvisor'),
            hint: action,
            icon: '🎯',
            keywords: t('palette.bonusKeywords'),
            leavesSettings: true,
            run: () => { app.switchPage('income'); app.showBonusAdvice(); }
        }
    ];
}

// ── Records (#686) ────────────────────────────────────────────────────────
// One entry per record a page shows by default: archived accounts, debts,
// templates and sinking funds, and ended incomes, are left out (they sit
// behind a "show" toggle). `figure` is the amount the record's card shows.

const RECORD_ICONS = {
    account: '🏦', debt: '💳', income: '💰', recurring: '🔁', emergency: '🛟', sinking: '🎯', person: '👤',
};

// Where each type lives and how to find its card: the Edit button carries the id.
export const RECORD_TARGETS = {
    account: { page: 'accounts', edit: id => `[data-account-action="edit"][data-account-id="${id}"]`, card: '.acct-card' },
    debt: { page: 'liabilities', edit: id => `[data-debt-action="edit"][data-debt-id="${id}"]`, card: '.debt-card', reveal: '_revealDebtId' },
    income: { page: 'income', edit: id => `[data-income-action="edit"][data-income-id="${id}"]`, card: '.income-card' },
    recurring: { page: 'recurring', edit: id => `[data-recurring-action="edit"][data-recurring-id="${id}"]`, card: '.recurring-card', reveal: '_revealRecurringId' },
    emergency: { page: 'savings', sub: 'emergency', edit: id => `[data-emergency-action="edit"][data-emergency-id="${id}"]`, card: '.emergency-card' },
    sinking: { page: 'savings', sub: 'sinking', edit: id => `[data-sinking-action="edit"][data-sinking-id="${id}"]`, card: '.sinking-card' },
    person: { page: 'people', edit: id => `[data-person-action="edit"][data-person-id="${id}"]`, card: '.income-card' },
};

export function buildRecordEntries(app) {
    const today = todayISO();
    const entries = [];
    const add = (type, rec, name, figure) => {
        if (rec?.id == null) return;
        entries.push({ type, id: rec.id, name, figure: Number.isFinite(figure) ? figure : null });
    };
    for (const a of app.accounts || []) if (!a.archived) add('account', a, a.name, Number(a.startingBalance));
    for (const d of app.debts || []) {
        if (d.archived) continue;
        add('debt', d, d.name, Number(d.debtType === 'fixedAmount' ? d.fixedAmount : d.accountBalance));
    }
    for (const inc of app.incomes || []) {
        if (!isIncomeEnded(inc, today)) add('income', inc, inc.name, computeNetIncomeAmount(inc, today));
    }
    for (const tmpl of app.recurringTemplates || []) {
        if (!tmpl.archived) add('recurring', tmpl, tmpl.name, getCurrentAmount(tmpl, today));
    }
    for (const f of app.emergencyFunds || []) {
        const account = (app.accounts || []).find(a => a.id === f.accountId);
        if (account) add('emergency', f, account.name, Number(f.currentAmount));
    }
    for (const f of app.sinkingFunds || []) if (!f.archived) add('sinking', f, f.name, Number(f.currentAmount));
    for (const p of app.persons || []) add('person', p, p.name, null);
    return entries;
}

function recordToCommand(app, entry) {
    const type = t(`palette.type.${entry.type}`);
    return {
        label: entry.name,
        hint: entry.figure === null ? type : `${type} · ${formatCurrency(entry.figure)}`,
        icon: RECORD_ICONS[entry.type],
        group: entry.type,
        run: () => jumpToRecord(app, entry),
    };
}

function nextFrame() {
    return new Promise(resolve => requestAnimationFrame(() => resolve()));
}

async function waitForElement(selector, frames = 30) {
    for (let i = 0; i < frames; i++) {
        const el = document.querySelector(selector);
        if (el) return el;
        await nextFrame();
    }
    return null;
}

// Debt and Recurring filters can hide the record: put them back to "all".
function clearListFilters(app, type) {
    const ids = type === 'debt'
        ? ['categoryFilter', 'debtAccountFilter', 'debtInterestFilter', 'debtProgressFilter', 'debtUtilizationFilter']
        : ['recurringCategoryFilter', 'recurringAccountFilter', 'recurringMonthFilter'];
    for (const id of ids) {
        const el = document.getElementById(id);
        if (el) el.value = '';
    }
    if (type === 'debt') {
        app.renderDebtsList();
    } else {
        app._recurringOverdueOnly = false;
        app.renderRecurringPage();
    }
    refreshFilterDisclosureCounts();
}

// Opens the record's page (and sub-tab, and list page), scrolls its card into
// view, highlights it briefly and focuses its Edit button. Resolves to the
// card, or null when the record is not on screen (deleted meanwhile).
export async function jumpToRecord(app, entry) {
    const target = RECORD_TARGETS[entry?.type];
    if (!target) return null;
    const id = String(entry.id);
    if (target.reveal) app[target.reveal] = entry.id;
    try {
        if (target.sub) app.savingsSubTab = target.sub;
        app.switchPage(target.page);
        let edit = await waitForElement(target.edit(id));
        if (!edit && target.reveal) {
            clearListFilters(app, entry.type);
            edit = await waitForElement(target.edit(id), 10);
        }
        if (!edit) return null;
        const card = edit.closest(target.card) || edit.parentElement;
        card.scrollIntoView({ block: 'center', behavior: 'auto' });
        card.classList.add('cmdpal-highlight');
        setTimeout(() => card.classList.remove('cmdpal-highlight'), RECORD_HIGHLIGHT_MS);
        edit.focus({ preventScroll: true });
        return card;
    } finally {
        if (target.reveal) app[target.reveal] = null;
    }
}

// Commands whose label or keywords contain the query (accent- and
// case-insensitive), then the matching records grouped by type.
export function filterPaletteItems(app, commands, query) {
    const q = foldForSearch(query);
    if (!q) return commands;
    const matched = commands.filter(cmd =>
        foldForSearch(cmd.label).includes(q) ||
        (cmd.keywords && foldForSearch(cmd.keywords).includes(q))
    );
    const records = matchRecords(buildRecordEntries(app), query).map(e => recordToCommand(app, e));
    return [...matched, ...records];
}

export function initCommandPalette(app) {
    const overlay = document.getElementById('commandPaletteOverlay');
    const btn = document.getElementById('commandPaletteBtn');
    const input = document.getElementById('commandPaletteInput');
    const list = document.getElementById('commandPaletteList');
    if (!overlay || !input || !list) return;

    let commands = [];
    let filtered = commands;
    let activeIndex = 0;
    let lastFocused = null;

    function isOpen() {
        return !overlay.classList.contains('hidden');
    }

    function render() {
        let lastGroup = null;
        list.innerHTML = filtered.length
            ? filtered.map((cmd, i) => {
                // A visual heading before each record type; options carry the
                // type in their hint, so the heading is hidden from the listbox.
                const heading = cmd.group && cmd.group !== lastGroup
                    ? `<li class="cmdpal-group" role="presentation" aria-hidden="true">${escapeHtml(t(`palette.group.${cmd.group}`))}</li>`
                    : '';
                lastGroup = cmd.group || null;
                return `${heading}
                <li role="option" id="cmdpal-opt-${i}" class="cmdpal-item${cmd.group ? ' cmdpal-item--record' : ''}${i === activeIndex ? ' cmdpal-item--active' : ''}" data-index="${i}"${cmd.group ? ` data-record-type="${cmd.group}"` : ''} aria-selected="${i === activeIndex}">
                    <span class="cmdpal-item-icon" aria-hidden="true">${cmd.icon}</span>
                    <span class="cmdpal-item-label">${escapeHtml(cmd.label)}</span>
                    <span class="cmdpal-item-hint">${escapeHtml(cmd.hint)}</span>
                </li>`;
            }).join('')
            : `<li class="cmdpal-empty">${escapeHtml(t('palette.empty'))}</li>`;
        input.setAttribute('aria-activedescendant', filtered.length ? `cmdpal-opt-${activeIndex}` : '');
        list.querySelector('.cmdpal-item--active')?.scrollIntoView({ block: 'nearest' });
    }

    function open() {
        lastFocused = document.activeElement;
        commands = buildCommands(app);
        filtered = commands;
        activeIndex = 0;
        input.value = '';
        render();
        overlay.classList.remove('hidden');
        setTimeout(() => input.focus(), 0);
    }

    function close({ restoreFocus = true } = {}) {
        overlay.classList.add('hidden');
        if (restoreFocus && lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus();
    }

    function runActive() {
        const cmd = filtered[activeIndex];
        if (!cmd) return;
        // A record jump moves focus to the record's Edit button itself.
        close({ restoreFocus: !cmd.group });
        // A page or record jump leaves Settings behind (#731): close it first,
        // without stepping history (the router replaces its entry with the page).
        if ((cmd.leavesSettings || cmd.group) && document.getElementById('settingsModal')?.classList.contains('flex-visible')) {
            app.closeSettings({ fromHistory: true });
        }
        cmd.run();
    }

    if (btn) btn.addEventListener('click', open);

    input.addEventListener('input', () => {
        filtered = filterPaletteItems(app, commands, input.value);
        activeIndex = 0;
        render();
    });

    input.addEventListener('keydown', e => {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (filtered.length) activeIndex = (activeIndex + 1) % filtered.length;
            render();
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (filtered.length) activeIndex = (activeIndex - 1 + filtered.length) % filtered.length;
            render();
        } else if (e.key === 'Enter') {
            e.preventDefault();
            runActive();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            close();
        }
    });

    list.addEventListener('click', e => {
        const item = e.target.closest('.cmdpal-item');
        if (!item) return;
        activeIndex = parseInt(item.dataset.index, 10) || 0;
        runActive();
    });

    overlay.addEventListener('click', e => {
        if (e.target === overlay) close();
    });

    document.addEventListener('keydown', e => {
        const isToggleKey = (e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey);
        if (isToggleKey) {
            e.preventDefault();
            if (isOpen()) close(); else open();
        } else if (e.key === 'Escape' && isOpen()) {
            close();
        }
    });
}
