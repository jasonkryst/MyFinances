// In-app notifications (#211): the toolbar bell, its unread badge and the
// alert list. Alerts are raised on the server (server/src/jobs/notifications.js)
// and stored with their params, so the text is built here with t() in the
// user's language. Reads and "mark read" calls use fetch directly, not
// pgFetch: they are not edits to the user's data, so they must not count
// toward the save-status chip or fire a live-refresh broadcast.

import { t } from './i18n.js';
import { escapeHtml, formatCurrency, formatShortDate } from './utils.js';
import { getCsrfCookie } from './storage.js';
import { getSetting, setSetting } from './settings.js';
import { NOTIFY_FILTER_TYPE, NOTIFY_FILTER_STATUS, NOTIFY_FILTER_ACCOUNT } from './settingsSchema.js';
import { filtersFromSettings, filtersToSettings, filtersToQuery, filterNotifications } from './notificationsFilter.js';

// unreadCount is the bell's count: unread alerts matching the saved Type and
// Account filters (#649). Only the bell's own GET sets it. allUnreadCount is
// every unread alert, for the Notifications page summary.
const state = { items: [], all: [], total: 0, allLoaded: false, unreadCount: 0, allUnreadCount: 0, emailConfigured: false, loaded: false, failed: false };
let appRef = null;
let inFlight = null;
let allInFlight = null;
const subscribers = new Set();

// Subscribes to any change of the shared state (load, read/unread, refresh).
// Returns an unsubscribe function. One failing subscriber never blocks others.
export function onNotificationsChange(fn) {
    subscribers.add(fn);
    return () => { subscribers.delete(fn); };
}

function notifySubscribers() {
    for (const fn of [...subscribers]) {
        try { fn(state); } catch { /* a subscriber's error must not break the others */ }
    }
}

export function getNotificationsState() {
    return state;
}

const DEFAULT_SAVED = { type: 'all', status: 'unread', account: 0 };

function savedSettings(app) {
    const host = app || {};
    return {
        type: getSetting(host, NOTIFY_FILTER_TYPE, DEFAULT_SAVED.type),
        status: getSetting(host, NOTIFY_FILTER_STATUS, DEFAULT_SAVED.status),
        account: getSetting(host, NOTIFY_FILTER_ACCOUNT, DEFAULT_SAVED.account),
    };
}

// The saved bell/page filters (#649), normalized. A saved account that is no
// longer in app.accounts (deleted) means all accounts; an archived one still
// counts. Dates are not saved: they live in the page's memory only.
export function getSavedNotificationFilters(app = appRef) {
    const f = filtersFromSettings(savedSettings(app));
    if (f.accountId !== 'all' && !((app && app.accounts) || []).some(a => a.id === f.accountId)) {
        f.accountId = 'all';
    }
    return f;
}

export function isDefaultNotificationFilters(f) {
    return f.category === 'all' && f.status === 'unread' && f.accountId === 'all';
}

const SETTING_KEYS = { type: NOTIFY_FILTER_TYPE, status: NOTIFY_FILTER_STATUS, account: NOTIFY_FILTER_ACCOUNT };

// Saves the Type/Status/Account of `filters` (or only the named `fields`),
// writing only the keys whose value changes.
export function saveNotificationFilters(app, filters, fields = ['type', 'status', 'account']) {
    const next = filtersToSettings(filters);
    const current = savedSettings(app);
    for (const field of fields) {
        if (SETTING_KEYS[field] && current[field] !== next[field]) setSetting(app, SETTING_KEYS[field], next[field]);
    }
}

// Clear (bell or page): every filter back to its default (the page's dates
// too), then re-fetch the bell.
export function clearNotificationFilters(app = appRef) {
    if (!app) return Promise.resolve(state);
    if (app._notificationsFilters) app._notificationsFilters = { ...app._notificationsFilters, from: null, to: null };
    saveNotificationFilters(app, { category: 'all', status: 'unread', accountId: 'all' });
    return refreshNotifications({ force: true });
}

// The rows of `items` that match the saved Type and Account, i.e. the ones
// the badge counts while unread.
function matchingBellFilters(items) {
    return filterNotifications(items, { ...getSavedNotificationFilters(), status: 'all', from: null, to: null });
}

function isoToDate(iso) {
    return typeof iso === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T00:00:00`) : null;
}

const dateText = iso => {
    const d = isoToDate(iso);
    return d ? formatShortDate(d) : '';
};

// The localized one-line message for an alert (exported for tests).
export function notificationMessage(type, params = {}) {
    const p = params || {};
    const account = p.accountName || t('notify.unknownAccount');
    switch (type) {
    case 'billDueToday':
        return t('notify.msg.billDueToday', { name: p.name || t('notify.unknownBill'), amount: formatCurrency(Number(p.amount) || 0) });
    case 'billDueSoon':
        return Number(p.daysUntil) === 1
            ? t('notify.msg.billDueTomorrow', { name: p.name || t('notify.unknownBill'), amount: formatCurrency(Number(p.amount) || 0) })
            : t('notify.msg.billDueSoon', { name: p.name || t('notify.unknownBill'), amount: formatCurrency(Number(p.amount) || 0), days: Number(p.daysUntil) || 0, date: dateText(p.dueDate) });
    case 'lowBalance':
        return t('notify.msg.lowBalance', { account, balance: formatCurrency(Number(p.balance) || 0), threshold: formatCurrency(Number(p.threshold) || 0) });
    case 'zeroBalance':
        return t('notify.msg.zeroBalance', { account, balance: formatCurrency(Number(p.balance) || 0) });
    case 'projectedLow':
        return p.threshold
            ? t('notify.msg.projectedLow', { account, balance: formatCurrency(Number(p.projectedBalance) || 0), date: dateText(p.date), threshold: formatCurrency(Number(p.threshold) || 0) })
            : t('notify.msg.projectedZero', { account, balance: formatCurrency(Number(p.projectedBalance) || 0), date: dateText(p.date) });
    default:
        return t('notify.msg.generic');
    }
}

const ICONS = { billDueToday: '📅', billDueSoon: '🗓️', lowBalance: '⚠️', zeroBalance: '⛔', projectedLow: '📉' };

// Where clicking an alert goes: bills to the Ledger, balances to Accounts.
export function notificationTargetPage(type) {
    return type === 'billDueToday' || type === 'billDueSoon' ? 'ledger' : 'accounts';
}

function renderBadge() {
    const badge = document.getElementById('notificationsBadge');
    const btn = document.getElementById('notificationsBtn');
    const count = state.unreadCount;
    if (badge) {
        badge.textContent = count > 99 ? '99+' : String(count);
        badge.classList.toggle('hidden', count === 0);
    }
    // The button's own label is static (data-i18n-attr); the unread count is
    // its description, so a locale switch can't leave a stale label behind.
    const sr = document.getElementById('notificationsUnreadSr');
    if (sr) sr.textContent = count > 0 ? t('notify.unreadCount', { count }) : '';
    if (btn) btn.classList.toggle('notifications-btn--unread', count > 0);
}

function renderList() {
    const list = document.getElementById('notificationsList');
    const markAll = document.getElementById('notificationsMarkAllBtn');
    if (!list) return;
    if (markAll) markAll.disabled = state.unreadCount === 0;
    if (state.failed && !state.loaded) {
        list.innerHTML = `<p class="notifications-empty">${escapeHtml(t('notify.loadFailed'))}</p>`;
        return;
    }
    if (state.items.length === 0) {
        const key = isDefaultNotificationFilters(getSavedNotificationFilters()) ? 'notify.emptyUnread' : 'notify.emptyFiltered';
        list.innerHTML = `<p class="notifications-empty">${escapeHtml(t(key))}</p>`;
        return;
    }
    list.innerHTML = `<ul class="notifications-items">${state.items.map(n => {
        const unread = !n.readAt;
        const created = n.createdAt ? formatShortDate(new Date(n.createdAt)) : '';
        const resolved = n.resolvedAt ? `<span class="notifications-item-resolved">${escapeHtml(t('notify.resolved'))}</span>` : '';
        return `<li>
            <button type="button" class="notifications-item${unread ? ' notifications-item--unread' : ''}" data-notification-id="${Number(n.id)}" data-notification-type="${escapeHtml(n.type)}">
                <span class="notifications-item-icon" aria-hidden="true">${ICONS[n.type] || '🔔'}</span>
                <span class="notifications-item-body">
                    <span class="notifications-item-text">${escapeHtml(notificationMessage(n.type, n.params))}</span>
                    <span class="notifications-item-meta">${escapeHtml(created)}${unread ? ` · <span class="notifications-item-new">${escapeHtml(t('notify.unread'))}</span>` : ''}${resolved ? ` · ${resolved}` : ''}</span>
                </span>
            </button>
        </li>`;
    }).join('')}</ul>`;
}

function accountLabel(accountId) {
    if (accountId === 'all') return t('notifyPage.allAccounts');
    const acct = ((appRef && appRef.accounts) || []).find(a => a.id === accountId);
    return acct ? acct.name : t('notify.unknownAccount');
}

// "Filtered: <type> · <status> · <account>" plus Clear, shown only while a
// saved filter differs from its default.
function renderFilterNote() {
    const note = document.getElementById('notificationsFilterNote');
    const text = document.getElementById('notificationsFilterText');
    if (!note || !text) return;
    const f = getSavedNotificationFilters();
    const show = !isDefaultNotificationFilters(f);
    note.classList.toggle('hidden', !show);
    const value = show ? t('notify.filteredNote', {
        type: t(`notifyPage.type.${f.category}`),
        status: t(`notifyPage.status.${f.status}`),
        account: accountLabel(f.accountId),
    }) : '';
    if (text.textContent !== value) text.textContent = value;
}

function render() {
    renderBadge();
    renderFilterNote();
    renderList();
    notifySubscribers();
}

// Re-renders the badge and the list from the current state.
export function renderNotificationsCenter() {
    render();
}

// Loads the bell's list with the saved filters. Concurrent calls share one
// request unless `force` is set: then a new request starts once the current
// one is done, so the result reflects every change made before the call. A
// failure keeps the last good list and is never shown as a sync error.
export function refreshNotifications({ force = false } = {}) {
    if (inFlight && !force) return inFlight;
    const previous = inFlight;
    const run = (async () => {
        if (previous) await previous;
        return fetchBell();
    })();
    inFlight = run;
    run.finally(() => { if (inFlight === run) inFlight = null; });
    return run;
}

async function fetchBell() {
    try {
        const query = filtersToQuery(getSavedNotificationFilters());
        const res = await fetch(query ? `/api/notifications?${query}` : '/api/notifications', { credentials: 'same-origin' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = await res.json();
        state.items = Array.isArray(body.notifications) ? body.notifications : [];
        // Keep the full list's read state in step with what the server just said.
        if (state.allLoaded) {
            const byId = new Map(state.items.map(n => [n.id, n]));
            state.all.forEach(n => {
                const fresh = byId.get(n.id);
                if (fresh) n.readAt = fresh.readAt;
            });
        }
        state.unreadCount = Number(body.unreadCount) || 0;
        state.emailConfigured = body.emailConfigured === true;
        state.loaded = true;
        state.failed = false;
    } catch {
        state.failed = true;
    } finally {
        render();
        document.documentElement.setAttribute('data-notifications-loaded', state.failed ? 'failed' : 'true');
    }
    return state;
}

// Loads up to 500 notifications for the Notifications page into state.all.
export function loadAllNotifications() {
    if (allInFlight) return allInFlight;
    allInFlight = (async () => {
        try {
            const res = await fetch('/api/notifications?limit=500', { credentials: 'same-origin' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const body = await res.json();
            state.all = Array.isArray(body.notifications) ? body.notifications : [];
            state.total = Number(body.total) || state.all.length;
            // Unfiltered, for the page summary. The bell's unreadCount is left
            // alone: it follows the saved filters (#649).
            state.allUnreadCount = Number(body.unreadCount) || 0;
            state.emailConfigured = body.emailConfigured === true;
            state.allLoaded = true;
            document.documentElement.setAttribute('data-notifications-all-loaded', 'true');
        } catch {
            document.documentElement.setAttribute('data-notifications-all-loaded', 'failed');
        } finally {
            allInFlight = null;
            render();
        }
        return state;
    })();
    return allInFlight;
}

async function post(path) {
    const res = await fetch(path, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'X-CSRF-Token': getCsrfCookie() },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

async function postJson(path, body) {
    const res = await fetch(path, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': getCsrfCookie() },
        body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

// Both lists hold their own copies of a row, so every local change is applied
// to each by id.
function eachCopy(ids, fn) {
    const wanted = new Set(ids);
    for (const list of [state.items, state.all]) {
        list.forEach(n => { if (wanted.has(n.id)) fn(n); });
    }
}

// After a failed write: a fresh fetch, never one that started before it (#647).
async function resyncAfterFailure() {
    await refreshNotifications({ force: true });
    if (state.allLoaded) await loadAllNotifications();
}

// A bulk route's unreadCount is unfiltered, so it updates the page's count,
// never the bell's (#649).
function applyServerUnread(body) {
    if (body && Number.isFinite(Number(body.unreadCount))) state.allUnreadCount = Number(body.unreadCount);
}

function rowsById(ids) {
    const byId = new Map();
    const wanted = new Set(ids);
    for (const list of [state.items, state.all]) {
        list.forEach(n => { if (wanted.has(n.id) && !byId.has(n.id)) byId.set(n.id, n); });
    }
    return [...byId.values()];
}

function idsWhere(ids, pred) {
    const wanted = new Set(ids);
    const found = [];
    for (const list of [state.items, state.all]) {
        list.forEach(n => { if (wanted.has(n.id) && pred(n) && !found.includes(n.id)) found.push(n.id); });
    }
    return found;
}

// Marks the given ids read. Resolves to the ids that were unread locally.
export async function markNotificationsRead(ids) {
    const changed = idsWhere(ids, n => !n.readAt);
    if (changed.length === 0) return [];
    const now = new Date().toISOString();
    const counted = matchingBellFilters(rowsById(changed)).length;
    eachCopy(changed, n => { if (!n.readAt) n.readAt = now; });
    state.unreadCount = Math.max(0, state.unreadCount - counted);
    state.allUnreadCount = Math.max(0, state.allUnreadCount - changed.length);
    render();
    try {
        applyServerUnread(await postJson('/api/notifications/read', { ids: changed }));
        await refreshNotifications({ force: true });
        return changed;
    } catch {
        await resyncAfterFailure();
        return [];
    }
}

// Marks the given ids unread again.
export async function markNotificationsUnread(ids) {
    const changed = idsWhere(ids, n => !!n.readAt);
    if (changed.length === 0) return;
    const counted = matchingBellFilters(rowsById(changed)).length;
    eachCopy(changed, n => { n.readAt = null; });
    state.unreadCount += counted;
    state.allUnreadCount += changed.length;
    render();
    try {
        applyServerUnread(await postJson('/api/notifications/unread', { ids: changed }));
        await refreshNotifications({ force: true });
    } catch {
        await resyncAfterFailure();
    }
}

// One alert (a bell click): the same path as the bulk mark (#647).
export async function markNotificationRead(id) {
    await markNotificationsRead([id]);
}

// The bell's "Mark all read": only the alerts matching the saved Type and
// Account, the rows its badge counts (#649). Hidden alerts stay unread.
export async function markAllNotificationsRead() {
    const now = new Date().toISOString();
    const filters = getSavedNotificationFilters();
    const matching = matchingBellFilters(state.all).filter(n => !n.readAt).map(n => n.id);
    state.items.forEach(n => { if (!n.readAt) n.readAt = now; });
    eachCopy(matching, n => { if (!n.readAt) n.readAt = now; });
    state.unreadCount = 0;
    render();
    try {
        const query = filtersToQuery({ ...filters, status: 'all', from: null, to: null });
        const body = await post(query ? `/api/notifications/read-all?${query}` : '/api/notifications/read-all');
        if (body && Number.isFinite(Number(body.updated))) {
            state.allUnreadCount = Math.max(0, state.allUnreadCount - Number(body.updated));
        }
        await refreshNotifications({ force: true });
    } catch {
        await resyncAfterFailure();
    }
}

// Runs the server check for this user now ("Check now"), then reloads the
// list. Resolves to the server's summary ({ created, ... }); throws on error.
export async function runNotificationCheck() {
    const result = await post('/api/notifications/check');
    await refreshNotifications();
    return result;
}

export function initNotificationsCenter(app) {
    appRef = app;
    const wrap = document.getElementById('notificationsWrap');
    const btn = document.getElementById('notificationsBtn');
    const panel = document.getElementById('notificationsPanel');
    if (!wrap || !btn || !panel) return;

    const close = () => {
        panel.classList.add('hidden');
        btn.setAttribute('aria-expanded', 'false');
    };
    const open = () => {
        panel.classList.remove('hidden');
        btn.setAttribute('aria-expanded', 'true');
        render();
        refreshNotifications();
    };

    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (panel.classList.contains('hidden')) open(); else close();
    });
    document.getElementById('notificationsViewAllBtn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        close();
        app.switchPage('notifications');
    });
    document.getElementById('notificationsMarkAllBtn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        markAllNotificationsRead();
    });
    document.getElementById('notificationsFilterClearBtn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        clearNotificationFilters(app);
    });
    panel.addEventListener('click', (e) => {
        const item = e.target.closest('[data-notification-id]');
        if (!item) return;
        const id = Number(item.getAttribute('data-notification-id'));
        const type = item.getAttribute('data-notification-type');
        markNotificationRead(id);
        close();
        btn.focus();
        app.switchPage(notificationTargetPage(type));
    });
    document.addEventListener('click', (e) => {
        if (!wrap.contains(e.target)) close();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !panel.classList.contains('hidden')) {
            close();
            btn.focus();
        }
    });
    renderBadge();
}
