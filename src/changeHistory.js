// Settings > Change history (#580): a read-only list of the audit rows the
// server writes for every create, update and delete. Lazy-loaded the first
// time the page opens (lazyModules.js). Reads use plain fetch, not pgFetch, so
// browsing the history never touches the save chip or live refresh. Every
// value is set with textContent; nothing here goes through innerHTML.
import { t } from './i18n.js';
import { formatShortDateTime, discardBody } from './utils.js';
import { AUDIT_TABLE_ORDER, recordName, describeChanges, auditQuery } from './changeHistoryCore.js';

export const CHANGE_HISTORY_PAGE_SIZE = 50;

const state = { entries: [], hasMore: false, table: 'all', loading: false, generation: 0 };

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

// Identifiers and stored values are shown as data, not prose.
function code(text) {
    const node = el('code', 'change-history-code', text);
    node.setAttribute('translate', 'no');
    return node;
}

export function tableLabel(table) {
    return t(`history.table.${table}`);
}

function fillFilter(select) {
    const current = state.table;
    select.textContent = '';
    const all = el('option', '', t('history.filterAll'));
    all.value = 'all';
    select.appendChild(all);
    for (const table of AUDIT_TABLE_ORDER) {
        const opt = el('option', '', tableLabel(table));
        opt.value = table;
        select.appendChild(opt);
    }
    select.value = current;
}

function renderEntry(entry) {
    const item = el('li', 'change-history-item');
    const head = el('div', 'change-history-head');
    const op = ['create', 'update', 'delete'].includes(entry.op) ? entry.op : 'update';
    head.appendChild(el('span', `change-history-op change-history-op--${op}`, t(`history.op.${op}`)));
    head.appendChild(el('span', 'change-history-type', tableLabel(entry.table)));
    const name = recordName(entry);
    if (name) head.appendChild(el('span', 'change-history-name', name));
    else if (entry.table !== 'plan_settings') head.appendChild(code(String(entry.rowId)));
    item.appendChild(head);

    const time = el('time', 'change-history-time', formatShortDateTime(entry.at));
    time.setAttribute('datetime', String(entry.at));
    item.appendChild(time);

    const changes = describeChanges(entry);
    if (changes.length) {
        const list = el('ul', 'change-history-fields');
        list.setAttribute('aria-label', t('history.changesAria'));
        for (const change of changes) {
            const row = el('li', 'change-history-field');
            row.appendChild(code(change.field));
            row.appendChild(el('span', 'change-history-sep', ': '));
            row.appendChild(code(change.from));
            row.appendChild(el('span', 'change-history-arrow', ' → '));
            row.appendChild(code(change.to));
            list.appendChild(row);
        }
        item.appendChild(list);
    }
    return item;
}

function setStatus(text) {
    const status = document.getElementById('changeHistoryStatus');
    if (status) status.textContent = text;
}

function render() {
    const list = document.getElementById('changeHistoryList');
    const more = document.getElementById('changeHistoryMoreBtn');
    if (!list) return;
    list.textContent = '';
    state.entries.forEach(entry => list.appendChild(renderEntry(entry)));
    list.classList.toggle('hidden', state.entries.length === 0);
    if (more) more.classList.toggle('hidden', !state.hasMore);
    if (!state.loading) {
        setStatus(state.entries.length === 0
            ? t(state.table === 'all' ? 'history.empty' : 'history.emptyFiltered')
            : '');
    }
}

async function fetchPage(before) {
    const res = await fetch(`/api/audit-log?${auditQuery({ limit: CHANGE_HISTORY_PAGE_SIZE, before, table: state.table })}`,
        { credentials: 'same-origin' });
    if (!res.ok) { await discardBody(res); throw new Error(`audit-log ${res.status}`); }
    return res.json();
}

// Loads the first page (append=false) or the next one. A newer load (a filter
// change or re-open) wins over one still in flight.
export async function loadChangeHistory({ append = false } = {}) {
    const generation = ++state.generation;
    state.loading = true;
    const more = document.getElementById('changeHistoryMoreBtn');
    if (more) more.disabled = true;
    if (!append) setStatus(t('history.loading'));
    try {
        const before = append && state.entries.length ? state.entries[state.entries.length - 1].id : null;
        const body = await fetchPage(before);
        if (generation !== state.generation) return;
        const entries = Array.isArray(body && body.entries) ? body.entries : [];
        state.entries = append ? state.entries.concat(entries) : entries;
        state.hasMore = Boolean(body && body.hasMore);
        state.loading = false;
        render();
    } catch {
        if (generation !== state.generation) return;
        state.loading = false;
        if (!append) state.entries = [];
        render();
        setStatus(t('history.error'));
    } finally {
        if (more) more.disabled = false;
    }
}

let wired = false;

// Called each time the Settings page opens: refreshes the filter labels (the
// language may have changed) and reloads from the newest entry.
export function renderChangeHistory() {
    const select = document.getElementById('changeHistoryFilter');
    if (select) fillFilter(select);
    if (!wired) {
        wired = true;
        if (select) {
            select.addEventListener('change', () => {
                state.table = select.value || 'all';
                loadChangeHistory();
            });
        }
        const more = document.getElementById('changeHistoryMoreBtn');
        if (more) more.addEventListener('click', () => loadChangeHistory({ append: true }));
    }
    return loadChangeHistory();
}
