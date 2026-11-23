// Shared Previous/Next pager markup for long lists (#330). Reuses the
// Ledger's .ledger-pagination look. Controls render only when the list needs
// more than one page; the click handling is delegated by each list's own
// container handler through handlePagerClick().
import { escapeHtml } from './utils.js';
import { t } from './i18n.js';

// `listKey` names the list in data attributes ('debts' | 'recurring');
// `nameKey` is the i18n key base for its plural noun, e.g. 'pager.debts'.
export function renderPagerHtml(listKey, pg, nameKey) {
    if (!pg || pg.totalPages <= 1) return '';
    const noun = t(nameKey);
    const prevLabel = t('pager.prev');
    const nextLabel = t('pager.next');
    return `<nav class="ledger-pagination list-pager" data-pager="${escapeHtml(listKey)}" aria-label="${escapeHtml(t('pager.navLabel', { list: noun }))}">
        <div class="ledger-page-summary" role="status" aria-live="polite">${escapeHtml(t('pager.showing', { start: pg.start, end: pg.end, total: pg.total }))}</div>
        <div class="ledger-page-controls">
            <button type="button" class="ledger-page-btn" data-pager-dir="prev" aria-label="${escapeHtml(t('pager.prevAria', { list: noun }))}"${pg.page <= 1 ? ' disabled' : ''}>${escapeHtml(prevLabel)}</button>
            <span class="ledger-page-info">${escapeHtml(t('pager.pageInfo', { page: pg.page, pages: pg.totalPages }))}</span>
            <button type="button" class="ledger-page-btn" data-pager-dir="next" aria-label="${escapeHtml(t('pager.nextAria', { list: noun }))}"${pg.page >= pg.totalPages ? ' disabled' : ''}>${escapeHtml(nextLabel)}</button>
        </div>
    </nav>`;
}

// Returns the direction ('prev' | 'next') when the click was on an enabled
// pager button of `listKey`, else null.
export function pagerDirectionFromEvent(event, listKey) {
    const btn = event.target.closest?.('[data-pager-dir]');
    if (!btn || btn.disabled) return null;
    const nav = btn.closest('[data-pager]');
    if (!nav || nav.getAttribute('data-pager') !== listKey) return null;
    return btn.getAttribute('data-pager-dir');
}

// After a re-render triggered by the pager: bring the list top into view and
// put focus back on the same-direction button (or the other one when it is now
// disabled at the end of the range).
export function afterPagerRender(container, listKey, dir) {
    if (!container) return;
    const nav = container.querySelector(`[data-pager="${listKey}"]`);
    const sel = (b) => nav?.querySelector(`[data-pager-dir="${b}"]:not([disabled])`);
    const target = sel(dir) || sel(dir === 'next' ? 'prev' : 'next');
    if (target) target.focus({ preventScroll: true });
    if (typeof container.scrollIntoView === 'function') container.scrollIntoView({ block: 'start' });
}
