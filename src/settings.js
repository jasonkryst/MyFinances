// Generic app-wide configuration options, stored as a flat array of
// { key, value } entries so new options can be added without a schema change.

export const RECONCILIATION_ADJUSTS_BALANCE = 'reconciliationAdjustsBalance';

export function getSetting(app, key, defaultValue) {
    const entry = (app.settings || []).find(s => s.key === key);
    return entry ? entry.value : defaultValue;
}

export function setSetting(app, key, value) {
    if (!app.settings) app.settings = [];
    const entry = app.settings.find(s => s.key === key);
    if (entry) {
        entry.value = value;
    } else {
        app.settings.push({ key, value });
    }
    app.saveToStorage();
}
