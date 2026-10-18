// Keyboard shortcuts help panel (issue #283). KEYBOARD_SHORTCUTS is the single
// source of truth for the panel's content — when wiring a new keydown handler
// (see commandPalette.js, the modal onkeydown handlers, reportsCalendar.js),
// add or update its entry here so the panel stays accurate.
//
// Each item's `keys` is a list of alternative combos; each combo is a list of
// keys pressed together (rendered as <kbd>Ctrl</kbd> + <kbd>K</kbd>).

export const KEYBOARD_SHORTCUTS = [
    {
        group: 'Global',
        items: [
            { keys: [['Ctrl', 'K'], ['⌘', 'K']], description: 'Open or close the command palette' },
            { keys: [['Esc']], description: 'Close the open dialog, menu, or command palette' }
        ]
    },
    {
        group: 'Command palette',
        items: [
            { keys: [['↑'], ['↓']], description: 'Move between commands' },
            { keys: [['Enter']], description: 'Run the selected command' }
        ]
    },
    {
        group: 'Dialogs',
        items: [
            { keys: [['Tab'], ['Shift', 'Tab']], description: 'Move between controls — focus stays inside the open dialog' },
            { keys: [['Enter']], description: 'Confirm form dialogs such as Reconcile, Amount Override, and Retirement Snapshot' }
        ]
    },
    {
        group: 'Reports calendar',
        items: [
            { keys: [['Enter'], ['Space']], description: 'Open details for the focused day' }
        ]
    }
];

function renderCombo(combo) {
    const frag = document.createDocumentFragment();
    combo.forEach((key, i) => {
        if (i > 0) frag.append(' + ');
        const kbd = document.createElement('kbd');
        kbd.textContent = key;
        frag.append(kbd);
    });
    return frag;
}

// Built with textContent/createElement only — no innerHTML, no inline styles (CSP).
export function renderKeyboardShortcutsList(container) {
    container.replaceChildren();
    for (const group of KEYBOARD_SHORTCUTS) {
        const heading = document.createElement('h4');
        heading.className = 'kbd-group-title';
        heading.textContent = group.group;

        const table = document.createElement('table');
        table.className = 'kbd-table';
        const tbody = document.createElement('tbody');
        for (const item of group.items) {
            const row = document.createElement('tr');
            row.className = 'kbd-row';
            const keysCell = document.createElement('td');
            keysCell.className = 'kbd-keys';
            item.keys.forEach((combo, i) => {
                if (i > 0) {
                    const or = document.createElement('span');
                    or.className = 'kbd-or';
                    or.textContent = ' or ';
                    keysCell.append(or);
                }
                keysCell.append(renderCombo(combo));
            });
            const descCell = document.createElement('td');
            descCell.className = 'kbd-desc';
            descCell.textContent = item.description;
            row.append(keysCell, descCell);
            tbody.append(row);
        }
        table.append(tbody);
        container.append(heading, table);
    }
}

let activeKeydown = null;

export function openKeyboardShortcutsModal(_app) {
    const modal = document.getElementById('keyboardShortcutsModal');
    const list = document.getElementById('keyboardShortcutsList');
    const closeBtn = document.getElementById('keyboardShortcutsCloseBtn');
    const doneBtn = document.getElementById('keyboardShortcutsDoneBtn');
    if (!modal || !list || !closeBtn || !doneBtn) return;

    renderKeyboardShortcutsList(list);

    // Document-level (not modal.onkeydown) so Escape works even before focus has
    // moved into the panel — same fix as the calendar feed modal (6.15.1).
    const onKeydown = (event) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            close();
            return;
        }
        if (event.key === 'Tab') {
            const focusable = modal.querySelectorAll('button, [tabindex]:not([tabindex="-1"])');
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (!first || !last) return;
            if (!modal.contains(document.activeElement)) {
                event.preventDefault();
                first.focus();
            } else if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        }
    };

    const lastFocused = document.activeElement;
    const close = () => {
        modal.classList.add('hidden'); modal.classList.remove('flex-visible');
        document.removeEventListener('keydown', onKeydown);
        if (activeKeydown === onKeydown) activeKeydown = null;
        if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus();
    };

    closeBtn.onclick = close;
    doneBtn.onclick = close;
    modal.onclick = (event) => {
        if (event.target === modal) close();
    };
    // Re-opening while already open must not stack a second listener.
    if (activeKeydown) document.removeEventListener('keydown', activeKeydown);
    activeKeydown = onKeydown;
    document.addEventListener('keydown', onKeydown);

    modal.classList.add('flex-visible'); modal.classList.remove('hidden');
    setTimeout(() => doneBtn.focus(), 30);
}
