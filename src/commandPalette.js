// Command palette / quick-jump (Ctrl+K): keyboard-first navigation across all
// pages plus a handful of common actions.
import { escapeHtml } from './utils.js';

function buildCommands(app) {
    const nav = (page, label, icon) => ({
        label,
        hint: 'Go to page',
        icon,
        run: () => app.switchPage(page)
    });

    return [
        nav('health', 'Health', '🩺'),
        nav('accounts', 'Accounts', '🏦'),
        nav('income', 'Income', '💰'),
        nav('liabilities', 'Liabilities', '💳'),
        nav('recurring', 'Recurring', '🔁'),
        nav('savings', 'Savings', '💰'),
        nav('strategy', 'Plan', '🎯'),
        nav('reports', 'Reports', '📈'),
        nav('ledger', 'Ledger', '📒'),
        nav('reconcile', 'Reconcile', '🔄'),
        {
            label: 'Export backup as JSON',
            hint: 'Action',
            icon: '⬇️',
            run: () => app.exportAllJSON()
        },
        {
            label: 'Import backup from JSON',
            hint: 'Action',
            icon: '⬆️',
            run: () => document.getElementById('importJsonBtn')?.click()
        },
        {
            label: 'Toggle dark / light mode',
            hint: 'Action',
            icon: '🌙',
            run: () => document.getElementById('themeSwitcher')?.click()
        },
        {
            label: 'Calculate payment plan',
            hint: 'Action',
            icon: '🧮',
            run: () => {
                app.switchPage('strategy');
                app.calculatePaymentPlanFromInputs();
            }
        },
        {
            label: 'Settings',
            hint: 'Action',
            icon: '⚙️',
            run: () => document.getElementById('settingsBtn')?.click()
        }
    ];
}

export function initCommandPalette(app) {
    const overlay = document.getElementById('commandPaletteOverlay');
    const btn = document.getElementById('commandPaletteBtn');
    const input = document.getElementById('commandPaletteInput');
    const list = document.getElementById('commandPaletteList');
    if (!overlay || !input || !list) return;

    const commands = buildCommands(app);
    let filtered = commands;
    let activeIndex = 0;
    let lastFocused = null;

    function isOpen() {
        return !overlay.classList.contains('hidden');
    }

    function render() {
        list.innerHTML = filtered.length
            ? filtered.map((cmd, i) => `
                <li role="option" id="cmdpal-opt-${i}" class="cmdpal-item${i === activeIndex ? ' cmdpal-item--active' : ''}" data-index="${i}" aria-selected="${i === activeIndex}">
                    <span class="cmdpal-item-icon" aria-hidden="true">${cmd.icon}</span>
                    <span class="cmdpal-item-label">${escapeHtml(cmd.label)}</span>
                    <span class="cmdpal-item-hint">${escapeHtml(cmd.hint)}</span>
                </li>
            `).join('')
            : '<li class="cmdpal-empty">No matching commands</li>';
        input.setAttribute('aria-activedescendant', filtered.length ? `cmdpal-opt-${activeIndex}` : '');
    }

    function open() {
        lastFocused = document.activeElement;
        filtered = commands;
        activeIndex = 0;
        input.value = '';
        render();
        overlay.classList.remove('hidden');
        setTimeout(() => input.focus(), 0);
    }

    function close() {
        overlay.classList.add('hidden');
        if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus();
    }

    function runActive() {
        const cmd = filtered[activeIndex];
        if (!cmd) return;
        close();
        cmd.run();
    }

    if (btn) btn.addEventListener('click', open);

    input.addEventListener('input', () => {
        const q = input.value.trim().toLowerCase();
        filtered = q ? commands.filter(cmd => cmd.label.toLowerCase().includes(q)) : commands;
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
