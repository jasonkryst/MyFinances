// Backup & Restore modal: consolidates the old separate Export/Import
// toolbar buttons into a two-tab modal, following the same show/hide-via-
// classList pattern as settingsModal (see setupWizard.js). This module
// owns all of #dataTransferModal's internal wiring, including the
// relocated #exportJsonBtn/#importJsonBtn/#importJsonInput.

export function initDataTransferModal(app) {
    const modal = document.getElementById('dataTransferModal');
    const openBtn = document.getElementById('dataTransferBtn');
    const closeBtn = document.getElementById('dataTransferModalCloseBtn');
    if (!modal || !openBtn || !closeBtn) return;

    let lastFocused = null;

    const close = () => {
        modal.classList.add('hidden');
        modal.classList.remove('flex-visible');
        modal.onkeydown = null;
        const banner = document.getElementById('importResultBanner');
        if (banner) { banner.textContent = ''; banner.className = 'target-result hidden'; }
        const choice = document.getElementById('importModeChoice');
        if (choice) choice.classList.add('hidden');
        if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus();
    };

    const open = () => {
        lastFocused = document.activeElement;
        modal.classList.add('flex-visible');
        modal.classList.remove('hidden');
        modal.onkeydown = (event) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                close();
            }
        };
        const exportBtn = document.getElementById('exportJsonBtn');
        setTimeout(() => exportBtn && exportBtn.focus(), 30);
    };

    openBtn.onclick = open;
    closeBtn.onclick = close;
    modal.onclick = (event) => {
        if (event.target === modal) close();
    };

    document.querySelectorAll('.dt-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const target = btn.getAttribute('data-dt-tab');
            document.querySelectorAll('.dt-tab-btn').forEach(b => {
                const active = b === btn;
                b.classList.toggle('dt-tab-btn--active', active);
                b.setAttribute('aria-selected', String(active));
            });
            document.querySelectorAll('.dt-tab-panel').forEach(panel => {
                panel.classList.toggle('dt-tab-panel--active', panel.id === `dataTransferPanel-${target}`);
            });
        });
    });

    const exportBtn = document.getElementById('exportJsonBtn');
    if (exportBtn) {
        exportBtn.addEventListener('click', () => app.exportAllJSON());
    }

    const importBtn = document.getElementById('importJsonBtn');
    const importInput = document.getElementById('importJsonInput');
    if (importBtn && importInput) {
        importBtn.addEventListener('click', () => {
            importInput.click();
        });

        importInput.addEventListener('change', () => {
            const [file] = importInput.files || [];
            if (file) {
                app.importAllJSON(file);
            }
            importInput.value = '';
        });
    }
}

export function showImportResult(kind, message) {
    const banner = document.getElementById('importResultBanner');
    if (!banner) return;
    banner.textContent = message;
    const modifier = kind === 'success' ? '' : ` target-result--${kind}`;
    banner.className = `target-result${modifier}`;
}

export function requestImportModeChoice(parts) {
    return new Promise((resolve) => {
        const modal = document.getElementById('dataTransferModal');
        const choice = document.getElementById('importModeChoice');
        const summary = document.getElementById('importModeSummary');
        const replaceBtn = document.getElementById('importModeReplaceBtn');
        const mergeBtn = document.getElementById('importModeMergeBtn');
        // If the modal isn't actually open (e.g. importAllJSON was invoked
        // programmatically, not via the modal's own file input), there's no
        // UI for the user to respond to - waiting for a click here would
        // hang forever. Fall back to the same default as the "controls
        // don't exist" case below: Replace.
        const modalOpen = modal && modal.classList.contains('flex-visible');
        if (!modalOpen || !choice || !summary || !replaceBtn || !mergeBtn) {
            resolve(true);
            return;
        }
        summary.textContent = `Found: ${parts.join(', ')}. Replace your current data entirely, or merge debts only (income & strategy will still be restored; duplicate debt names are skipped)?`;
        choice.classList.remove('hidden');

        const cleanup = () => {
            choice.classList.add('hidden');
            replaceBtn.onclick = null;
            mergeBtn.onclick = null;
        };
        replaceBtn.onclick = () => { cleanup(); resolve(true); };
        mergeBtn.onclick = () => { cleanup(); resolve(false); };
    });
}
