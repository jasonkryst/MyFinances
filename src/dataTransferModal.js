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
}
