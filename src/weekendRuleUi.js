// Weekend due-date shift UI helpers (issue #165): option list for the
// "If due on a weekend" select and the short label shown on cards.

import { t } from './i18n.js';
import { WEEKEND_RULES, sanitizeWeekendRule } from './weekendRule.js';

export function weekendRuleLabel(rule) {
    return t(`weekend.${sanitizeWeekendRule(rule)}`);
}

// Escaped <option> list for the inline-edit selects; the add forms in
// index.html carry static, data-i18n'd options.
export function buildWeekendRuleOptionsHtml(selected) {
    const sel = sanitizeWeekendRule(selected);
    return WEEKEND_RULES
        .map(r => `<option value="${r}"${r === sel ? ' selected' : ''}>${weekendRuleLabel(r)}</option>`)
        .join('');
}
