// Settings -> Security -> API tokens (#581): read-only personal tokens for
// scripts and dashboards (`Authorization: Bearer <token>` on GET /api/...).
// The raw token is shown once, right after it is created. Built with
// createElement and textContent only; plain fetch, like activeSessions.js.
import { t } from './i18n.js';
import { getCsrfCookie, discardBody } from './storage.js';
import { requestLogin } from './loginGate.js';
import { formatShortDateTime, markFieldInvalid, clearFieldInvalid } from './utils.js';

const el = id => document.getElementById(id);

function setStatus(text) {
    const s = el('settingsApiTokensStatus');
    if (s) s.textContent = text || '';
}

function setError(text) {
    const e = el('settingsApiTokensError');
    if (e) e.textContent = text || '';
}

async function request(app, method, path, body) {
    const headers = method === 'GET' ? {} : { 'X-CSRF-Token': getCsrfCookie() };
    if (body) headers['Content-Type'] = 'application/json';
    let res;
    try {
        res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    } catch {
        setError(t('settings.apiTokens.failed'));
        return null;
    }
    if (res.status === 401) {
        await discardBody(res);
        await requestLogin(app);
        return null;
    }
    return res;
}

function renderRow(app, token) {
    const li = document.createElement('li');
    li.className = 'settings-session-row';
    li.dataset.tokenId = token.id;

    const info = document.createElement('div');
    info.className = 'settings-session-info';
    // The name is the user's own text and the prefix is data, not prose.
    const name = document.createElement('span');
    name.className = 'settings-session-device';
    name.setAttribute('translate', 'no');
    name.textContent = token.name;
    const prefix = document.createElement('code');
    prefix.className = 'settings-session-meta';
    prefix.setAttribute('translate', 'no');
    prefix.textContent = `${token.prefix}…`;
    const meta = document.createElement('span');
    meta.className = 'settings-session-meta';
    meta.textContent = t('settings.apiTokens.meta', {
        created: formatShortDateTime(token.createdAt),
        lastUsed: token.lastUsedAt ? formatShortDateTime(token.lastUsedAt) : t('settings.apiTokens.never')
    });
    info.append(name, prefix, meta);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-secondary btn-small settings-session-signout';
    btn.textContent = t('settings.apiTokens.revoke');
    btn.setAttribute('aria-label', t('settings.apiTokens.revokeAria', { name: token.name }));
    btn.addEventListener('click', () => revokeToken(app, token));
    li.append(info, btn);
    return li;
}

export async function loadApiTokens(app) {
    setError('');
    const res = await request(app, 'GET', '/api/api-tokens');
    if (!res) return null;
    if (!res.ok) {
        await discardBody(res);
        setError(t('settings.apiTokens.failed'));
        return null;
    }
    const tokens = await res.json().catch(() => null);
    if (!Array.isArray(tokens)) {
        setError(t('settings.apiTokens.failed'));
        return null;
    }
    el('settingsApiTokensList')?.replaceChildren(...tokens.map(tok => renderRow(app, tok)));
    el('settingsApiTokensEmpty')?.classList.toggle('hidden', tokens.length > 0);
    return tokens;
}

function hideReveal() {
    el('settingsApiTokenReveal')?.classList.add('hidden');
    const value = el('settingsApiTokenValue');
    if (value) value.value = '';
}

async function revokeToken(app, token) {
    setStatus('');
    setError('');
    const res = await request(app, 'DELETE', `/api/api-tokens/${encodeURIComponent(token.id)}`);
    if (!res) return;
    await discardBody(res);
    if (!res.ok && res.status !== 404) {
        setError(t('settings.apiTokens.failed'));
        return;
    }
    setStatus(t('settings.apiTokens.revoked', { name: token.name }));
    await loadApiTokens(app);
    el('settingsApiTokensHeading')?.focus();
}

async function createToken(app) {
    const input = el('settingsApiTokenName');
    if (!input) return;
    setStatus('');
    setError('');
    hideReveal();
    clearFieldInvalid(input, el('settingsApiTokensError'));
    const name = input.value.trim();
    if (!name) {
        setError(t('settings.apiTokens.nameRequired'));
        markFieldInvalid(input, el('settingsApiTokensError'));
        input.focus();
        return;
    }
    const btn = el('settingsApiTokenCreateBtn');
    if (btn) btn.disabled = true;
    try {
        const res = await request(app, 'POST', '/api/api-tokens', { name });
        if (!res) return;
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
            setError(body?.error?.code === 'TOKEN_LIMIT' ? t('settings.apiTokens.limit') : t('settings.apiTokens.failed'));
            return;
        }
        input.value = '';
        const value = el('settingsApiTokenValue');
        if (value) value.value = body.token;
        el('settingsApiTokenReveal')?.classList.remove('hidden');
        setStatus(t('settings.apiTokens.created', { name: body.name }));
        await loadApiTokens(app);
        value?.focus();
        value?.select();
    } finally {
        if (btn) btn.disabled = false;
    }
}

async function copyToken() {
    const value = el('settingsApiTokenValue');
    if (!value?.value) return;
    try {
        await navigator.clipboard.writeText(value.value);
        setStatus(t('settings.apiTokens.copied'));
    } catch {
        value.select();
        setStatus(t('settings.apiTokens.copyManually'));
    }
}

// Called when the Security page is shown: the token from a previous visit is
// never shown again.
export function refreshApiTokens(app) {
    hideReveal();
    setStatus('');
    return loadApiTokens(app);
}

export function initApiTokens(app) {
    el('settingsApiTokenForm')?.addEventListener('submit', (event) => {
        event.preventDefault();
        createToken(app);
    });
    el('settingsApiTokenCopyBtn')?.addEventListener('click', copyToken);
}
