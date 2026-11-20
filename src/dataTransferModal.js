// Backup & Restore (Settings -> Backup & Restore page, #settingsPage-backup).
// This module owns the page's export/import wiring: #exportJsonBtn,
// #exportChartsPngBtn, #importJsonBtn/#importJsonInput and the Replace/Merge
// choice. The old standalone #dataTransferModal is gone (7.20.0).

import { t } from './i18n.js';

// Called on every Settings open: clears a previous import result (banner,
// warnings list, Replace/Merge choice) and recomputes whether any chart is
// visible, which depends on the page open behind Settings.
export function resetBackupPage() {
    const banner = document.getElementById('importResultBanner');
    if (banner) { banner.textContent = ''; banner.className = 'target-result hidden'; }
    const warningsList = document.getElementById('importWarningsList');
    if (warningsList) { warningsList.innerHTML = ''; warningsList.classList.add('hidden'); }
    const choice = document.getElementById('importModeChoice');
    if (choice) choice.classList.add('hidden');
    const chartsBtn = document.getElementById('exportChartsPngBtn');
    if (chartsBtn) {
        const hasVisibleChart = Array.from(document.querySelectorAll('canvas'))
            .some(c => c.id && c.offsetParent !== null);
        chartsBtn.disabled = !hasVisibleChart;
        chartsBtn.title = hasVisibleChart ? '' : t('dataTransfer.exportChartsNoCharts');
    }
}

export function initDataTransferModal(app) {
    const exportBtn = document.getElementById('exportJsonBtn');
    if (exportBtn) {
        exportBtn.addEventListener('click', () => app.exportAllJSON());
    }

    const chartsBtn = document.getElementById('exportChartsPngBtn');
    if (chartsBtn) {
        chartsBtn.addEventListener('click', () => app.exportChartsAsPng());
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

// `warnings`, if non-empty, renders a collapsible <details> list of
// per-field coercions and rejected records below the result banner (#291).
// Built entirely with createElement/textContent (no innerHTML of untrusted
// content) so no escapeHtml() call is needed to stay CSP-safe.
export function showImportResult(kind, message, warnings = []) {
    const banner = document.getElementById('importResultBanner');
    if (banner) {
        banner.textContent = message;
        const modifier = kind === 'success' ? '' : ` target-result--${kind}`;
        banner.className = `target-result${modifier}`;
    }

    const list = document.getElementById('importWarningsList');
    if (!list) return;
    list.innerHTML = '';
    list.classList.add('hidden');
    if (!Array.isArray(warnings) || warnings.length === 0) return;

    const details = document.createElement('details');
    details.className = 'import-warnings-details';
    const summary = document.createElement('summary');
    summary.textContent = kind === 'success'
        ? `Import succeeded — ${warnings.length} issue${warnings.length === 1 ? '' : 's'} found (expand to see)`
        : `${warnings.length} issue${warnings.length === 1 ? '' : 's'} found (expand to see)`;
    details.appendChild(summary);

    const ul = document.createElement('ul');
    ul.className = 'import-warnings-ul';
    for (const w of warnings) {
        const li = document.createElement('li');
        li.textContent = w.kind === 'rejected'
            ? `${w.recordType} "${w.recordName}": ${w.reason}`
            : `${w.recordType} "${w.recordName}": ${w.field} — ${_formatWarningValue(w.from)} → ${_formatWarningValue(w.to)}`;
        ul.appendChild(li);
    }
    details.appendChild(ul);
    list.appendChild(details);
    list.classList.remove('hidden');
}

function _formatWarningValue(value) {
    if (value === null || value === undefined || value === '') return '(empty)';
    if (typeof value === 'object') {
        try { return JSON.stringify(value); } catch { return String(value); }
    }
    return String(value);
}

export function requestImportModeChoice(parts) {
    return new Promise((resolve) => {
        const backupPage = document.getElementById('settingsPage-backup');
        const choice = document.getElementById('importModeChoice');
        const summary = document.getElementById('importModeSummary');
        const replaceBtn = document.getElementById('importModeReplaceBtn');
        const mergeBtn = document.getElementById('importModeMergeBtn');
        // If the Backup page isn't showing (e.g. importAllJSON was invoked
        // programmatically, not via the page's own file input), there's no
        // UI for the user to respond to - waiting for a click here would
        // hang forever. Fall back to the same default as the "controls
        // don't exist" case below: Replace.
        const pageShowing = backupPage && backupPage.offsetParent !== null;
        if (!pageShowing || !choice || !summary || !replaceBtn || !mergeBtn) {
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
