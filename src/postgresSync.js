import { getCsrfCookie } from './storage.js';
import { showLoginGate } from './loginGate.js';
import { showPgErrorToast } from './ui.js';

const ALL_RESOURCE_PATHS = [
    '/api/debts',
    '/api/accounts',
    '/api/incomes',
    '/api/bonuses',
    '/api/bills',
    '/api/expenses',
    '/api/recurring-templates',
    '/api/emergency-funds',
    '/api/sinking-funds',
    '/api/reconciliations',
    '/api/ledger-overrides',
    '/api/net-worth-snapshots',
    '/api/settings',
];

async function pgFetch(app, method, path, body) {
    try {
        const res = await fetch(path, {
            method,
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': getCsrfCookie()
            },
            body: body !== undefined ? JSON.stringify(body) : undefined
        });
        if (res.status === 401) {
            await showLoginGate(app);
            return null;
        }
        if (!res.ok) {
            console.error(`[postgresSync] ${method} ${path} failed: ${res.status}`);
            showPgErrorToast();
            return null;
        }
        if (res.status === 204) return null;
        return await res.json();
    } catch (err) {
        console.error(`[postgresSync] ${method} ${path} error:`, err);
        showPgErrorToast();
        return null;
    }
}

export async function pgPost(app, path, body) {
    return pgFetch(app, 'POST', path, body);
}

export function pgPatch(app, path, body) {
    pgFetch(app, 'PATCH', path, body);
}

export function pgDelete(app, path) {
    pgFetch(app, 'DELETE', path);
}

export function pgPut(app, path, body) {
    pgFetch(app, 'PUT', path, body);
}

export async function pgDeleteAll(app) {
    await Promise.all(ALL_RESOURCE_PATHS.map(path => pgFetch(app, 'DELETE', path)));
}
