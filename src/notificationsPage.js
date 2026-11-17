// Notifications page (#643): every stored alert (up to 500), filtered in the
// browser, with bulk "mark read", Undo and View deep links. Lazy-loaded
// through loadNotificationsPageModule() (lazyModules.js).
//
// The shared state lives in notificationsCenter.js. Its render() notifies
// subscribers, so the subscriber here only redraws this page; it must never
// call renderNotificationsCenter() (that would loop).
//
// Filters are held in memory only (app._notificationsFilters) and are never
// written to browser storage. The selection is a module Set, pruned against
// the visible rows on every draw.

import { t, plural } from './i18n.js';
import { escapeHtml, formatShortDate, withBusy, buildFiltersLabel } from './utils.js';
import { offerUndo } from './undo.js';
import { restoreSavedLedgerFiltersOnce } from './ledger.js';
import {
    getNotificationsState,
    loadAllNotifications,
    markNotificationsRead,
    markNotificationsUnread,
    onNotificationsChange,
    notificationMessage,
} from './notificationsCenter.js';
import {
    filterNotifications,
    groupNotificationsByDay,
    summarizeNotifications,
    notificationViewTarget,
    normalizeNotificationFilters,
    pruneSelection,
} from './notificationsFilter.js';

const ICONS = { billDueToday: '📅', billDueSoon: '🗓️', lowBalance: '⚠️', zeroBalance: '⛔', projectedLow: '📉' };
const HIGHLIGHT_MS = 2000;

let selected = new Set();
let initialized = false;
let loading = false;

const el = id => document.getElementById(id);

function getFilters(app) {
    app._notificationsFilters = normalizeNotificationFilters(app._notificationsFilters);
    return app._notificationsFilters;
}

function findItem(id) {
    return getNotificationsState().all.find(n => n.id === id) || null;
}

function visibleItems(app) {
    return filterNotifications(getNotificationsState().all, getFilters(app));
}

function activeFilterCount(f) {
    let n = 0;
    if (f.category !== 'all') n++;
    if (f.status !== 'unread') n++;
    if (f.accountId !== 'all') n++;
    if (f.from) n++;
    if (f.to) n++;
    return n;
}

function renderAccountOptions(app, f) {
    const select = el('notifFilterAccount');
    if (!select) return f;
    const accounts = (app.accounts || []).filter(a => !a.archived);
    let accountId = f.accountId;
    if (accountId !== 'all' && !accounts.some(a => a.id === accountId)) {
        accountId = 'all';
        app._notificationsFilters = { ...f, accountId };
    }
    select.innerHTML = `<option value="all">${escapeHtml(t('notifyPage.allAccounts'))}</option>`
        + accounts.map(a => `<option value="${Number(a.id)}">${escapeHtml(a.name)}</option>`).join('');
    select.value = String(accountId);
    return app._notificationsFilters;
}

function syncFilterControls(app) {
    let f = getFilters(app);
    f = renderAccountOptions(app, f);
    const set = (id, v) => { const c = el(id); if (c && c.value !== v) c.value = v; };
    set('notifFilterType', f.category);
    set('notifFilterStatus', f.status);
    set('notifFilterFrom', f.from || '');
    set('notifFilterTo', f.to || '');
    const toggle = el('notifFiltersToggle');
    if (toggle) {
        const n = activeFilterCount(f);
        toggle.textContent = buildFiltersLabel(n);
        toggle.classList.toggle('filters-disclosure-toggle--active', n > 0);
    }
}

function rowHtml(n, index) {
    const id = Number(n.id);
    const unread = !n.readAt;
    const message = notificationMessage(n.type, n.params);
    const created = n.createdAt ? formatShortDate(new Date(n.createdAt)) : '';
    const tags = [
        unread ? `<span class="notif-tag notif-tag--unread">${escapeHtml(t('notifyPage.tagUnread'))}</span>` : '',
        n.resolvedAt ? `<span class="notif-tag notif-tag--resolved">${escapeHtml(t('notify.resolved'))}</span>` : '',
    ].join('');
    const readBtn = unread
        ? `<button type="button" class="btn btn-secondary btn-small notif-row-read" data-read-action="read" aria-label="${escapeHtml(t('notifyPage.markReadAria', { message }))}">${escapeHtml(t('notifyPage.markRead'))}</button>`
        : `<button type="button" class="btn btn-secondary btn-small notif-row-read" data-read-action="unread" aria-label="${escapeHtml(t('notifyPage.markUnreadAria', { message }))}">${escapeHtml(t('notifyPage.markUnread'))}</button>`;
    return `<li class="notif-row${unread ? ' notif-row--unread' : ' notif-row--read'}" data-notification-id="${id}" data-notification-type="${escapeHtml(n.type)}" tabindex="${index === 0 ? '0' : '-1'}">
        <input type="checkbox" class="notif-row-select" id="notifSelect-${id}"${selected.has(n.id) ? ' checked' : ''} aria-label="${escapeHtml(t('notifyPage.selectAria', { message }))}">
        <span class="notif-row-icon" aria-hidden="true">${ICONS[n.type] || '🔔'}</span>
        <div class="notif-row-body">
            <span class="notif-row-text">${escapeHtml(message)}</span>
            <span class="notif-row-meta"><span class="notif-row-date">${escapeHtml(created)}</span>${tags}</span>
        </div>
        <div class="notif-row-actions">
            <button type="button" class="btn btn-secondary btn-small notif-row-view" aria-label="${escapeHtml(t('notifyPage.viewAria', { message }))}">${escapeHtml(t('notifyPage.view'))}</button>
            ${readBtn}
        </div>
    </li>`;
}

function renderList(app, items) {
    const list = el('notificationsPageList');
    if (!list) return;
    const state = getNotificationsState();
    const failed = document.documentElement.dataset.notificationsAllLoaded === 'failed';
    if (!state.allLoaded) {
        if (failed && !loading) {
            list.innerHTML = `<div class="notif-empty notif-empty--failed"><p>${escapeHtml(t('notifyPage.loadFailed'))}</p>
                <button type="button" class="btn btn-secondary btn-small" id="notifRetryBtn">${escapeHtml(t('notifyPage.retry'))}</button></div>`;
        } else {
            list.innerHTML = `<div class="notif-empty"><p>${escapeHtml(t('notifyPage.loading'))}</p></div>`;
        }
        return;
    }
    if (state.all.length === 0) {
        list.innerHTML = `<div class="notif-empty"><p>${escapeHtml(t('notify.empty'))}</p></div>`;
        return;
    }
    if (items.length === 0) {
        list.innerHTML = `<div class="notif-empty notif-empty--nomatch"><p>${escapeHtml(t('notifyPage.noMatch'))}</p>
            <button type="button" class="btn btn-secondary btn-small" id="notifEmptyClearBtn">${escapeHtml(t('notifyPage.clearFilters'))}</button></div>`;
        return;
    }
    let index = 0;
    list.innerHTML = groupNotificationsByDay(items, new Date()).map(group => {
        const headingId = `notifGroup-${group.key}`;
        const rows = group.items.map(n => rowHtml(n, index++)).join('');
        return `<div class="notif-group">
            <h3 class="notif-group-heading" id="${headingId}">${escapeHtml(t(`notifyPage.group.${group.key}`))}</h3>
            <ul class="notif-group-list" aria-labelledby="${headingId}">${rows}</ul>
        </div>`;
    }).join('');
}

function renderBulkBar(items) {
    const selectAll = el('notifSelectAll');
    const count = items.filter(n => selected.has(n.id)).length;
    if (selectAll) {
        selectAll.disabled = items.length === 0;
        selectAll.checked = items.length > 0 && count === items.length;
        selectAll.indeterminate = count > 0 && count < items.length;
    }
    const countEl = el('notifSelectedCount');
    if (countEl) countEl.textContent = count > 0 ? plural('notifyPage.selectedCount', count) : '';
    const bar = el('notifBulkBar');
    if (bar && bar.getAttribute('aria-busy') === 'true') return; // withBusy restores the buttons
    const markSelected = el('notifMarkSelectedBtn');
    if (markSelected) markSelected.disabled = !items.some(n => selected.has(n.id) && !n.readAt);
    const markMatching = el('notifMarkMatchingBtn');
    if (markMatching) markMatching.disabled = !items.some(n => !n.readAt);
}

function renderSummary() {
    const out = el('notifSummary');
    if (!out) return;
    const state = getNotificationsState();
    if (!state.allLoaded) { out.textContent = ''; return; }
    const s = summarizeNotifications(state.all, state.total);
    let text = t('notifyPage.summary', { unread: state.unreadCount, active: s.active });
    if (s.truncated) text += ` ${t('notifyPage.truncated', { loaded: s.loaded, total: s.total })}`;
    out.textContent = text;
}

// Redraws the page from the shared state (no fetch).
export function drawNotificationsPage(app) {
    syncFilterControls(app);
    const items = visibleItems(app);
    selected = pruneSelection(selected, items);
    renderSummary();
    renderList(app, items);
    renderBulkBar(items);
    if (!loading) document.documentElement.setAttribute('data-notifications-page-ready', 'true');
}

// Loads the full list, then draws. Called on every visit and by Refresh/Retry.
export async function renderNotificationsPage(app) {
    initNotificationsPage(app);
    loading = true;
    document.documentElement.setAttribute('data-notifications-page-ready', 'false');
    drawNotificationsPage(app);
    try {
        await loadAllNotifications();
    } finally {
        loading = false;
        drawNotificationsPage(app);
    }
}

async function markReadWithUndo(ids) {
    const changed = await markNotificationsRead(ids);
    if (changed.length > 0) {
        offerUndo(plural('notifyPage.markedRead', changed.length), async () => {
            await markNotificationsUnread(changed);
            return changed.every(id => !findItem(id)?.readAt);
        });
    }
    return changed;
}

async function runBulk(app, idsFn) {
    const bar = el('notifBulkBar');
    await withBusy(bar, async () => {
        const ids = idsFn();
        if (ids.length === 0) return;
        await markReadWithUndo(ids);
        selected = new Set();
    });
    drawNotificationsPage(app);
}

function highlightAccountCard(accountId) {
    if (accountId === null || accountId === undefined) return;
    const anchor = document.querySelector(`#accountsSection [data-account-id="${Number(accountId)}"]`);
    const card = anchor?.closest('.acct-card') || anchor;
    if (!card) return;
    card.scrollIntoView({ block: 'center', behavior: 'smooth' });
    card.classList.add('notif-highlight');
    setTimeout(() => card.classList.remove('notif-highlight'), HIGHLIGHT_MS);
}

function viewNotification(app, id) {
    const n = findItem(id);
    if (!n) return;
    markNotificationsRead([id]);
    const target = notificationViewTarget(n);
    if (target.page === 'ledger') {
        // Apply the saved filters first, so they can't overwrite the account below.
        restoreSavedLedgerFiltersOnce(app);
        const known = target.accountId !== null && (app.accounts || []).some(a => a.id === target.accountId);
        app._ledgerAccountFilter = known ? target.accountId : 'all';
        app._ledgerPage = 1;
        app.switchPage('ledger');
        return;
    }
    app.switchPage('accounts');
    highlightAccountCard(target.accountId);
}

function setFilter(app, patch) {
    app._notificationsFilters = normalizeNotificationFilters({ ...getFilters(app), ...patch });
    drawNotificationsPage(app);
}

function clearFilters(app) {
    app._notificationsFilters = normalizeNotificationFilters({});
    drawNotificationsPage(app);
}

// Wires the page's delegated listeners once. Safe to call repeatedly.
export function initNotificationsPage(app) {
    if (initialized) return;
    const section = el('notificationsPage');
    if (!section) return;
    initialized = true;

    onNotificationsChange(() => {
        if (app._currentPage === 'notifications') drawNotificationsPage(app);
    });

    section.addEventListener('change', (e) => {
        const target = e.target;
        switch (target.id) {
        case 'notifFilterType': setFilter(app, { category: target.value }); return;
        case 'notifFilterStatus': setFilter(app, { status: target.value }); return;
        case 'notifFilterAccount': setFilter(app, { accountId: target.value }); return;
        case 'notifFilterFrom': setFilter(app, { from: target.value || null }); return;
        case 'notifFilterTo': setFilter(app, { to: target.value || null }); return;
        case 'notifSelectAll': {
            const items = visibleItems(app);
            selected = target.checked ? new Set(items.map(n => n.id)) : new Set();
            drawNotificationsPage(app);
            return;
        }
        default: break;
        }
        if (target.classList.contains('notif-row-select')) {
            const id = Number(target.closest('[data-notification-id]')?.getAttribute('data-notification-id'));
            if (target.checked) selected.add(id); else selected.delete(id);
            renderBulkBar(visibleItems(app));
        }
    });

    section.addEventListener('click', (e) => {
        const btn = e.target.closest('button');
        if (!btn || !section.contains(btn)) return;
        if (btn.id === 'notifFilterClear' || btn.id === 'notifEmptyClearBtn') { clearFilters(app); return; }
        if (btn.id === 'notifRefreshBtn' || btn.id === 'notifRetryBtn') { renderNotificationsPage(app); return; }
        if (btn.id === 'notifMarkSelectedBtn') {
            runBulk(app, () => visibleItems(app).filter(n => selected.has(n.id) && !n.readAt).map(n => n.id));
            return;
        }
        if (btn.id === 'notifMarkMatchingBtn') {
            runBulk(app, () => visibleItems(app).filter(n => !n.readAt).map(n => n.id));
            return;
        }
        const row = btn.closest('.notif-row');
        if (!row) return;
        const id = Number(row.getAttribute('data-notification-id'));
        if (btn.classList.contains('notif-row-view')) { viewNotification(app, id); return; }
        if (btn.classList.contains('notif-row-read')) {
            if (btn.getAttribute('data-read-action') === 'unread') markNotificationsUnread([id]);
            else markNotificationsRead([id]);
        }
    });
}
