// Settings -> Security -> Active sessions (#683): every browser signed in to
// this account, with Sign out per session and "Sign out all other sessions".
// Loaded each time the Security page is shown. Built with createElement and
// textContent only. Uses plain fetch (not pgFetch): signing a session out is
// not app data, so it never touches the save chip or live refresh.
import { t, plural } from './i18n.js';
import { getCsrfCookie, discardBody } from './storage.js';
import { requestLogin } from './loginGate.js';
import { formatShortDateTime } from './utils.js';

const el = id => document.getElementById(id);

// "Firefox on Linux"; an unrecognized part says Unknown.
export function sessionDeviceLabel(session) {
    return t('settings.sessions.device', {
        browser: session?.browser || t('settings.sessions.unknownBrowser'),
        os: session?.os || t('settings.sessions.unknownOs')
    });
}

function setStatus(text) {
    const status = el('settingsSessionsStatus');
    if (status) status.textContent = text || '';
}

function setError(text) {
    const error = el('settingsSessionsError');
    if (error) error.textContent = text || '';
}

async function request(app, method, path) {
    let res;
    try {
        res = await fetch(path, {
            method,
            headers: method === 'GET' ? {} : { 'X-CSRF-Token': getCsrfCookie() }
        });
    } catch {
        setError(t('settings.sessions.loadFailed'));
        return null;
    }
    if (res.status === 401) {
        await discardBody(res);
        await requestLogin(app);
        return null;
    }
    return res;
}

function renderRow(app, session) {
    const li = document.createElement('li');
    li.className = 'settings-session-row';
    li.dataset.sessionId = session.id;
    if (session.current) li.classList.add('settings-session-row--current');

    const info = document.createElement('div');
    info.className = 'settings-session-info';
    const name = document.createElement('span');
    name.className = 'settings-session-device';
    name.textContent = sessionDeviceLabel(session);
    info.appendChild(name);
    if (session.current) {
        const badge = document.createElement('span');
        badge.className = 'settings-session-badge';
        badge.textContent = t('settings.sessions.thisDevice');
        info.appendChild(badge);
    }

    const meta = document.createElement('span');
    meta.className = 'settings-session-meta';
    meta.textContent = t('settings.sessions.meta', {
        lastActive: formatShortDateTime(session.lastSeenAt),
        signedIn: formatShortDateTime(session.createdAt)
    });
    info.appendChild(meta);
    if (session.ip) {
        const ip = document.createElement('span');
        ip.className = 'settings-session-meta';
        const label = document.createElement('span');
        label.textContent = t('settings.sessions.network');
        // The network prefix is data, not prose (an IPv6 prefix has letters).
        const value = document.createElement('code');
        value.setAttribute('translate', 'no');
        value.textContent = session.ip;
        ip.append(label, ' ', value);
        info.appendChild(ip);
    }
    li.appendChild(info);

    if (!session.current) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn btn-secondary btn-small settings-session-signout';
        btn.textContent = t('settings.sessions.signOut');
        btn.setAttribute('aria-label', t('settings.sessions.signOutAria', { device: sessionDeviceLabel(session) }));
        btn.addEventListener('click', () => revokeSession(app, session));
        li.appendChild(btn);
    }
    return li;
}

function render(app, sessions) {
    const list = el('settingsSessionsList');
    if (!list) return;
    list.replaceChildren(...sessions.map(s => renderRow(app, s)));
    const others = sessions.filter(s => !s.current).length;
    const allBtn = el('settingsSignOutOthersBtn');
    if (allBtn) allBtn.disabled = others === 0;
    const summary = el('settingsSessionsSummary');
    if (summary) summary.textContent = others === 0 ? t('settings.sessions.onlyThis') : plural('settings.sessions.others', others);
}

export async function loadActiveSessions(app) {
    setError('');
    const res = await request(app, 'GET', '/api/sessions');
    if (!res) return null;
    if (!res.ok) {
        await discardBody(res);
        setError(t('settings.sessions.loadFailed'));
        return null;
    }
    const sessions = await res.json().catch(() => null);
    if (!Array.isArray(sessions)) {
        setError(t('settings.sessions.loadFailed'));
        return null;
    }
    render(app, sessions);
    return sessions;
}

async function revokeSession(app, session) {
    setStatus('');
    setError('');
    const res = await request(app, 'DELETE', `/api/sessions/${encodeURIComponent(session.id)}`);
    if (!res) return;
    await discardBody(res);
    // 404: already gone (expired or signed out elsewhere) -- just refresh.
    if (!res.ok && res.status !== 404) {
        setError(t('settings.sessions.signOutFailed'));
        return;
    }
    setStatus(t('settings.sessions.signedOutOne', { device: sessionDeviceLabel(session) }));
    await loadActiveSessions(app);
    el('settingsSessionsHeading')?.focus();
}

async function revokeOthers(app) {
    setStatus('');
    setError('');
    const res = await request(app, 'DELETE', '/api/sessions?others=1');
    if (!res) return;
    if (!res.ok) {
        await discardBody(res);
        setError(t('settings.sessions.signOutFailed'));
        return;
    }
    const body = await res.json().catch(() => ({}));
    setStatus(plural('settings.sessions.signedOutOthers', Number(body.revoked) || 0));
    await loadActiveSessions(app);
}

export function initActiveSessions(app) {
    el('settingsSignOutOthersBtn')?.addEventListener('click', () => revokeOthers(app));
}
