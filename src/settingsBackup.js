// #326: settings-only backup (Settings -> Data & Storage). The pure schema,
// build and parse functions live in settings.js; this module does the DOM and
// state work: download, file read, applying a parsed import, inline result.

import {
    getSetting, setSetting, buildSettingsExport, parseSettingsImport, SETTINGS_EXPORT_MAX_BYTES, THEME_PREF_KEY,
    RECONCILIATION_ADJUSTS_BALANCE, SHOW_ARCHIVED_DEBTS, SHOW_ARCHIVED_RECURRING, AUTO_NW_SNAPSHOT,
    getZeroAmountPolicy
} from './settings.js';
import { applyTheme } from './ui.js';
import { t, getCurrentLocale, getCurrencyCode, setCurrencyCode, setLocale } from './i18n.js';

function readStoredTheme() {
    try { return localStorage.getItem(THEME_PREF_KEY) || 'light'; } catch (_) { return 'light'; }
}

export function currentSettingsPrefs() {
    return { theme: readStoredTheme(), locale: getCurrentLocale(), currency: getCurrencyCode() };
}

// Applies a parseSettingsImport() result and returns the number of items
// applied. Locale goes last because setLocale() re-renders the open page.
export function applySettingsImport(app, parsed) {
    if (!parsed || !parsed.ok) return 0;
    let applied = 0;
    const prefs = parsed.preferences || {};
    if (prefs.theme) {
        const themeApplied = applyTheme(prefs.theme);
        try { localStorage.setItem(THEME_PREF_KEY, themeApplied); } catch (_) { /* unavailable */ }
        applied++;
    }
    if (prefs.currency) { setCurrencyCode(prefs.currency); applied++; }
    for (const [key, value] of Object.entries(parsed.settings || {})) {
        setSetting(app, key, value);
        applied++;
    }
    if (prefs.locale) { setLocale(app, prefs.locale); applied++; }
    // setLocale only re-renders when the locale actually changed; currency and
    // settings changes need a refresh regardless (a second one is harmless).
    if (typeof app.refreshCurrentPageData === 'function') app.refreshCurrentPageData();
    syncOpenSettingsControls(app);
    return applied;
}

// Keeps the (possibly open) Settings modal's controls in step with the store.
function syncOpenSettingsControls(app) {
    const setChecked = (id, key) => {
        const el = document.getElementById(id);
        if (el) el.checked = Boolean(getSetting(app, key, false));
    };
    setChecked('settingReconciliationAdjusts', RECONCILIATION_ADJUSTS_BALANCE);
    setChecked('settingShowArchivedDebts', SHOW_ARCHIVED_DEBTS);
    setChecked('settingShowArchivedRecurring', SHOW_ARCHIVED_RECURRING);
    setChecked('settingAutoNwSnapshot', AUTO_NW_SNAPSHOT);
    const zero = document.getElementById('settingZeroAmountPolicy');
    if (zero) zero.value = getZeroAmountPolicy(app);
    const locale = document.getElementById('settingLocale');
    if (locale) locale.value = getCurrentLocale();
    const currency = document.getElementById('settingCurrency');
    if (currency) currency.value = getCurrencyCode();
    const themeSel = document.getElementById('themeSwitcher');
    if (themeSel) themeSel.value = readStoredTheme();
}

export function exportSettingsFile(app) {
    const payload = buildSettingsExport(app, currentSettingsPrefs());
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `myfinances-settings-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    return payload;
}

// Inline result in #settingsBackupStatus (role="status"). All text is set via
// textContent because skipped keys come from the imported file.
export function showSettingsBackupResult(kind, message, skipped = []) {
    const status = document.getElementById('settingsBackupStatus');
    if (!status) return;
    status.textContent = '';
    status.className = kind === 'success' ? 'target-result' : `target-result target-result--${kind}`;
    const p = document.createElement('p');
    p.textContent = message;
    status.appendChild(p);
    if (Array.isArray(skipped) && skipped.length > 0) {
        const details = document.createElement('details');
        details.className = 'import-warnings-details';
        const summary = document.createElement('summary');
        summary.textContent = t('settings.backup.skippedSummary', { count: skipped.length });
        details.appendChild(summary);
        const ul = document.createElement('ul');
        ul.className = 'import-warnings-ul';
        for (const s of skipped) {
            const li = document.createElement('li');
            li.textContent = t('settings.backup.skippedItem', { key: s.key, reason: s.reason });
            ul.appendChild(li);
        }
        details.appendChild(ul);
        status.appendChild(details);
    }
}

export function importSettingsText(app, text) {
    const parsed = parseSettingsImport(text);
    if (!parsed.ok) {
        showSettingsBackupResult('error', parsed.error);
        return parsed;
    }
    const applied = applySettingsImport(app, parsed);
    showSettingsBackupResult('success', t('settings.backup.applied', { count: applied }), parsed.skipped);
    return parsed;
}

export function initSettingsBackup(app) {
    const exportBtn = document.getElementById('settingsExportBtn');
    const importBtn = document.getElementById('settingsImportBtn');
    const fileInput = document.getElementById('settingsImportFile');
    if (!exportBtn || !importBtn || !fileInput) return;
    exportBtn.onclick = () => {
        exportSettingsFile(app);
        showSettingsBackupResult('success', t('settings.backup.exported'));
    };
    importBtn.onclick = () => fileInput.click();
    fileInput.onchange = () => {
        const file = fileInput.files && fileInput.files[0];
        if (!file) return;
        const text = file.size > SETTINGS_EXPORT_MAX_BYTES ? null : file;
        if (!text) {
            fileInput.value = '';
            showSettingsBackupResult('error', t('settings.backup.errTooLarge'));
            return;
        }
        const reader = new FileReader();
        reader.onload = () => importSettingsText(app, String(reader.result || ''));
        reader.onerror = () => showSettingsBackupResult('error', t('settings.backup.errRead'));
        reader.readAsText(file);
        fileInput.value = '';
    };
}
