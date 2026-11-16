// In-app notifications (#211): the toolbar bell, its unread badge and the
// alert list. Alerts are raised on the server (server/src/jobs/notifications.js)
// and stored with their params, so the text is built here with t() in the
// user's language. Reads and "mark read" calls use fetch directly, not
// pgFetch: they are not edits to the user's data, so they must not count
// toward the save-status chip or fire a live-refresh broadcast.

import { t } from './i18n.js';
import { escapeHtml, formatCurrency, formatShortDate } from './utils.js';
import { getCsrfCookie } from './storage.js';

const state = { items: [], unreadCount: 0, emailConfigured: false, loaded: false, failed: false };
let inFlight = null;

export function getNotificationsState() {
    return state;
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
        list.innerHTML = `<p class="notifications-empty">${escapeHtml(t('notify.empty'))}</p>`;
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

function render() {
    renderBadge();
    renderList();
}

// Re-renders the badge and the list from the current state.
export function renderNotificationsCenter() {
    render();
}

// Loads the list from the server. Concurrent calls share one request; a
// failure keeps the last good list and is never shown as a sync error.
export function refreshNotifications() {
    if (inFlight) return inFlight;
    inFlight = (async () => {
        try {
            const res = await fetch('/api/notifications', { credentials: 'same-origin' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const body = await res.json();
            state.items = Array.isArray(body.notifications) ? body.notifications : [];
            state.unreadCount = Number(body.unreadCount) || 0;
            state.emailConfigured = body.emailConfigured === true;
            state.loaded = true;
            state.failed = false;
        } catch {
            state.failed = true;
        } finally {
            inFlight = null;
            render();
            document.documentElement.setAttribute('data-notifications-loaded', state.failed ? 'failed' : 'true');
        }
        return state;
    })();
    return inFlight;
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

export async function markNotificationRead(id) {
    const item = state.items.find(n => n.id === id);
    if (!item || item.readAt) return;
    item.readAt = new Date().toISOString();
    state.unreadCount = Math.max(0, state.unreadCount - 1);
    render();
    try {
        await post(`/api/notifications/${encodeURIComponent(id)}/read`);
    } catch {
        await refreshNotifications();
    }
}

export async function markAllNotificationsRead() {
    const now = new Date().toISOString();
    state.items.forEach(n => { if (!n.readAt) n.readAt = now; });
    state.unreadCount = 0;
    render();
    try {
        await post('/api/notifications/read-all');
    } catch {
        await refreshNotifications();
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
    document.getElementById('notificationsMarkAllBtn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        markAllNotificationsRead();
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
